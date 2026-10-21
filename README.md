# Analytics SDK & Dashboard

A small end-to-end analytics system with a reusable browser SDK, server-side business event helper, HTTP ingestion API, SQLite persistence, dashboard reporting, and restaurant demo. This repository intentionally does not include a company name in its project metadata.

## Features

- Browser SDK: `page_view`, custom events, pseudonymous visitor/session IDs, batching, bounded retry queue, opt-out control.
- Server tracking: helper for trusted server-side business events; optional shared tracking key.
- Ingestion: validates event names and fields, accepts batches up to 100, stores event and receive timestamps.
- Dashboard: total events, page views, unique visitors, popular pages, event trends, event source split, date filtering.
- Restaurant demo: page views, menu/order button clicks, order-created server events, order confirmation events.
- SQLite database with indexes; Node built-in test runner.

## Prerequisites

1. **Node.js 20 or newer** (Node 22 LTS recommended). npm is included with Node.
2. **Internet connection only for the optional Google Fonts import**; the app itself uses local assets and does not require a frontend build.
3. A terminal: PowerShell, Windows Terminal, macOS Terminal, or Linux shell.
4. Git (optional, for publishing the repository).
5. A modern browser such as Chrome, Edge, or Firefox.

No separate database server, PHP, Composer, React build, Docker, or API client is required. SQLite is embedded through WebAssembly and the database file is created automatically. The project uses `sql.js` (SQLite compiled to WebAssembly), so it does not require Visual Studio C++ Build Tools or a separately installed database.

## Run locally (Windows)

1. Extract the ZIP to a folder, for example `D:\projects\analytics-sdk-dashboard`.
2. Open PowerShell in that folder.
3. Verify Node and npm:
   ```powershell
   node --version
   npm --version
   ```
   Node must be v20 or newer.
4. Install dependencies:
   ```powershell
   npm install
   ```
5. Start the application:
   ```powershell
   npm start
   ```
6. Open the demo at **http://localhost:3000**.
7. Open the dashboard at **http://localhost:3000/dashboard.html**.
8. Use the menu and click **Order now**. Wait a few seconds, then refresh the dashboard or wait for its automatic refresh.
9. Run the tests in a second terminal:
   ```powershell
   npm test
   ```
10. Stop the server with `Ctrl+C`. Data persists in `data/analytics.sqlite`.

### macOS / Linux

The same commands work from the extracted project directory:
```bash
node --version
npm --version
npm install
npm start
```
Then visit `http://localhost:3000`.

## Quick verification

- Health endpoint: `GET http://localhost:3000/api/health`
- Dashboard API: `GET http://localhost:3000/api/dashboard`
- Recent events API: `GET http://localhost:3000/api/events`
- Browser ingestion: `POST http://localhost:3000/api/events`
- Server ingestion: `POST http://localhost:3000/api/server-events`

Example browser event:
```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d "{\"event_name\":\"button_clicked\",\"visitor_id\":\"visitor-demo\",\"page_path\":\"/\",\"properties\":{\"button\":\"menu\"}}"
```

## Browser SDK integration

Add the SDK script and initialize it after loading the script:
```html
<script src="https://your-host.example/sdk/analytics.js"></script>
<script>
  const analytics = new AnalyticsSDK({
    endpoint: "https://your-api.example"
  });
  analytics.pageView({ page: "home" });
  analytics.track("signup_started", { plan: "starter" });
  // analytics.setConsent(false); // disable collection and clear queued events
</script>
```

The SDK stores a random visitor ID and session ID in local storage. The current demo uses a persistent session ID for simplicity; a production implementation should rotate session IDs after an inactivity threshold or on session boundaries. Never put sensitive or personally identifying data in event properties.

## Server-side integration

Import the helper from trusted Node.js backend code:
```js
const { trackServerEvent } = require('./src/server-tracker');

await trackServerEvent({
  endpoint: 'http://localhost:3000',
  // Optional; configure SERVER_TRACKING_KEY on the analytics server too.
  key: process.env.SERVER_TRACKING_KEY,
  eventName: 'order_created',
  pagePath: '/checkout',
  properties: { item: 'Garden Pesto Pasta', price: 349, currency: 'INR' }
});
```

The demo sends `order_created` from the server event endpoint to demonstrate a business event. For a production application, emit the event from the same trusted backend transaction that persists the order, and use an outbox or queue if delivery must survive failures.

## Event model

```json
{
  "event_name": "page_view",
  "source": "browser",
  "visitor_id": "random-pseudonymous-id",
  "session_id": "random-session-id",
  "page_path": "/menu",
  "occurred_at": "2026-10-21T12:00:00.000Z",
  "properties": { "title": "Menu" }
}
```

The server generates an event UUID and `received_at`. `source` is assigned by the ingestion route, not trusted from the browser payload. Properties are shallow, scalar-only, bounded in count and string length. Events with malformed or implausibly old/future timestamps fall back to server time.

