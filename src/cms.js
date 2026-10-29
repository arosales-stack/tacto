// Client CMS, one per client config (src/clients/<id>.json).
//
//   GET  /<id>                 branded login, or the editor once logged in
//   POST /<id>/login           GET /<id>/logout
//   GET  /<id>/api/content     editable fields + current values (read from the client's GitHub repo)
//   PUT  /<id>/api/content     validate against the field rules, then commit content/site.json → Cloudflare rebuilds the site
//   POST /<id>/api/estimate    credit estimate for a custom request (fixed table for now, see estimate.js)
//   GET  /<id>/api/requests    credits balance + request history (Cloudflare KV)
//   POST /<id>/api/requests    submit a request, reserving its credits
//
// Only fields listed in the client config can be changed, and only within their length/format rules,
// checked here on the server — the browser checks are just for comfort.

import { checkPassword, sessionCookie, clearCookie, hasSession, redirect, json } from './auth.js';
import { estimate, EXAMPLES } from './estimate.js';

export async function handleCms(request, env, client, url) {
  const base = `/${client.id}`;
  const sub = url.pathname.slice(base.length).replace(/\/$/, '') || '/';
  const secret = env[client.password_secret];
  const cookie = `cms_${client.id}`;

  if (sub === '/login' && request.method === 'POST') {
    const form = await request.formData();
    if (!(await checkPassword(form.get('password'), secret))) return page(loginHtml(client, 'Mot de passe incorrect'), 401);
    return redirect(base, await sessionCookie(cookie, secret, base));
  }
  if (sub === '/logout') return redirect(base, clearCookie(cookie, base));

  const loggedIn = await hasSession(request, cookie, secret);
  if (!loggedIn) return sub.startsWith('/api/') ? json({ error: 'Session expirée, reconnecte-toi.' }, 401) : page(loginHtml(client));

  try {
    if (sub === '/') return page(appHtml(client));
    if (sub === '/api/content' && request.method === 'GET') return json(await readContent(env, client));
    if (sub === '/api/content' && request.method === 'PUT') return await saveContent(request, env, client);
    if (sub === '/api/estimate' && request.method === 'POST') {
      const { text } = await request.json();
      return json({ estimate: estimate(text) });
    }
    if (sub === '/api/requests' && request.method === 'GET') return json(await requestsState(env, client));
    if (sub === '/api/requests' && request.method === 'POST') return await createRequest(request, env, client);
  } catch (err) {
    return json({ error: err.message || 'Erreur inattendue' }, err.status || 500);
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Content (GitHub) ----------
const fields = (client) => client.groups.flatMap((g) => g.fields);

async function github(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw Object.assign(new Error('GITHUB_TOKEN manquant dans Cloudflare'), { status: 500 });
  const res = await fetch(`${env.GITHUB_API || 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tacto-cms',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const status = res.status === 409 ? 409 : 502;
    throw Object.assign(new Error(res.status === 409 ? 'Le contenu a changé entre-temps. Recharge la page.' : `GitHub : ${data.message || res.status}`), { status });
  }
  return data;
}

async function getFile(env, client) {
  const data = await github(env, `/repos/${client.repo}/contents/${client.content_path}?ref=${client.branch}`);
  const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  return { sha: data.sha, content: JSON.parse(new TextDecoder().decode(bytes)) };
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((o, k) => o?.[k], obj);
  const last = keys.at(-1);
  if (!parent || !(last in parent)) throw new Error(`Champ introuvable : ${path}`);
  parent[last] = value;
}

async function readContent(env, client) {
  const { sha, content } = await getFile(env, client);
  const values = Object.fromEntries(fields(client).map((f) => [f.path, getPath(content, f.path)]));
  return { sha, groups: client.groups, values };
}

const PRICE_RE = /^((dès|à partir de)\s)?\d{1,3}(,\d{2})?(\s?[–-]\s?\d{1,3}(,\d{2})?)?\s?€$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns [cleanValue, errorMessage]
function validate(field, raw) {
  if (field.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n)) return [null, 'Nombre invalide'];
    if (n < field.min || n > field.max) return [null, `Entre ${field.min} et ${field.max} ${field.unit ?? ''}`.trim()];
    return [Math.round(n * 100) / 100, null];
  }
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const len = [...v].length;
  if (len < field.min) return [null, `${field.min} caractères minimum`];
  if (len > field.max) return [null, `${field.max} caractères maximum`];
  if (field.type === 'price' && !PRICE_RE.test(v)) return [null, 'Format attendu : 4 €, 3,90 €, dès 4,90 € ou 5 – 25 €'];
  if (field.type === 'email' && !EMAIL_RE.test(v)) return [null, 'Adresse e-mail invalide'];
  if (field.type === 'url') {
    try { if (!/^https?:$/.test(new URL(v).protocol)) throw 0; } catch { return [null, 'Lien invalide (commence par https://)']; }
  }
  return [v, null];
}

async function saveContent(request, env, client) {
  const { sha, values } = await request.json();
  if (!values || typeof values !== 'object') return json({ error: 'Rien à enregistrer' }, 400);

  const rules = Object.fromEntries(fields(client).map((f) => [f.path, f]));
  const current = await getFile(env, client);
  if (sha && sha !== current.sha) return json({ error: 'Le contenu a changé entre-temps. Recharge la page.' }, 409);

  const errors = {};
  const changed = [];
  for (const [path, raw] of Object.entries(values)) {
    const field = rules[path];
    if (!field) { errors[path] = 'Ce champ ne peut pas être modifié'; continue; }
    const [clean, error] = validate(field, raw);
    if (error) { errors[path] = error; continue; }
    if (clean !== getPath(current.content, path)) {
      setPath(current.content, path, clean);
      changed.push(field);
    }
  }
  if (Object.keys(errors).length) return json({ error: 'Certains champs sont à corriger', errors }, 422);
  if (!changed.length) return json({ error: 'Aucune modification' }, 400);

  const labels = [...new Set(changed.map((f) => f.label))].slice(0, 4).join(', ');
  const result = await github(env, `/repos/${client.repo}/contents/${client.content_path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `CMS : ${changed.length} modification${changed.length > 1 ? 's' : ''} (${labels})`,
      content: toBase64(JSON.stringify(current.content, null, 2) + '\n'),
      sha: current.sha,
      branch: client.branch,
    }),
  });
  return json({ sha: result.content.sha, changed: changed.length });
}

