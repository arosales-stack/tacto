// Client CMS front-end. Branding comes from CSS variables set by the server; data from /<client>/api/*.
const BOOT = JSON.parse(document.getElementById('cms-boot').textContent);
const API = `${BOOT.base}/api`;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const len = (s) => [...String(s ?? '')].length;

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { 'Content-Type': 'application/json' } });
  if (res.status === 401) { location.reload(); throw new Error('Session expirée'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { data, status: res.status });
  return data;
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('[data-toast]');
  el.innerHTML = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 7000 : 9000);
}

// ---------- Tabs ----------
$$('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
  $$('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  $('[data-savebar]').classList.toggle('is-away', tab.dataset.tab !== 'texts');
  if (tab.dataset.tab === 'requests') loadRequests();
}));

// ---------- Texts ----------
const state = { sha: null, original: {}, fields: {} };

const PRICE_RE = /^((dès|à partir de)\s)?\d{1,3}(,\d{2})?(\s?[–-]\s?\d{1,3}(,\d{2})?)?\s?€$/i;
function check(field, value) {
  if (field.type === 'number') {
    const n = Number(String(value).replace(',', '.'));
    if (value === '' || !Number.isFinite(n)) return 'Nombre invalide';
    if (n < field.min || n > field.max) return `Entre ${field.min} et ${field.max} ${field.unit ?? ''}`.trim();
    return '';
  }
  const v = String(value).replace(/\s+/g, ' ').trim();
  if (len(v) < field.min) return `${field.min} caractères minimum`;
  if (len(v) > field.max) return `${field.max} caractères maximum`;
  if (field.type === 'price' && !PRICE_RE.test(v)) return 'Format : 4 €, 3,90 €, dès 4,90 € ou 5 – 25 €';
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Adresse e-mail invalide';
  if (field.type === 'url' && !/^https?:\/\/\S+\.\S+/.test(v)) return 'Lien invalide (commence par https://)';
  return '';
}

function fieldHtml(f, value) {
  const id = `f-${f.path.replace(/\./g, '-')}`;
  const v = esc(value);
  let input;
  if (f.type === 'paragraph') input = `<textarea id="${id}" rows="3">${v}</textarea>`;
  else if (f.type === 'number') input = `<div class="num"><input id="${id}" type="number" inputmode="decimal" step="0.1" min="${f.min}" max="${f.max}" value="${v}"><span>${esc(f.unit ?? '')}</span></div>`;
  else input = `<input id="${id}" type="${f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}" value="${v}">`;
  const counter = f.type === 'number' ? '' : `<span class="field__count" data-count></span>`;
  return `<div class="field field--${f.type}" data-path="${esc(f.path)}">
    <div class="field__top"><label for="${id}">${esc(f.label)}</label>${counter}</div>
    ${input}
    <div class="field__meter" aria-hidden="true"><span></span></div>
    <p class="field__msg" data-msg>${esc(f.hint ?? '')}</p>
  </div>`;
}

function updateField(el) {
  const f = state.fields[el.dataset.path];
  const input = $('input, textarea', el);
  const value = input.value;
  const error = check(f, value);
  const changed = String(value).trim() !== String(state.original[f.path]);
  el.classList.toggle('is-error', Boolean(error));
  el.classList.toggle('is-changed', changed);
  if (f.type !== 'number') {
    const n = len(value.trim());
    $('[data-count]', el).textContent = `${n} / ${f.max}`;
    const ratio = Math.min(1, n / f.max);
    const meter = $('.field__meter span', el);
    meter.style.width = `${ratio * 100}%`;
    el.classList.toggle('is-near', !error && ratio > 0.9);
  }
  $('[data-msg]', el).textContent = error || f.hint || '';
  refreshSavebar();
}

function changes() {
  const out = {};
  for (const el of $$('.field.is-changed')) {
    const f = state.fields[el.dataset.path];
    const v = $('input, textarea', el).value;
    out[f.path] = f.type === 'number' ? Number(String(v).replace(',', '.')) : v.replace(/\s+/g, ' ').trim();
  }
  return out;
}

function refreshSavebar() {
  const n = $$('.field.is-changed').length;
  const errors = $$('.field.is-error').length;
  const bar = $('[data-savebar]');
  bar.hidden = n === 0;
  $('[data-savecount]').textContent = errors
    ? `${errors} champ${errors > 1 ? 's' : ''} à corriger`
    : `${n} modification${n > 1 ? 's' : ''} non publiée${n > 1 ? 's' : ''}`;
  bar.classList.toggle('has-errors', errors > 0);
  $('[data-save]').disabled = errors > 0;
}

async function loadTexts() {
  const box = $('[data-groups]');
  try {
    const data = await api('/content');
    state.sha = data.sha;
    state.original = data.values;
    state.fields = Object.fromEntries(data.groups.flatMap((g) => g.fields).map((f) => [f.path, f]));
    box.innerHTML = data.groups.map((g, i) => `
      <details class="card group" ${i === 0 ? 'open' : ''}>
        <summary><h2>${esc(g.title)}</h2><span class="group__count">${g.fields.length} champs</span></summary>
        <div class="group__fields">${g.fields.map((f) => fieldHtml(f, data.values[f.path])).join('')}</div>
      </details>`).join('');
    $$('.field', box).forEach((el) => {
      $('input, textarea', el).addEventListener('input', () => updateField(el));
      updateField(el);
    });
  } catch (err) {
    box.innerHTML = `<p class="load-error">Impossible de charger les textes : ${esc(err.message)}</p>`;
  }
}