## Architecture

```text
Browser SDK ── POST /api/events ───────┐
                                      ├── Node HTTP API ── SQLite
Restaurant demo ── server event API ──┘        │
                                               └── Dashboard query API
                                                        │
                                                  Dashboard UI
```

- One Node process serves static pages and JSON APIs.
- SQLite is embedded, indexed by event time, event name, and visitor ID.
- Dashboard metrics are queried from persisted events and filtered by UTC date boundaries.
- The dashboard polls every 15 seconds and can also be refreshed manually with the date filter.

## API contract

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/events` | Browser event or `{ "events": [...] }` batch (up to 100) |
| `POST` | `/api/server-events` | Trusted server business event |
| `GET` | `/api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` | Aggregated metrics |
| `GET` | `/api/events?from=YYYY-MM-DD&to=YYYY-MM-DD` | Up to 200 most recent events |

## Configuration

- `PORT`: HTTP port (default `3000`)
- `DATA_DIR`: directory for SQLite database (default `./data`)
- `SERVER_TRACKING_KEY`: if set, server-event requests must include matching `x-server-tracking-key`
- `ALLOWED_ORIGIN`: expected browser origin for API response CORS header (default local origin)

PowerShell example:
```powershell
$env:SERVER_TRACKING_KEY = "replace-with-a-long-random-secret"
$env:ALLOWED_ORIGIN = "http://localhost:3000"
npm start
```

When setting `SERVER_TRACKING_KEY`, the demo's browser-side fallback request to `/api/server-events` will no longer work—which is intentional because a secret must never be shipped to the browser. To demo authenticated server events, use the server helper from a trusted backend process or leave the key unset for local-only demonstration. Do not expose this endpoint publicly without authentication and rate limiting.

## Assumptions and key decisions

- **Identity:** random pseudonymous visitor and session IDs; no login identity or fingerprinting.
- **Time:** event timestamps are ISO-8601 and normalized to UTC; dashboard date filters are interpreted as UTC.
- **Delivery:** browser events are queued in memory and retried after failures, with a queue cap. Events may be lost if the page closes before a successful flush.
- **Storage:** SQLite is suitable for a single-process assignment demo; it is not a horizontally scaled event store. The WebAssembly implementation exports the database to disk after writes, which is simple but less efficient for high-volume ingestion.
- **Business events:** server source is assigned by endpoint; production must secure server ingestion and emit after the business transaction commits.
- **Privacy:** no IP address, user agent, cookies beyond local random IDs, or sensitive properties are intentionally stored.
- **Reliability:** the browser SDK retries but does not guarantee exactly-once delivery. This demo does not implement idempotency keys or deduplication.

## Security, correctness, and tradeoffs

- JSON request size is capped; batch size, event names, property keys, and property values are bounded.
- SQL values are parameterized. Dashboard output escapes values before rendering.
- Optional shared key can protect server tracking. For public deployment, add authentication, rate limiting, HTTPS, origin allow-list enforcement, abuse monitoring, and secret rotation.
- The browser route is public by design and can be spammed; do not deploy it publicly without rate limiting and quotas.
- This is an assignment-grade implementation, not a hardened production analytics platform.

## Tests

```bash
npm test
```
The included tests perform static checks for the browser SDK API and server tracking helper. Before submission, also manually verify event ingestion, date filters, invalid JSON, unknown API routes, and the order flow. Further improvements would include integration tests against a temporary SQLite database, consent persistence, retry backoff, queue persistence, server authentication tests, and browser automation.

## Known limitations

- No authentication or dashboard access control.
- SQLite and one Node process only.
- Dashboard's server-event count is based on the most recent 200 event rows returned by the event-list endpoint; the source split and total metrics use full SQL aggregates. For larger datasets, add a dedicated server-event aggregate to the dashboard API.
- Browser retries are in-memory, bounded, and not exactly-once.
- Session IDs do not rotate automatically.
- The restaurant demo's order is simulated; it is not a payment or inventory system.
- Browser/server event delivery isn't atomic with order creation; production should use a transactional outbox.
- No automated UI/end-to-end browser tests are included.
- Google Fonts is optional and can be removed for a fully offline visual experience.

## Submission checklist

- Create a public repository with a neutral name such as `analytics-sdk-dashboard` (do not use the company name in repository name, description, README, or submitted materials).
- Push this folder to GitHub/GitLab and verify the repository can be viewed without signing in.
- Record a short demo showing the restaurant page, a page view/custom event, placing an order, and the updated dashboard with date filtering. Explain the SDK, API, identity model, storage, and tradeoffs.
- Record a separate 1–2 minute introduction video about your background and a recent project or technical challenge.
- Upload videos to a shareable location and test links in a private/incognito browser window.