// ---------- Requests & credits (KV) ----------
function kv(env) {
  if (!env.CMS_KV) throw Object.assign(new Error('Stockage CMS_KV non connecté dans Cloudflare'), { status: 500 });
  return env.CMS_KV;
}

function period(client, now = new Date()) {
  const start = new Date(`${client.credits.period_start}T00:00:00Z`);
  while (new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate())) <= now) {
    start.setUTCFullYear(start.getUTCFullYear() + 1);
  }
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  return { start, end };
}

async function requestsState(env, client) {
  const list = (await kv(env).get(`${client.id}:requests`, 'json')) ?? [];
  const { start, end } = period(client);
  const used = list
    .filter((r) => new Date(r.date) >= start && r.status !== 'refused')
    .reduce((sum, r) => sum + (r.estimate.credits ?? 0), 0); // unpriced requests reserve nothing
  return {
    total: client.credits.per_year,
    used,
    remaining: Math.max(0, client.credits.per_year - used),
    renews_on: end.toISOString().slice(0, 10),
    requests: list.slice().reverse(),
    examples: EXAMPLES,
  };
}

async function createRequest(request, env, client) {
  const { text } = await request.json();
  const clean = String(text ?? '').trim();
  if (clean.length < 12) return json({ error: 'Décris ta demande en quelques mots de plus' }, 400);
  if (clean.length > 1200) return json({ error: '1200 caractères maximum' }, 400);

  const est = estimate(clean);
  const state = await requestsState(env, client);
  if (est.credits != null && est.credits > state.remaining) return json({ error: `Crédits insuffisants : ${est.credits} nécessaires, ${state.remaining} restants` }, 402);

  const list = (await kv(env).get(`${client.id}:requests`, 'json')) ?? [];
  list.push({ id: crypto.randomUUID(), date: new Date().toISOString(), text: clean, estimate: est, status: 'pending' });
  await kv(env).put(`${client.id}:requests`, JSON.stringify(list));
  return json(await requestsState(env, client), 201);
}

