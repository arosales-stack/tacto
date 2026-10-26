// Tacto — bulk image optimizer.
// Each image is sent as its own request to /api/images/edit (the Worker adds the OpenAI key).
// Requests run in parallel, a few at a time, and retry automatically when OpenAI says "slow down".

const MODEL = 'gpt-image-2.5-sunburst';
const QUALITY = 'medium';
const FORMAT = 'webp';
const PARALLEL = 5;
const MAX_RETRIES = 3;

const $ = (sel) => document.querySelector(sel);
const drop = $('[data-drop]');
const fileInput = $('[data-files]');
const promptEl = $('[data-prompt]');
const runBtn = $('[data-run]');
const allBtn = $('[data-download-all]');
const statusEl = $('[data-status]');
const grid = $('[data-grid]');
const template = $('[data-card-template]');

const items = []; // { id, file, card, state: ready|busy|done|error, resultUrl }
let running = false;

// Keep the last prompt between visits
try { promptEl.value = localStorage.getItem('tacto.prompt') ?? ''; } catch {}
promptEl.addEventListener('input', () => {
  try { localStorage.setItem('tacto.prompt', promptEl.value); } catch {}
  refresh();
});

// ---------- Adding files ----------
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

function addFiles(list) {
  for (const file of list) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) continue;
    const card = template.content.firstElementChild.cloneNode(true);
    const item = { id: crypto.randomUUID(), file, card, state: 'ready', resultUrl: null };
    card.querySelector('[data-before]').src = URL.createObjectURL(file);
    card.querySelector('[data-name]').textContent = file.name;
    card.querySelector('[data-remove]').addEventListener('click', () => removeItem(item));
    card.querySelector('[data-retry]').addEventListener('click', () => { setState(item, 'ready'); run(); });
    card.querySelectorAll('.card__img').forEach((img) => img.addEventListener('click', () => zoom(img.src)));
    items.push(item);
    grid.append(card);
  }
  refresh();
}

function removeItem(item) {
  if (item.state === 'busy') return;
  items.splice(items.indexOf(item), 1);
  item.card.remove();
  refresh();
}

// ---------- Running ----------
runBtn.addEventListener('click', run);

async function run() {
  if (running || !promptEl.value.trim()) return;
  running = true;
  refresh();
  const queue = items.filter((i) => i.state === 'ready' || i.state === 'error');
  queue.forEach((i) => setState(i, 'queued'));
  const worker = async () => { while (queue.length) await optimize(queue.shift()); };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  running = false;
  refresh();
}

async function optimize(item, attempt = 0) {
  setState(item, 'busy');
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', promptEl.value.trim());
  form.append('image[]', item.file, item.file.name);
  form.append('quality', QUALITY);
  form.append('output_format', FORMAT);

  try {
    const res = await fetch('/api/images/edit', { method: 'POST', body: form });
    if (res.status === 401) { location.href = '/login'; return; }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt * 10;
      setState(item, 'busy', `Waiting ${wait}s (OpenAI limit)…`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return optimize(item, attempt + 1);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message ?? data.error ?? `Error ${res.status}`);
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image returned');
    const blob = await (await fetch(`data:image/${FORMAT};base64,${b64}`)).blob();
    item.resultUrl = URL.createObjectURL(blob);
    setState(item, 'done');
  } catch (err) {
    setState(item, 'error', err.message);
  }
}

// ---------- UI state ----------
function setState(item, state, message) {
  item.state = state;
  const el = item.card.querySelector('[data-state]');
  const after = item.card.querySelector('[data-after]');
  const download = item.card.querySelector('[data-download]');
  el.className = 'card__state';
  item.card.querySelector('[data-retry]').hidden = state !== 'error';

  if (state === 'done') {
    after.src = item.resultUrl;
    after.hidden = false;
    el.hidden = true;
    download.href = item.resultUrl;
    download.download = item.file.name.replace(/\.[^.]+$/, '') + '-tacto.' + FORMAT;
    download.hidden = false;
  } else {
    after.hidden = true;
    el.hidden = false;
    download.hidden = true;
    el.textContent = message ?? { ready: 'Ready', queued: 'Queued', busy: 'Optimizing…', error: 'Failed' }[state];
    if (state === 'busy') el.classList.add('is-busy');
    if (state === 'error') el.classList.add('is-error');
  }
  refresh();
}

function refresh() {
  const count = (s) => items.filter((i) => i.state === s).length;
  const done = count('done');
  const todo = count('ready') + count('error');
  runBtn.disabled = running || !todo || !promptEl.value.trim();
  runBtn.textContent = todo > 1 ? `Optimize ${todo}` : 'Optimize';
  allBtn.hidden = done < 2;
  if (!items.length) statusEl.textContent = '';
  else if (running) statusEl.textContent = `${done} / ${items.length} done`;
  else statusEl.textContent = `${items.length} image${items.length > 1 ? 's' : ''}${done ? ` · ${done} done` : ''}`;
}

allBtn.addEventListener('click', async () => {
  for (const i of items.filter((x) => x.state === 'done')) {
    i.card.querySelector('[data-download]').click();
    await new Promise((r) => setTimeout(r, 300));
  }
});

// ---------- Zoom ----------
function zoom(src) {
  if (!src) return;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${src}" alt="">`;
  box.addEventListener('click', () => box.remove());
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { box.remove(); document.removeEventListener('keydown', esc); } });
  document.body.append(box);
}

refresh();
