export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const expectedSyncToken = env.CLOUDFLARE_SYNC_TOKEN || env.SYNC_BEARER_TOKEN;

    if (
      url.pathname.startsWith('/api/') ||
      url.pathname === '/sync' ||
      url.pathname.startsWith('/sync/')
    ) {
      const authHeader = request.headers.get('Authorization') || '';
      const suppliedToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';

      if (!expectedSyncToken || suppliedToken !== expectedSyncToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer'
          }
        });
      }
    }

    function jsonResponse(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    try {
      if (url.pathname === '/api/thread-index') {
        if (request.method === 'GET') {
          const stored = await env.PORTAL_STORAGE.get('thread-index');
          return jsonResponse(stored ? JSON.parse(stored) : { threadIds: [], claudiusThreadIds: [] });
        }

        if (request.method === 'POST') {
          const payload = await request.json();
          const stored = await env.PORTAL_STORAGE.get('thread-index');
          const existing = stored ? JSON.parse(stored) : {};
          const incomingThreadIds = Array.isArray(payload.threadIds) ? payload.threadIds : [];
          const existingThreadIds = Array.isArray(existing.threadIds) ? existing.threadIds : [];
          const deletedThreadIds = Array.isArray(payload.deletedThreadIds) ? payload.deletedThreadIds : [];
          const threadIds = Array.from(new Set([...existingThreadIds, ...incomingThreadIds]))
            .filter(id => !deletedThreadIds.includes(id))
            .sort();
          const claudiusThreadIds = Array.isArray(payload.claudiusThreadIds)
            ? payload.claudiusThreadIds
            : (Array.isArray(existing.claudiusThreadIds) ? existing.claudiusThreadIds : []);
          const nextPayload = {
            ...existing,
            ...payload,
            threadIds,
            claudiusThreadIds
          };
          delete nextPayload.deletedThreadIds;
          await env.PORTAL_STORAGE.put('thread-index', JSON.stringify({
            ...nextPayload
          }));
          return jsonResponse({ success: true, threadIds, claudiusThreadIds });
        }
      }

      const threadMatch = url.pathname.match(/^\/api\/thread\/([^/]+)$/);
      if (threadMatch) {
        const threadId = decodeURIComponent(threadMatch[1]);
        const key = `thread:${threadId}`;

        if (request.method === 'GET') {
          const stored = await env.PORTAL_STORAGE.get(key);
          if (!stored) return jsonResponse({ error: 'Thread not found' }, 404);
          return jsonResponse(JSON.parse(stored));
        }

        if (request.method === 'POST') {
          const thread = await request.json();
          await env.PORTAL_STORAGE.put(key, JSON.stringify(thread));
          return jsonResponse({ success: true, threadId });
        }

        if (request.method === 'DELETE') {
          await env.PORTAL_STORAGE.delete(key);
          return jsonResponse({ success: true, threadId });
        }
      }

      if (url.pathname === '/api/threads') {
        if (request.method === 'GET') {
          const stored = await env.PORTAL_STORAGE.get('threads');
          const threads = stored ? JSON.parse(stored) : {};
          return jsonResponse({ threads });
        }

        if (request.method === 'POST') {
          const { threads } = await request.json();
          await env.PORTAL_STORAGE.put('threads', JSON.stringify(threads || {}));
          return jsonResponse({ success: true });
        }
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      return jsonResponse({ error: error.message || 'Worker error' }, 500);
    }
  }
};