// ---------- Pages ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page(html, status = 200) {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function head(client, title) {
  const b = client.brand;
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — ${esc(client.name)}</title>
<link rel="icon" href="${esc(b.favicon || b.logo)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(b.font_url)}">
<link rel="stylesheet" href="/cms/cms.css">
<style>:root{--ink:${b.ink};--paper:${b.paper};--accent:${b.accent};--soft:${b.soft};--highlight:${b.highlight};--font:${b.font};--hand:${b.hand_font}}</style>
</head>`;
}

function loginHtml(client, error = '') {
  return `${head(client, 'Connexion')}
<body class="login">
  <main class="login__card">
    <img class="login__logo" src="${esc(client.brand.logo)}" alt="${esc(client.name)}">
    <h1 class="login__title">${esc(client.name)}</h1>
    <p class="login__tagline">${esc(client.brand.tagline)}</p>
    <form method="POST" action="/${client.id}/login" class="login__form">
      <label for="pw">Mot de passe</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
      ${error ? `<p class="login__error" role="alert">${esc(error)}</p>` : ''}
      <button class="btn btn--ink" type="submit">Entrer dans mon espace</button>
    </form>
  </main>
  <p class="login__by">Espace site · Tacto</p>
</body></html>`;
}

function appHtml(client) {
  const boot = JSON.stringify({ id: client.id, name: client.name, site: client.site_url, base: `/${client.id}` }).replace(/</g, '\\u003c');
  return `${head(client, 'Mon site')}
<body class="app">
  <header class="top">
    <a class="top__brand" href="/${client.id}"><img src="${esc(client.brand.logo)}" alt=""><span>${esc(client.name)}</span></a>
    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" aria-selected="true" data-tab="texts">Mes textes</button>
      <button class="tab" role="tab" aria-selected="false" data-tab="requests">Mes demandes</button>
    </nav>
    <div class="top__links">
      <a href="${esc(client.site_url)}" target="_blank" rel="noopener">Voir le site ↗</a>
      <a href="/${client.id}/logout">Déconnexion</a>
    </div>
  </header>

  <main class="wrap">
    <section data-panel="texts">
      <div class="intro">
        <h1>Mes textes</h1>
        <p>Modifie tes horaires, prix et textes, puis clique sur <strong>Publier</strong> : le site est à jour en une minute environ. Chaque champ a une longueur maximum pour que la mise en page reste belle.</p>
      </div>
      <div class="groups" data-groups><p class="loading">Chargement…</p></div>
    </section>

    <section data-panel="requests" hidden>
      <div class="intro">
        <h1>Mes demandes</h1>
        <p>Besoin de plus qu'un changement de texte ? Décris-le ici : on t'indique tout de suite combien de crédits ça représente. <strong>Chaque demande est traitée en moins de 24 h.</strong></p>
      </div>
      <div class="req-grid">
        <div class="card credits" data-credits></div>
        <form class="card ask" data-ask>
          <label for="ask-text" class="ask__label">Ta demande</label>
          <textarea id="ask-text" rows="5" maxlength="1200" placeholder="Ex. : Ajouter une section pour la collection de Noël avec 3 photos" data-ask-text></textarea>
          <div class="estimate" data-estimate aria-live="polite"></div>
          <button class="btn btn--ink" type="submit" data-ask-submit disabled>Envoyer la demande</button>
        </form>
      </div>
      <div class="card examples" data-examples></div>
      <h2 class="h2">Historique</h2>
      <div class="history" data-history></div>
    </section>
  </main>

  <div class="savebar" data-savebar hidden>
    <span data-savecount></span>
    <button class="btn btn--ghost" type="button" data-discard>Annuler</button>
    <button class="btn btn--ink" type="button" data-save>Publier</button>
  </div>
  <div class="toast" data-toast role="status" hidden></div>

  <script type="application/json" id="cms-boot">${boot}</script>
  <script src="/cms/cms.js" defer></script>
</body></html>`;
}
