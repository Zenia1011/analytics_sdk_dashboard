async function trackServerEvent({
  endpoint = 'http://localhost:3000',
  key,
  eventName,
  visitorId = null,
  sessionId = null,
  pagePath = null,
  properties = {}
}) {
  if (!eventName) {
    throw new Error('eventName is required');
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (key) {
    headers['x-server-tracking-key'] = key;
  }

  const response = await fetch(
    endpoint.replace(/\/$/, '') + '/api/server-events',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_name: eventName,
        visitor_id: visitorId,
        session_id: sessionId,
        page_path: pagePath,
        properties
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Analytics tracking failed (${response.status})`
    );
  }

  return response.json();
}

module.exports = { trackServerEvent };