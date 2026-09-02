const crypto = require('crypto');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createSessionToken(secret) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    scope: 'companion-portal',
    iat: now,
    exp: now + SESSION_TTL_MS
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { password } = JSON.parse(event.body);
    const correctPasswordHash = process.env.AUTH_PASSWORD_HASH;

    if (!correctPasswordHash) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'AUTH_PASSWORD_HASH is not configured' })
      };
    }

    const providedHash = crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');

    if (providedHash !== correctPasswordHash) {
      return {
        statusCode: 401,
        body: JSON.stringify({ authenticated: false, error: 'Incorrect password' })
      };
    }

    const sessionSecret = process.env.AUTH_SESSION_SECRET || correctPasswordHash;
    return {
      statusCode: 200,
      body: JSON.stringify({
        authenticated: true,
        token: createSessionToken(sessionSecret)
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Authentication failed', details: error.message })
    };
  }
};
