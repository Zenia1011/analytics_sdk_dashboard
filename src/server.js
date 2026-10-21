const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const initSqlJs = require('sql.js');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

let db;
let SQL;

const dbPath = path.join(DATA_DIR, 'analytics.sqlite');

const persist = () => {
  const bytes = db.export();
  fs.writeFileSync(dbPath, Buffer.from(bytes));
};

const initDb = async () => {
  SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const bytes = fs.readFileSync(dbPath);
    db = new SQL.Database(bytes);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('browser','server')),
      visitor_id TEXT,
      session_id TEXT,
      page_path TEXT,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      properties_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_events_occurred_at
    ON events(occurred_at);

    CREATE INDEX IF NOT EXISTS idx_events_name_time
    ON events(event_name, occurred_at);

    CREATE INDEX IF NOT EXISTS idx_events_visitor_time
    ON events(visitor_id, occurred_at);
  `);

  persist();
};

function all(sql, params = []) {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);

    const rows = [];

    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }

    return rows;
  } finally {
    stmt.free();
  }
}

function one(sql, params = []) {
  return all(sql, params)[0] || {};
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function insert(input, source = 'browser') {
  if (
    !validString(input.event_name, 80) ||
    !/^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(input.event_name)
  ) {
    throw Object.assign(
      new Error('event_name must be 1-80 safe characters'),
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  let occurred = input.occurred_at
    ? new Date(input.occurred_at)
    : new Date();

  if (
    Number.isNaN(occurred.getTime()) ||
    Math.abs(Date.now() - occurred.getTime()) > 7 * 24 * 60 * 60 * 1000
  ) {
    occurred = new Date();
  }

  const event = {
    id: crypto.randomUUID(),
    event_name: input.event_name,
    source,
    visitor_id: validString(input.visitor_id, 100)
      ? input.visitor_id
      : null,
    session_id: validString(input.session_id, 100)
      ? input.session_id
      : null,
    page_path: validString(input.page_path, 500)
      ? input.page_path.slice(0, 500)
      : null,
    occurred_at: occurred.toISOString(),
    received_at: now,
    properties_json: JSON.stringify(cleanProperties(input.properties))
  };

  run(
    `INSERT INTO events
      (
        id,
        event_name,
        source,
        visitor_id,
        session_id,
        page_path,
        occurred_at,
        received_at,
        properties_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.event_name,
      event.source,
      event.visitor_id,
      event.session_id,
      event.page_path,
      event.occurred_at,
      event.received_at,
      event.properties_json
    ]
  );

  return { id: event.id, received: true };
}

const publicDir = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function send(
  res,
  status,
  body,
  type = 'application/json; charset=utf-8'
) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });

  res.end(
    type.startsWith('application/json')
      ? JSON.stringify(body)
      : body
  );
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;

    req.on('data', chunk => {
      data += chunk;

      if (data.length > limit) {
        tooLarge = true;
      }
    });

    req.on('end', () => {
      if (tooLarge) {
        return reject(
          Object.assign(
            new Error('Request body too large'),
            { status: 413 }
          )
        );
      }

      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(
          Object.assign(
            new Error('Invalid JSON body'),
            { status: 400 }
          )
        );
      }
    });

    req.on('error', reject);
  });
}

function validString(v, max = 120) {
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.length <= max
  );
}

function cleanProperties(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {};
  }

  // Limit size and avoid storing arbitrary nested objects or sensitive data.
  const out = {};

  for (const [k, v] of Object.entries(value).slice(0, 30)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k)) {
      continue;
    }

    if (typeof v === 'string') {
      out[k] = v.slice(0, 200);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === 'boolean' || v === null) {
      out[k] = v;
    }
  }

  return out;
}

function dateRange(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const parse = (value, fallback, isEnd = false) => {
    if (!value) {
      return fallback;
    }

    // Include the entire selected day when the input is YYYY-MM-DD.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(
        `${value}T${isEnd ? '23:59:59.999' : '00:00:00.000'}Z`
      ).toISOString();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString();
  };

  const start = parse(
    from,
    new Date(Date.now() - 6 * 86400000)
      .toISOString()
      .slice(0, 10) + 'T00:00:00.000Z'
  );

  const end = parse(
    to,
    new Date().toISOString().slice(0, 10) +
      'T23:59:59.999Z',
    true
  );

  if (!start || !end || start > end) {
    throw Object.assign(
      new Error('Use valid from/to dates with from <= to'),
      { status: 400 }
    );
  }

  return { start, end };
}

