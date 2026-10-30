// tacto — agency page: credit dots, comparison tabs, contact form.

// ---------- 100 credits: 30 dots, 22 filled ----------
document.querySelector('.credits__dots').innerHTML =
  Array.from({ length: 30 }, (_, i) => `<i${i < 22 ? ' class="is-on"' : ''}></i>`).join('');

// ---------- Comparison ----------
// mark: 0 = worse (×), 1 = so-so (~)
const RIVALS = [
  { id: 'wp', label: 'WordPress' },
  { id: 'wix', label: 'Wix' },
  { id: 'sq', label: 'Squarespace' },
  { id: 'diy', label: 'Pas de site' },
];
const ROWS = [
  { label: 'Design', us: 'Sur mesure, fait pour votre commerce', wp: ['Thème acheté, adapté tant bien que mal', 0], wix: ['Template vu mille fois', 0], sq: ['Template élégant mais générique', 1], diy: ['Vos clients ne vous trouvent pas', 0] },
  { label: 'Modifier vos textes', us: 'Espace simple, mise en page protégée', wp: ['Back-office complexe, facile à casser', 0], wix: ['Glisser-déposer : tout bouge', 1], sq: ['Possible, mise en page fragile', 1], diy: ['Infos éparpillées sur Google et Insta', 0] },
  { label: 'Changements plus gros', us: 'Faits pour vous en moins de 24 h', wp: ['À faire soi-même ou facturé', 0], wix: ['À faire soi-même', 0], sq: ['À faire soi-même', 0], diy: ['—', 0] },
  { label: 'Maintenance', us: 'Aucune. Zéro plugin.', wp: ['Plugins et mises à jour à surveiller', 0], wix: ['Incluse, mais impossible de partir', 1], sq: ['Incluse, mais impossible de partir', 1], diy: ['—', 0] },
  { label: 'Vitesse', us: 'Instantané, même en 4G', wp: ['Souvent lent sur mobile', 0], wix: ['Lourd sur mobile', 0], sq: ['Correcte', 1], diy: ['—', 0] },
  { label: 'Prix', us: 'Un prix par an, tout compris', wp: ['Hébergement + thème + plugins + dev', 0], wix: ['Abonnement mensuel + options', 1], sq: ['Abonnement mensuel', 1], diy: ['Gratuit, mais des clients en moins', 0] },
];

const row = (label, value, markClass, mark) => `
  <div class="row">
    <span class="row__mark ${markClass}">${mark}</span>
    <div class="row__text"><span class="row__label">${label}</span><span class="row__value">${value}</span></div>
  </div>`;

const tabs = document.querySelector('[data-rival-tabs]');
function showRival(id) {
  const rival = RIVALS.find((r) => r.id === id);
  document.querySelectorAll('[data-rival-name]').forEach((el) => { el.textContent = rival.label; });
  tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.id === id)));
  document.querySelector('[data-rows-us]').innerHTML = ROWS.map((r) => row(r.label, r.us, 'row__mark--yes', '✓')).join('');
  document.querySelector('[data-rows-them]').innerHTML = ROWS.map((r) => {
    const [text, so] = r[id];
    return row(r.label, text, so ? 'row__mark--mid' : '', so ? '~' : '×');
  }).join('');
}
tabs.innerHTML = RIVALS.map((r) => `<button class="tab" type="button" role="tab" data-id="${r.id}">${r.label}</button>`).join('');
tabs.addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) showRival(t.dataset.id); });
showRival('wp');

// ---------- Contact form → POST /api/contact ----------
const form = document.querySelector('[data-contact]');
const status = form.querySelector('[data-status]');
const say = (text, kind = '') => { status.textContent = text; status.className = `form__status ${kind && `is-${kind}`}`; };

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const missing = [...form.querySelectorAll('[required]')].filter((el) => !el.value.trim());
  form.querySelectorAll('input').forEach((el) => el.removeAttribute('aria-invalid'));
  missing.forEach((el) => el.setAttribute('aria-invalid', 'true'));
  if (missing.length) { say('Il manque votre nom, votre commerce ou un moyen de vous joindre.', 'error'); missing[0].focus(); return; }

  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  say('Envoi…');
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Envoi impossible, réessayez dans un instant.');
    form.reset();
    say('Merci ! On vous répond sous 24 h.', 'ok');
  } catch (err) {
    say(err.message, 'error');
  } finally {
    button.disabled = false;
  }
});
