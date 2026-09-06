// ============================================
// PROVASPACE — Netlify Function: ai
// Proxies OpenRouter calls so the API key never touches the browser.
//
// Env var to set in Netlify Dashboard → Site → Environment Variables:
//   OPENROUTER_API_KEY  = sk-or-v1-...
//   PUSH_SECRET         = (same secret used in send-push.js)
// ============================================

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Same shared secret check as send-push
  const auth = event.headers['x-push-secret'];
  if (auth !== process.env.PUSH_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { model, messages, temperature } = body;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://provaspace.netlify.app',
        'X-Title': 'Provaspace Silver Surfer',
      },
      body: JSON.stringify({ model, messages, temperature }),
    });

    const data = await res.json();

    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('ai proxy error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};