$('[data-discard]').addEventListener('click', () => {
  for (const el of $$('.field.is-changed')) {
    $('input, textarea', el).value = state.original[el.dataset.path];
    updateField(el);
  }
});

$('[data-save]').addEventListener('click', async () => {
  const btn = $('[data-save]');
  btn.disabled = true;
  btn.textContent = 'Publication…';
  try {
    const values = changes();
    const res = await api('/content', { method: 'PUT', body: JSON.stringify({ sha: state.sha, values }) });
    state.sha = res.sha;
    Object.assign(state.original, values);
    $$('.field').forEach(updateField);
    toast(`<strong>Publié.</strong> Ton site est à jour dans une minute environ. <a href="${esc(BOOT.site)}" target="_blank" rel="noopener">Voir le site ↗</a>`, 'ok');
  } catch (err) {
    if (err.data?.errors) {
      for (const [path, msg] of Object.entries(err.data.errors)) {
        const el = $(`.field[data-path="${CSS.escape(path)}"]`);
        if (el) { el.classList.add('is-error'); $('[data-msg]', el).textContent = msg; }
      }
    }
    toast(esc(err.message), 'error');
  } finally {
    btn.textContent = 'Publier';
    refreshSavebar();
  }
});

window.addEventListener('beforeunload', (e) => { if ($$('.field.is-changed').length) e.preventDefault(); });

// ---------- Requests & credits ----------
const STATUS = { pending: 'En attente', approved: 'Validée', done: 'Réalisée', refused: 'Refusée' };
let creditsState = null;

function renderCredits(s) {
  creditsState = s;
  const pct = Math.round((s.remaining / s.total) * 100);
  const renew = new Date(s.renews_on).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  $('[data-credits]').innerHTML = `
    <span class="credits__label">Crédits disponibles</span>
    <div class="credits__big"><strong>${s.remaining}</strong><span>/ ${s.total}</span></div>
    <div class="credits__bar"><span style="width:${pct}%"></span></div>
    <p class="credits__note">${s.used} utilisés · renouvelés le ${renew}</p>`;
  $('[data-examples]').innerHTML = `
    <h2 class="examples__title">Repères</h2>
    <ul>${s.examples.map((e) => `<li><span>${esc(e.label)}</span><strong>${e.credits} crédits</strong></li>`).join('')}</ul>
    <p class="examples__note">Les changements de texte dans « Mes textes » sont illimités et gratuits.</p>`;
  $('[data-history]').innerHTML = s.requests.length
    ? s.requests.map((r) => `
      <article class="card req">
        <div class="req__top">
          <span class="req__type">${esc(r.estimate.label)}</span>
          <span class="badge badge--${r.status}">${STATUS[r.status] ?? r.status}</span>
        </div>
        <p class="req__text">${esc(r.text)}</p>
        <div class="req__meta">
          <span>${new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <strong>${r.estimate.credits} crédits</strong>
        </div>
      </article>`).join('')
    : '<p class="empty">Aucune demande pour l\'instant.</p>';
}

async function loadRequests() {
  try { renderCredits(await api('/requests')); }
  catch (err) { $('[data-credits]').innerHTML = `<p class="load-error">${esc(err.message)}</p>`; }
}

// Live estimate while typing: short "analysis" state, then the result
const askText = $('[data-ask-text]');
const estBox = $('[data-estimate]');
const askBtn = $('[data-ask-submit]');
let estTimer, estSeq = 0, currentEstimate = null;

askText.addEventListener('input', () => {
  clearTimeout(estTimer);
  currentEstimate = null;
  askBtn.disabled = true;
  const text = askText.value.trim();
  if (text.length < 12) { estBox.innerHTML = text ? '<p class="estimate__hint">Continue ta description…</p>' : ''; return; }
  estBox.innerHTML = '<p class="estimate__thinking"><span class="dots"><i></i><i></i><i></i></span> Analyse de ta demande…</p>';
  const seq = ++estSeq;
  estTimer = setTimeout(async () => {
    try {
      const [{ estimate }] = await Promise.all([
        api('/estimate', { method: 'POST', body: JSON.stringify({ text }) }),
        new Promise((r) => setTimeout(r, 900)),
      ]);
      if (seq !== estSeq || !estimate) return;
      currentEstimate = estimate;
      const short = creditsState && estimate.credits > creditsState.remaining;
      estBox.innerHTML = `
        <div class="estimate__result ${short ? 'is-short' : ''}">
          <span class="estimate__type">${esc(estimate.label)}</span>
          <strong class="estimate__credits">${estimate.credits} crédits</strong>
          <span class="estimate__delay">Délai estimé : ${esc(estimate.delay)}</span>
          ${short ? `<span class="estimate__warn">Il te reste ${creditsState.remaining} crédits.</span>` : ''}
        </div>`;
      askBtn.disabled = short;
    } catch (err) {
      if (seq === estSeq) estBox.innerHTML = `<p class="load-error">${esc(err.message)}</p>`;
    }
  }, 600);
});

$('[data-ask]').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentEstimate) return;
  askBtn.disabled = true;
  askBtn.textContent = 'Envoi…';
  try {
    renderCredits(await api('/requests', { method: 'POST', body: JSON.stringify({ text: askText.value }) }));
    askText.value = '';
    estBox.innerHTML = '';
    currentEstimate = null;
    toast('<strong>Demande envoyée.</strong> On revient vers toi rapidement.', 'ok');
  } catch (err) {
    toast(esc(err.message), 'error');
  } finally {
    askBtn.textContent = 'Envoyer la demande';
  }
});

loadTexts();
loadRequests();
