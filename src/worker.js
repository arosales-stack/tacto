// Tacto Worker — one Worker for the agency site, the team tools and every client CMS.
//
//   /, /assets/*, other site pages   public agency site (built from site/ into dist/)
//   POST /api/contact                public contact form → KV
//   /login, /logout                  Tacto team login (TOOLS_PASSWORD)
//   /outils, /outils/*               team only: photo tool, /outils/messages (contact inbox)
//   POST /api/images/edit            team only: OpenAI image proxy used by the photo tool
//   /<client>, /<client>/*           that client's CMS (e.g. /gutea), password from the client's config
//   /cms/*, /clients/*, /app.css, /logo.png   static files for the login + CMS pages (no data in them)
//
// Every response goes through secure() (security headers). Secrets live in Cloudflare only:
//   TOOLS_PASSWORD, OPENAI_API_KEY, GITHUB_TOKEN, one CMS password per client (e.g. GUTEA_CMS_PASSWORD)

import { checkPassword, sessionCookie, clearCookie, hasSession, redirect, json } from './auth.js';
import { clients } from './clients/index.js';
import { handleCms } from './cms.js';
import { receiveContact, messagesPage } from './contact.js';
import { secure, sameOrigin, tooMany, LIMITS } from './security.js';

const COOKIE = 'tacto_session';
const OPENAI_EDITS = 'https://api.openai.com/v1/images/edits';
const TEAM_ONLY = /^\/(outils|api\/images)(\/|$)/;
const APP_PATHS = /^\/(login|logout|outils|api|cms|clients|app\.css|logo\.png)(\/|$)/; // not part of the public site

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const clientId = url.pathname.split('/')[1];
    const isClient = Boolean(clients[clientId]);
    const kind = isClient || APP_PATHS.test(url.pathname) ? 'app' : 'site';
    return secure(await route(request, env, url, clientId, isClient), kind);
  },
};

async function route(request, env, url, clientId, isClient) {
  if (request.method === 'POST' && !sameOrigin(request, url)) return json({ error: 'Forbidden' }, 403);

  if (url.pathname === '/api/contact' && request.method === 'POST') return receiveContact(request, env);

  if (isClient) {
    if (url.pathname === `/${clientId}/login` && request.method === 'POST'
      && await tooMany(env, request, `login:${clientId}`, LIMITS.login.max, LIMITS.login.window)) {
      return new Response('Trop de tentatives. Réessaie dans 15 minutes.', { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return handleCms(request, env, clients[clientId], url);
  }

  if (url.pathname === '/login') return request.method === 'POST' ? login(request, env) : loginPage();
  if (url.pathname === '/logout') return redirect('/login', clearCookie(COOKIE));

  if (TEAM_ONLY.test(url.pathname)) {
    if (!(await hasSession(request, COOKIE, env.TOOLS_PASSWORD))) {
      return url.pathname.startsWith('/api/') ? json({ error: 'Not logged in' }, 401) : redirect('/login');
    }
    if (url.pathname === '/api/images/edit' && request.method === 'POST') return proxyImageEdit(request, env);
    if (url.pathname === '/outils/messages') return messagesPage(env);
  }

  // Everything else is a static file from dist/ (unknown paths get dist/404.html)
  return env.ASSETS.fetch(request);
}

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
  if (await tooMany(env, request, 'login:tools', LIMITS.login.max, LIMITS.login.window)) {
    return loginPage('Too many attempts. Try again in 15 minutes.', 429);
  }
  const form = await request.formData();
  if (!(await checkPassword(form.get('password'), env.TOOLS_PASSWORD))) return loginPage('Wrong password');
  return redirect('/outils', await sessionCookie(COOKIE, env.TOOLS_PASSWORD));
}

function loginPage(error = '', status = error ? 401 : 200) {
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
</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
