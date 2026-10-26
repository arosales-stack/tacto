// Tacto tools — private Worker.
// Everything is behind one password. Secrets (set in Cloudflare, never in code):
//   TOOLS_PASSWORD  — the login password
//   OPENAI_API_KEY  — used server-side only, never sent to the browser

const COOKIE = 'tacto_session';
const SESSION_DAYS = 30;
const OPENAI_EDITS = 'https://api.openai.com/v1/images/edits';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/login') {
      return request.method === 'POST' ? login(request, env) : loginPage();
    }
    if (url.pathname === '/logout') {
      return redirect('/login', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
    }

    // the login page needs its stylesheet and logo before login
    if (url.pathname === '/app.css' || url.pathname === '/logo.png') return env.ASSETS.fetch(request);

    if (!(await isLoggedIn(request, env))) {
      return url.pathname.startsWith('/api/')
        ? json({ error: 'Not logged in' }, 401)
        : redirect('/login');
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

// ---------- Auth ----------
async function login(request, env) {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  if (!env.TOOLS_PASSWORD || !(await safeEqual(password, env.TOOLS_PASSWORD))) {
    return loginPage('Wrong password');
  }
  const expires = Date.now() + SESSION_DAYS * 864e5;
  const token = `${expires}.${await sign(String(expires), env.TOOLS_PASSWORD)}`;
  return redirect('/', `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`);
}

async function isLoggedIn(request, env) {
  if (!env.TOOLS_PASSWORD) return false;
  const cookie = request.headers.get('Cookie') ?? '';
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await sign(expires, env.TOOLS_PASSWORD));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
}

async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------- Helpers ----------
function redirect(location, cookie) {
  const headers = { Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
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
