// tacto — agency site behaviour (loaded on every page; each block runs only if its section exists).
// All visible words come from the page (data-* attributes), so this file is the same for every language.

// ---------- Phone menu (burger) ----------
const header = document.querySelector('[data-menu]');
if (header) {
  const burger = header.querySelector('.burger');
  const setOpen = (open) => {
    header.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? burger.dataset.labelClose : burger.dataset.labelOpen);
  };
  burger.addEventListener('click', () => setOpen(!header.classList.contains('is-open')));
  header.querySelectorAll('.top__link').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

// ---------- Comparison tabs: all rivals are in the HTML, this only shows one ----------
const tabs = [...document.querySelectorAll('[data-rival]')];
if (tabs.length) {
  const panels = [...document.querySelectorAll('[data-panel]')];
  const names = document.querySelectorAll('[data-rival-name]');
  const show = (id) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.rival === id)));
    panels.forEach((p) => { p.hidden = p.dataset.panel !== id; });
    const label = tabs.find((t) => t.dataset.rival === id).dataset.label;
    names.forEach((n) => { n.textContent = label; });
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.rival)));
  show(tabs[0].dataset.rival);
}

// ---------- Contact form → POST /api/contact ----------
const form = document.querySelector('[data-contact]');
if (form) {
  const status = form.querySelector('[data-status]');
  const button = form.querySelector('button[type=submit]');
  const say = (text, kind = '') => { status.textContent = text; status.className = `form__status${kind ? ` is-${kind}` : ''}`; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const required = [...form.querySelectorAll('[required]')];
    required.forEach((el) => el.setAttribute('aria-invalid', String(!el.value.trim())));
    const missing = required.filter((el) => !el.value.trim());
    if (missing.length) { say(form.dataset.msgMissing, 'error'); missing[0].focus(); return; }

    button.disabled = true;
    say(form.dataset.msgSending);
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || form.dataset.msgFailed);
      form.reset();
      say(form.dataset.msgOk, 'ok');
    } catch (err) {
      say(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}
