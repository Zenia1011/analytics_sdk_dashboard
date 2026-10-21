const $ = id => document.getElementById(id);

const today = new Date();
const week = new Date(Date.now() - 6 * 86400000);

const iso = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

$('from').value = iso(week);
$('to').value = iso(today);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function table(rows, first, count) {
  if (!rows.length) {
    return '<p class="empty">No events for this date range yet. Visit the restaurant demo and place an order.</p>';
  }

  return `
    <table>
      <thead>
        <tr>
          <th>${first}</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${esc(r.page ?? r.name)}</td>
            <td>${r.views ?? r.count}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderTrend(rows) {
  const data = rows.slice(-14);
  const max = Math.max(1, ...data.map(x => x.events));

  if (!data.length) {
    $('trend').innerHTML = '<p class="empty">No events yet. Interact with the restaurant demo first.</p>';
    return;
  }

  const width = 640;
  const height = 210;
  const left = 38;
  const bottom = 35;
  const top = 15;
  const innerH = height - top - bottom;
  const step = (width - left - 10) / data.length;

  const points = data.map((d, i) =>
    `${left + i * step + step / 2},${top + innerH - (d.events / max) * innerH}`
  ).join(' ');

  const bars = data.map((d, i) => {
    const h = (d.events / max) * innerH;
    const x = left + i * step + step * .2;
    const y = top + innerH - h;

    return `
      <rect
        x="${x}"
        y="${y}"
        width="${step * .6}"
        height="${h}"
        rx="4"
        fill="#426b55"
      />
      <text
        x="${x + step * .3}"
        y="${height - 12}"
        text-anchor="middle"
        font-size="10"
        fill="#777"
      >${esc(d.day.slice(5))}</text>
    `;
  }).join('');

  $('trend').innerHTML = `
    <svg
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="Daily event counts"
    >
      ${[0, .5, 1].map(t => `
        <line
          x1="${left}"
          y1="${top + innerH * (1 - t)}"
          x2="${width}"
          y2="${top + innerH * (1 - t)}"
          stroke="#e9e7e1"
        />
        <text
          x="25"
          y="${top + innerH * (1 - t) + 4}"
          font-size="10"
          fill="#777"
          text-anchor="end"
        >${Math.round(max * t)}</text>
      `).join('')}
      ${bars}
    </svg>
  `;
}

function renderBars(rows) {
  const total = rows.reduce((n, r) => n + r.count, 0) || 1;

  $('sources').innerHTML = rows.length
    ? rows.map(r => `
        <div class="bar-row">
          <div>
            <span>${esc(r.source)}</span>
            <strong>${r.count}</strong>
          </div>
          <div class="bar-track">
            <div style="width:${Math.max(2, r.count / total * 100)}%"></div>
          </div>
        </div>
      `).join('')
    : '<p class="empty">No source data yet.</p>';
}

async function load() {
  if ($('from').value > $('to').value) {
    $('status').textContent = 'Choose a start date on or before the end date.';
    return;
  }

  $('status').textContent = 'Refreshing…';

  try {
    const q = new URLSearchParams({
      from: $('from').value,
      to: $('to').value
    });

    const [dash, events] = await Promise.all([
      fetch('/api/dashboard?' + q),
      fetch('/api/events?' + q)
    ]);

    if (!dash.ok || !events.ok) {
      throw new Error('API request failed');
    }

    const d = await dash.json();
    const e = await events.json();

    $('total').textContent =
      d.summary.total_events.toLocaleString();

    $('views').textContent =
      d.summary.page_views.toLocaleString();

    $('visitors').textContent =
      d.summary.unique_visitors.toLocaleString();

    $('server').textContent =
      e.filter(x => x.source === 'server').length.toLocaleString() +
      (e.length === 200 ? '+' : '');

    renderTrend(d.daily);
    renderBars(d.sources);

    $('pages').innerHTML =
      table(d.popular_pages, 'Page', 'Views');

    $('events').innerHTML =
      table(d.top_events, 'Event', 'Count');

    $('status').textContent =
      `Showing ${d.range.from.slice(0, 10)} to ${d.range.to.slice(0, 10)} · refreshed ${new Date().toLocaleTimeString()}`;

  } catch (err) {
    $('status').textContent =
      'Could not load analytics. Check that the server is running.';
  }
}

$('apply').addEventListener('click', load);

load();

setInterval(load, 15000);