// Agency contact form.
//   POST /api/contact     public: validate and store one message in KV (key contact:<date>:<id>)
//   GET  /outils/messages private (Tacto login): list of received messages, newest first

import { json } from './auth.js';

const PREFIX = 'contact:';
const LIMITS = { name: 80, business: 100, contact: 120, site: 200, message: 1500 };
const REQUIRED = ['name', 'business', 'contact'];

export async function receiveContact(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Formulaire illisible' }, 400); }
  if (String(body.website ?? '').trim()) return json({ ok: true }); // honeypot: pretend it worked, store nothing

  const clean = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const raw = String(body[key] ?? '');
    const value = (key === 'message' ? raw.replace(/\n{3,}/g, '\n\n') : raw.replace(/\s+/g, ' ')).trim(); // keep line breaks in the message only
    if (value.length > max) return json({ error: 'Un des champs est trop long.' }, 400);
    clean[key] = value;
  }
  if (clean.site && !/^https?:\/\//i.test(clean.site)) clean.site = `https://${clean.site}`; // never store a javascript: link
  if (REQUIRED.some((k) => !clean[k])) return json({ error: 'Il manque votre nom, votre commerce ou un moyen de vous joindre.' }, 400);
  if (!env.CMS_KV) return json({ error: 'Envoi impossible pour le moment.' }, 500);

  const date = new Date().toISOString();
  await env.CMS_KV.put(`${PREFIX}${date}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify({ date, ...clean }));
  return json({ ok: true }, 201);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const link = (contact) => (/@/.test(contact) ? `mailto:${contact}` : `tel:${contact.replace(/[^\d+]/g, '')}`);

export async function messagesPage(env) {
  const { keys } = await env.CMS_KV.list({ prefix: PREFIX });
  const messages = (await Promise.all(keys.map((k) => env.CMS_KV.get(k.name, 'json')))).filter(Boolean).reverse();
  const items = messages.map((m) => `
    <article class="card msg">
      <div class="msg__top"><strong>${esc(m.business)}</strong><span>${new Date(m.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short' })}</span></div>
      <p>${esc(m.name)} · <a href="${esc(link(m.contact))}">${esc(m.contact)}</a>${m.site ? ` · <a href="${esc(m.site)}" target="_blank" rel="noopener">${esc(m.site)}</a>` : ''}</p>
      ${m.message ? `<p class="msg__text">${esc(m.message)}</p>` : ''}
    </article>`).join('');
  return new Response(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tacto — Messages</title><meta name="robots" content="noindex">
<link rel="icon" href="/logo.png"><link rel="stylesheet" href="/app.css"></head>
<body>
  <header class="top">
    <img class="top__logo" src="/logo.png" alt="Tacto" width="640" height="200">
    <nav class="top__links"><a class="link" href="/outils">Images</a><a class="top__logout" href="/logout">Log out</a></nav>
  </header>
  <main class="wrap msgs">
    <h1>Messages du site (${messages.length})</h1>
    ${items || '<p class="msgs__empty">Aucun message pour l’instant.</p>'}
  </main>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
