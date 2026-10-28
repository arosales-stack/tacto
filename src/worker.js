// Tacto — private Worker.
//   /            image optimizer (Tacto team), password TOOLS_PASSWORD
//   /<client>    that client's CMS (e.g. /gutea), password from the client's config
//
// Secrets (set in Cloudflare, never in code):
//   TOOLS_PASSWORD, OPENAI_API_KEY, GITHUB_TOKEN, and one CMS password per client (e.g. GUTEA_CMS_PASSWORD)

import { checkPassword, sessionCookie, clearCookie, hasSession, redirect, json } from './auth.js';
import { clients } from './clients/index.js';
import { handleCms } from './cms.js';

const COOKIE = 'tacto_session';
const OPENAI_EDITS = 'https://api.openai.com/v1/images/edits';

// Files anyone can load: login page styles, logos, and the CMS front-end (no data in them)
const PUBLIC_PATHS = [/^\/app\.css$/, /^\/logo\.png$/, /^\/cms\//, /^\/clients\/[\w-]+\//];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (PUBLIC_PATHS.some((re) => re.test(url.pathname))) return env.ASSETS.fetch(request);

    // Client CMS: /gutea, /gutea/login, /gutea/api/...
    const clientId = url.pathname.split('/')[1];
    if (clients[clientId]) return handleCms(request, env, clients[clientId], url);

    // Tacto tools
    if (url.pathname === '/login') {
      return request.method === 'POST' ? login(request, env) : loginPage();
    }
    if (url.pathname === '/logout') return redirect('/login', clearCookie(COOKIE));

    if (!(await hasSession(request, COOKIE, env.TOOLS_PASSWORD))) {
      return url.pathname.startsWith('/api/') ? json({ error: 'Not logged in' }, 401) : redirect('/login');
    }

    if (url.pathname === '/api/images/edit' && request.method === 'POST') {
      return proxyImageEdit(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// ---------- Image edit proxy ----------
// The browser builds the multipart form OpenAI expects (model, prompt, image[], ...).
// The Worker only adds the API key and streams the body through, so it uses almost no CPU.
async function proxyImageEdit(request, env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY is not set in Cloudflare' }, 500);
  const upstream = await fetch(OPENAI_EDITS, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': request.headers.get('Content-Type'),
    },
    body: request.body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Retry-After': upstream.headers.get('Retry-After') ?? '',
    },
  });
}

// ---------- Tacto login ----------
async function login(request, env) {
  const form = await request.formData();
  if (!(await checkPassword(form.get('password'), env.TOOLS_PASSWORD))) return loginPage('Wrong password');
  return redirect('/', await sessionCookie(COOKIE, env.TOOLS_PASSWORD));
}

function loginPage(error = '') {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tacto — Login</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="/app.css"></head>
<body class="login">
  <form method="POST" action="/login" class="login__box">
    <img class="login__logo" src="/logo.png" alt="Tacto" width="640" height="200">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
    ${error ? `<p class="error">${error}</p>` : ''}
    <button class="btn btn--primary" type="submit">Enter</button>
  </form>
</body></html>`, { status: error ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
