// Security shared by every route: response headers, same-origin POSTs, and simple rate limits.

// The agency site: only our own files + Google Fonts, no inline code at all.
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Tools and client CMS: same, plus inline styles (client brand colours) and data:/blob: images (photo tool).
const APP_CSP = SITE_CSP
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  .replace("img-src 'self' data:", "img-src 'self' data: blob:")
  .replace("connect-src 'self'", "connect-src 'self' data: blob:");

const COMMON = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// kind: 'site' (public agency pages) or 'app' (tools, CMS, API — never indexed, never cached)
export function secure(response, kind) {
  const res = new Response(response.body, response); // asset responses are read-only: copy first
  for (const [k, v] of Object.entries(COMMON)) res.headers.set(k, v);
  res.headers.set('Content-Security-Policy', kind === 'site' ? SITE_CSP : APP_CSP);
  if (kind === 'app') {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
  }
  return res;
}

// POSTs must come from our own pages (blocks other sites submitting forms on a visitor's behalf).
export function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}

// Fixed-window counter in KV, per visitor IP. KV is eventually consistent, so this is a brake, not an exact count.
export async function tooMany(env, request, bucket, max, windowSeconds) {
  if (!env.CMS_KV) return false;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const count = Number(await env.CMS_KV.get(key)) || 0;
  if (count >= max) return true;
  await env.CMS_KV.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSeconds * 2) });
  return false;
}

export const LIMITS = {
  login: { max: 10, window: 15 * 60 },  // password attempts per IP per 15 min (tools and each CMS)
  contact: { max: 5, window: 60 * 60 }, // contact form sends per IP per hour
};
