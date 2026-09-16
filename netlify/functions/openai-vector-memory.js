// netlify/functions/openai-vector-memory.js
// Auth-protected OpenAI vector-store lookup for Tatjana's long-term memory.

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

function extractTextFromResult(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts
    .map(part => typeof part?.text === 'string' ? part.text.trim() : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractMemoryMetadata(text) {
  const heading = text.match(/^##\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.+)$/m);
  const topic = text.match(/^Thema:\s*(.+)$/m);
  const period = text.match(/^Zeitraum laut Export:\s*(.+)$/m);

  return {
    date: heading?.[1] || '',
    title: heading?.[2]?.trim() || '',
    topic: topic?.[1]?.trim() || '',
    period: period?.[1]?.trim() || ''
  };
}

function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getCuratedMemoryBoost(memory, searchQuery) {
  const query = normalizeForSearch(searchQuery);
  const filename = normalizeForSearch(memory.filename);
  let boost = 0;

  if (query.includes('norddeich') && filename.includes('tatjana-norddeich-cluster')) {
    boost += 0.35;
  }

  return boost;
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

  const vectorStoreId = process.env.MEMORY_VECTOR_STORE_ID;
  if (!vectorStoreId) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memories: [], configured: false })
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
    const searchQuery = String(query || '').trim();

    if (!searchQuery) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memories: [], configured: true })
      };
    }

    const response = await fetch(`https://api.openai.com/v1/vector_stores/${encodeURIComponent(vectorStoreId)}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        query: searchQuery,
        max_num_results: 10
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Vector memory search failed', details: data })
      };
    }

    const memories = (Array.isArray(data?.data) ? data.data : [])
      .map(result => {
        const text = extractTextFromResult(result).slice(0, 2200);
        const metadata = extractMemoryMetadata(text);
        return {
          filename: result.filename || '',
          score: result.score,
          ...metadata,
          text
        };
      })
      .filter(memory => memory.text)
      .sort((a, b) => {
        const scoreA = Number(a.score) || 0;
        const scoreB = Number(b.score) || 0;
        return (scoreB + getCuratedMemoryBoost(b, searchQuery)) - (scoreA + getCuratedMemoryBoost(a, searchQuery));
      })
      .slice(0, 5);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memories, configured: true, query: searchQuery })
    };
  } catch (error) {
    console.error('Vector memory error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
