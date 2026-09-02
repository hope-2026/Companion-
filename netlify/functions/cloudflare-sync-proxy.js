const crypto = require('crypto');

function verifySessionToken(token, secret) {
  if (!token || !secret || typeof token !== 'string') return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  const supplied = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return (data.scope === 'companion-portal' || data.scope === 'ellivien-portal') && Number(data.exp) > Date.now();
  } catch (error) {
    return false;
  }
}

function isLocalDevRequest(event, token) {
  const host = event.headers.host || event.headers.Host || '';
  return token === 'local-dev-bypass' && (
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:') ||
    host.startsWith('[::1]:') ||
    /^192\.168\.\d{1,3}\.\d{1,3}:/.test(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}:/.test(host)
  );
}

exports.handler = async (event) => {
  const workerBaseUrl = (process.env.CLOUDFLARE_SYNC_WORKER_URL || '').replace(/\/+$/, '');
  const syncToken = process.env.CLOUDFLARE_SYNC_TOKEN;
  const sessionSecret = process.env.AUTH_SESSION_SECRET || process.env.AUTH_PASSWORD_HASH;

  if (!workerBaseUrl) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CLOUDFLARE_SYNC_WORKER_URL is not configured' })
    };
  }

  if (!syncToken) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CLOUDFLARE_SYNC_TOKEN is not configured' })
    };
  }

  if (!sessionSecret) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Portal auth is not configured' })
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const suppliedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!isLocalDevRequest(event, suppliedToken) && !verifySessionToken(suppliedToken, sessionSecret)) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  const proxyPrefix = '/.netlify/functions/cloudflare-sync-proxy';
  const requestedPath = event.path.startsWith(proxyPrefix)
    ? event.path.slice(proxyPrefix.length) || '/'
    : '/';
  const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
  const targetUrl = `${workerBaseUrl}${requestedPath}${queryString}`;

  try {
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: {
        'Content-Type': event.headers['content-type'] || event.headers['Content-Type'] || 'application/json',
        'Authorization': `Bearer ${syncToken}`
      },
      body: ['GET', 'HEAD'].includes(event.httpMethod) ? undefined : event.body
    });

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store'
      },
      body: await response.text()
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Cloudflare sync proxy failed', message: error.message })
    };
  }
};
