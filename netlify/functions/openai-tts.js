// netlify/functions/openai-tts.js
// Secure OpenAI text-to-speech proxy for Tatjana's read-aloud button.

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
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const sessionSecret = process.env.AUTH_SESSION_SECRET || process.env.AUTH_PASSWORD_HASH;
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

  if (!process.env.OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'OPENAI_API_KEY is not configured' })
    };
  }

  try {
    const { input } = JSON.parse(event.body || '{}');
    const text = String(input || '').trim().slice(0, 6000);
    if (!text) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing text input' })
      };
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: process.env.OPENAI_TTS_VOICE || 'nova',
        input: text,
        instructions: 'Sprich Deutsch warm, weiblich, ruhig und natuerlich. Lies Emojis, Markdown-Zeichen und technische Formatierung nicht mit.',
        format: 'mp3'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'TTS request failed', details: errorText })
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ audioBase64, mimeType: 'audio/mpeg' })
    };
  } catch (error) {
    console.error('TTS error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
