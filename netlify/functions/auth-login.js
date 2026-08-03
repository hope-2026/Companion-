const crypto = require('crypto');

function getPortalPassword() {
  return (process.env.PORTAL_PASSWORD || '').trim();
}

function createPortalToken() {
  const password = getPortalPassword();
  if (!password) return '';
  const secret = process.env.OPENAI_API_KEY || 'tatjana-portal';
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const configuredPassword = getPortalPassword();
  if (!configuredPassword) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ enabled: false, token: '' })
    };
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (password !== configuredPassword) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Falsches Passwort' })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ enabled: true, token: createPortalToken() })
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Ungueltige Anfrage' })
    };
  }
};
