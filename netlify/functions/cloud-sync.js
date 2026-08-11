const crypto = require('crypto');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function getPortalPassword() {
  return (process.env.PORTAL_PASSWORD || '').trim();
}

function createPortalToken() {
  const password = getPortalPassword();
  if (!password) return '';
  const secret = process.env.OPENAI_API_KEY || 'tatjana-portal';
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

function isAuthorized(event) {
  if (!getPortalPassword()) return true;
  const token = event.headers['x-portal-auth'] || event.headers['X-Portal-Auth'];
  return Boolean(token) && token === createPortalToken();
}

function cloudflareConfig() {
  return {
    accountId: (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    namespaceId: (process.env.CLOUDFLARE_KV_NAMESPACE_ID || '').trim(),
    token: (process.env.CLOUDFLARE_API_TOKEN || '').trim()
  };
}

function requireCloudflareConfig() {
  const config = cloudflareConfig();
  const missing = [];
  if (!config.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!config.namespaceId) missing.push('CLOUDFLARE_KV_NAMESPACE_ID');
  if (!config.token) missing.push('CLOUDFLARE_API_TOKEN');
  return { config, missing };
}

function kvUrl(config, path = '') {
  return `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}${path}`;
}

async function cloudflareRequest(config, path, options = {}) {
  const response = await fetch(kvUrl(config, path), {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof data === 'string' ? data : data.errors?.[0]?.message || 'Cloudflare request failed';
    throw new Error(message);
  }
  return data;
}

function sanitizeThread(thread) {
  if (!thread || typeof thread !== 'object') return null;
  if (!thread.id || typeof thread.id !== 'string') return null;
  return {
    id: thread.id,
    title: String(thread.title || 'Gespraech'),
    messages: Array.isArray(thread.messages) ? thread.messages : [],
    createdAt: thread.createdAt || new Date().toISOString(),
    updatedAt: thread.updatedAt || new Date().toISOString(),
    syncedAt: new Date().toISOString()
  };
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return json(401, { error: 'Nicht angemeldet.', type: 'portal_auth_required' });
  }

  const { config, missing } = requireCloudflareConfig();
  if (missing.length) {
    return json(501, {
      error: 'Cloud Sync ist vorbereitet, aber noch nicht konfiguriert.',
      missing
    });
  }

  try {
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.rawQuery || '');
      const action = params.get('action') || 'list';

      if (action === 'list') {
        const list = await cloudflareRequest(config, '/keys?prefix=thread:');
        const keys = list.result || [];
        const threads = [];
        for (const key of keys.slice(0, 100)) {
          const value = await cloudflareRequest(config, `/values/${encodeURIComponent(key.name)}`);
          const parsed = typeof value === 'string' ? JSON.parse(value) : value;
          if (parsed?.id) threads.push(parsed);
        }
        return json(200, { threads });
      }

      if (action === 'get') {
        const id = params.get('id');
        if (!id) return json(400, { error: 'Thread-ID fehlt.' });
        const value = await cloudflareRequest(config, `/values/${encodeURIComponent(`thread:${id}`)}`);
        return json(200, { thread: typeof value === 'string' ? JSON.parse(value) : value });
      }

      return json(400, { error: 'Unbekannte Cloud-Sync-Aktion.' });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.action === 'saveThread') {
        const thread = sanitizeThread(body.thread);
        if (!thread) return json(400, { error: 'Ungueltiger Thread.' });
        await cloudflareRequest(config, `/values/${encodeURIComponent(`thread:${thread.id}`)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: JSON.stringify(thread)
        });
        return json(200, { ok: true, threadId: thread.id, syncedAt: thread.syncedAt });
      }

      return json(400, { error: 'Unbekannte Cloud-Sync-Aktion.' });
    }

    return json(405, { error: 'Methode nicht erlaubt.' });
  } catch (error) {
    return json(500, { error: error.message || 'Cloud Sync Fehler.' });
  }
};
