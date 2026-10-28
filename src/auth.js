// Password sessions shared by the Tacto tools and every client CMS.
// A session cookie is "<expiry>.<HMAC(expiry, password)>": changing the password logs everyone out.

const SESSION_DAYS = 30;

export async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
}

export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function checkPassword(given, secret) {
  return Boolean(secret) && safeEqual(String(given ?? ''), secret);
}

export async function sessionCookie(name, secret, path = '/') {
  const expires = Date.now() + SESSION_DAYS * 864e5;
  const token = `${expires}.${await sign(String(expires), secret)}`;
  return `${name}=${token}; Path=${path}; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearCookie(name, path = '/') {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function hasSession(request, name, secret) {
  if (!secret) return false;
  const cookie = request.headers.get('Cookie') ?? '';
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await sign(expires, secret));
}

export function redirect(location, cookie) {
  const headers = { Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