function dashboard(url) {
  const { start, end } = dateRange(url);

  const total =
    one(
      `SELECT COUNT(*) n
       FROM events
       WHERE occurred_at >= ? AND occurred_at <= ?`,
      [start, end]
    ).n || 0;

  const pageViews =
    one(
      `SELECT COUNT(*) n
       FROM events
       WHERE occurred_at >= ?
         AND occurred_at <= ?
         AND event_name = 'page_view'`,
      [start, end]
    ).n || 0;

  const unique =
    one(
      `SELECT COUNT(DISTINCT visitor_id) n
       FROM events
       WHERE occurred_at >= ?
         AND occurred_at <= ?
         AND visitor_id IS NOT NULL`,
      [start, end]
    ).n || 0;

  const pages = all(
    `SELECT
       COALESCE(page_path, '(unknown)') page,
       COUNT(*) views
     FROM events
     WHERE occurred_at >= ?
       AND occurred_at <= ?
       AND event_name = 'page_view'
     GROUP BY page
     ORDER BY views DESC
     LIMIT 10`,
    [start, end]
  );

  const events = all(
    `SELECT event_name name, COUNT(*) count
     FROM events
     WHERE occurred_at >= ? AND occurred_at <= ?
     GROUP BY event_name
     ORDER BY count DESC
     LIMIT 10`,
    [start, end]
  );

  const daily = all(
    `SELECT
       substr(occurred_at, 1, 10) day,
       COUNT(*) events,
       SUM(
         CASE
           WHEN event_name = 'page_view' THEN 1
           ELSE 0
         END
       ) page_views
     FROM events
     WHERE occurred_at >= ? AND occurred_at <= ?
     GROUP BY day
     ORDER BY day`,
    [start, end]
  );

  const sources = all(
    `SELECT source, COUNT(*) count
     FROM events
     WHERE occurred_at >= ? AND occurred_at <= ?
     GROUP BY source`,
    [start, end]
  );

  return {
    range: { from: start, to: end },
    summary: {
      total_events: Number(total),
      page_views: Number(pageViews),
      unique_visitors: Number(unique)
    },
    popular_pages: pages,
    top_events: events,
    daily,
    sources
  };
}

const server = http.createServer(async (req, res) => {
  try {
    await dbReady;
  } catch {
    return send(res, 500, {
      error: 'Database initialization failed'
    });
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    res.setHeader(
      'Access-Control-Allow-Origin',
      process.env.ALLOWED_ORIGIN ||
        'http://localhost:' + PORT
    );

    res.setHeader('Vary', 'Origin');

    try {
      if (
        req.method === 'GET' &&
        url.pathname === '/api/health'
      ) {
        return send(res, 200, { ok: true });
      }

      if (
        req.method === 'POST' &&
        url.pathname === '/api/events'
      ) {
        const body = await readBody(req);

        const items = Array.isArray(body.events)
          ? body.events
          : [body];

        if (items.length < 1 || items.length > 100) {
          return send(res, 400, {
            error: 'Send between 1 and 100 events'
          });
        }

        const saved = items.map(e => insert(e, 'browser'));

        return send(res, 202, {
          accepted: saved.length,
          events: saved
        });
      }

      if (
        req.method === 'POST' &&
        url.pathname === '/api/demo-order'
      ) {
        const body = await readBody(req);

        if (
          !validString(body.item, 120) ||
          typeof body.price !== 'number' ||
          !Number.isFinite(body.price) ||
          body.price < 0
        ) {
          return send(res, 400, {
            error: 'Valid item and price are required'
          });
        }

        const result = insert(
          {
            event_name: 'order_created',
            page_path: '/',
            properties: {
              item: body.item,
              price: body.price,
              currency: 'INR'
            }
          },
          'server'
        );

        return send(res, 201, {
          order_id: crypto.randomUUID(),
          status: 'created',
          ...result
        });
      }

      if (
        req.method === 'POST' &&
        url.pathname === '/api/server-events'
      ) {
        const expected = process.env.SERVER_TRACKING_KEY;

        if (
          expected &&
          req.headers['x-server-tracking-key'] !== expected
        ) {
          return send(res, 401, {
            error: 'Unauthorized server tracking request'
          });
        }

        const body = await readBody(req);
        const result = insert(body, 'server');

        return send(res, 202, result);
      }

      if (
        req.method === 'GET' &&
        url.pathname === '/api/dashboard'
      ) {
        return send(res, 200, dashboard(url));
      }

      if (
        req.method === 'GET' &&
        url.pathname === '/api/events'
      ) {
        const { start, end } = dateRange(url);

        const rows = all(
          `SELECT
             id,
             event_name,
             source,
             visitor_id,
             session_id,
             page_path,
             occurred_at,
             received_at,
             properties_json
           FROM events
           WHERE occurred_at >= ? AND occurred_at <= ?
           ORDER BY occurred_at DESC
           LIMIT 200`,
          [start, end]
        );

        return send(
          res,
          200,
          rows.map(r => ({
            ...r,
            properties: JSON.parse(r.properties_json)
          }))
        );
      }

      return send(res, 404, {
        error: 'API route not found'
      });
    } catch (e) {
      return send(res, e.status || 500, {
        error: e.status
          ? e.message
          : 'Internal server error'
      });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, {
      error: 'Method not allowed'
    });
  }

  const requested =
    url.pathname === '/'
      ? '/index.html'
      : decodeURIComponent(url.pathname);

  const resolved = path.resolve(publicDir, '.' + requested);

  if (
    !resolved.startsWith(path.resolve(publicDir) + path.sep)
  ) {
    return send(res, 403, {
      error: 'Forbidden'
    });
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      return send(
        res,
        404,
        'Not found',
        'text/plain; charset=utf-8'
      );
    }

    res.writeHead(200, {
      'Content-Type':
        MIME[path.extname(resolved)] ||
        'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

    res.end(data);
  });
});

const dbReady = initDb();

dbReady
  .then(() =>
    server.listen(PORT, () =>
      console.log(
        `Analytics demo running at http://localhost:${PORT}`
      )
    )
  )
  .catch(err => {
    console.error('Database initialization failed:', err);
    process.exitCode = 1;
  });

module.exports = { server, insert, dashboard };