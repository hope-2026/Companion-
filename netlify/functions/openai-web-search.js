// netlify/functions/openai-web-search.js
// Secure OpenAI web-search helper for current information with sources.

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

function collectSources(responseData) {
  const sources = new Map();
  const output = Array.isArray(responseData?.output) ? responseData.output : [];

  output.forEach(item => {
    const actionSources = item?.action?.sources;
    if (Array.isArray(actionSources)) {
      actionSources.forEach(source => {
        if (source?.url) sources.set(source.url, source.title || source.url);
      });
    }

    const contentItems = Array.isArray(item?.content) ? item.content : [];
    contentItems.forEach(content => {
      const annotations = Array.isArray(content?.annotations) ? content.annotations : [];
      annotations.forEach(annotation => {
        const url = annotation?.url || annotation?.uri;
        if (url) sources.set(url, annotation?.title || url);
      });
    });
  });

  return Array.from(sources, ([url, title]) => ({ url, title })).slice(0, 8);
}

function getOutputText(responseData) {
  if (typeof responseData?.output_text === 'string') return responseData.output_text.trim();
  const output = Array.isArray(responseData?.output) ? responseData.output : [];
  return output
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .map(content => content?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
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
    const { query } = JSON.parse(event.body || '{}');
    const cleanQuery = String(query || '').trim().slice(0, 1200);
    if (!cleanQuery) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing search query' })
      };
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_WEB_SEARCH_MODEL || 'gpt-4o',
        tools: [{ type: 'web_search' }],
        input: [
          {
            role: 'system',
            content: 'Recherchiere nur echte aktuelle Informationen im Web. Antworte knapp auf Deutsch. Nenne keine Quellen, die du nicht verwendet hast.'
          },
          {
            role: 'user',
            content: cleanQuery
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Web search failed', details: data })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        summary: getOutputText(data),
        sources: collectSources(data)
      })
    };
  } catch (error) {
    console.error('Web search error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
