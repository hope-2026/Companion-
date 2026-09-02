Cloudflare KV Workers sync package
==================================

This folder contains the files for adding cross-device Cloudflare KV sync to the Companion starter pack GPT-4o threads IndexedDB portal.

Context window
--------------

The included index.html now has a sidebar context-window setting. It defaults to
10 recent messages from the current thread to keep API costs manageable. Users
can enter a higher number to send more recent messages, or enter 0 to send the
whole saved current thread, subject to OpenAI's current context limit. Larger
context can improve continuity, but it can also cost more, slow responses, or
fail if the selected thread history is too large.

What actually worked in Cloudflare
----------------------------------

Use this route:

1. Create a new Worker in Cloudflare
2. Click Start with Hello World!
3. Click Deploy first to create the Worker
4. Open Edit code
5. Replace worker.js with the contents of cloudflare-worker.js
6. Deploy again
7. Add the KV binding PORTAL_STORAGE
8. Add the secret CLOUDFLARE_SYNC_TOKEN
9. Deploy again
10. If you created a new Worker, update Netlify env var CLOUDFLARE_SYNC_WORKER_URL to the new Worker URL

Do not choose Upload your static files. That creates the wrong kind of service for this setup.

Files:

- KV-Cloudflare-Workers-sync-guide.html
  Step-by-step setup guide.

- cloudflare-worker.js
  Cloudflare Worker script. Copy the contents of this file into Cloudflare's worker.js editor.

- wrangler.toml
  Wrangler configuration template. Replace PASTE_YOUR_KV_NAMESPACE_ID_HERE with the user's KV namespace ID.

- index.html
  Updated portal file based on the GPT-4o threads IndexedDB starter. Includes thread list search, full conversation search, Markdown export, Markdown restore and JSON restore. The user still needs to add their companion name and base prompt.

- netlify.toml
  Netlify configuration.

- netlify/functions/auth-check.js
  Netlify password/session function.

- netlify/functions/cloudflare-sync-proxy.js
  Auth-protected Netlify proxy that keeps the Cloudflare Worker bearer token server-side.

- netlify/functions/openai-proxy.js
  Auth-protected OpenAI proxy from the GPT-4o threads IndexedDB starter pack. Use this included copy, or make sure the user's existing openai-proxy.js verifies the same portal session token before calling OpenAI.

- hash-password.mjs
- package.json
  Helper script for creating AUTH_PASSWORD_HASH.

Important:

- Do not put secret values inside index.html.
- Use Netlify environment variables for AUTH_PASSWORD_HASH, AUTH_SESSION_SECRET, CLOUDFLARE_SYNC_TOKEN, CLOUDFLARE_SYNC_WORKER_URL and OPENAI_API_KEY.
- The password gate must protect both the visible portal and the paid model proxy. The included index.html sends the session token to openai-proxy.js, and the included openai-proxy.js rejects unauthorised calls.
- Use a Cloudflare Worker secret for CLOUDFLARE_SYNC_TOKEN.
- Use a Cloudflare Worker KV binding called PORTAL_STORAGE for the namespace itself.
- In short: PORTAL_STORAGE is the binding, CLOUDFLARE_SYNC_TOKEN is the secret.

PRE-DEPLOY CHECK:
Before deploying, search index.html for any line containing three backtick characters.
Those marks are only used in guides to display code blocks. They must not be pasted into index.html.
If the portal opens with only the header and no chat/interface, check this first.

PWA / PHONE INSTALL:
This pack includes Ellivien-branded PWA files:

- manifest.webmanifest
- service-worker.js
- pwa-icon.png

These let the portal be added to a phone home screen and opened like an app. The installed app name is Ellivien and the icon uses the Ellivien E logo. If you want custom app branding/name/icon later, ask Ellivien about a small branding change.
