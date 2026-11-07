// Assembles everything the Worker serves into dist/ (the only folder Cloudflare publishes).
//
//   site/content.json   data shared by every language: menu structure, prices, projects, reviews, comparison marks
//   site/lang/<xx>.json all the words, one file per language (fr = default at /, en at /en/)
//   site/layout.html    page shell: head, header, footer — written once for every page and language
//   site/partials/      blocks reused across pages: {{> name}}
//   site/pages/         one template per page, no text inside (it comes from site/lang): index.html → /,
//                       tarifs.html → /tarifs and /en/pricing, 404.html
//   site/assets/        agency CSS/JS/images → /assets/
//   public/             tool + client CMS files (app.css, logo, /cms, /clients, /outils) → copied as-is
//
// Nothing else is copied: CLAUDE.md, src/, .dev.vars, etc. never reach dist/.
//
// Template tags (no dependencies):
//   {{t.home.lead}}                  text, HTML-escaped        {{html t.home.title}}  text with markup (<mark>, <br>)
//   {{#each work}} {{.name}} {{/each}}   loop; ".field" reads the current item
//   {{#if .highlight}} … {{else}} … {{/if}}   condition
//   {{> name}}                       insert site/partials/name.html
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { EXAMPLES } from './src/estimate.js';

const OUT = 'dist';
const LANGS = ['fr', 'en'];        // first = default language, served at the root
const ONLY_DEFAULT = ['404'];      // pages that exist in the default language only
const read = (p) => readFileSync(p, 'utf8');
const content = JSON.parse(read('site/content.json'));
const strings = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`site/lang/${l}.json`))]));

// ---------- tiny template engine ----------
const escape = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function lookup(path, scope) {
  if (path === '.') return scope.item;
  const [base, parts] = path.startsWith('.') ? [scope.item, path.slice(1).split('.')] : [scope.root, path.split('.')];
  const value = parts.reduce((obj, key) => obj?.[key], base);
  if (value === undefined) throw new Error(`Unknown content key: ${path}`);
  return value;
}

function parse(tpl) {
  const root = { children: [] };
  const stack = [root];
  const re = /\{\{\s*([#/]?)([\w.-]+)\s*([^}]*?)\s*\}\}/g;
  let last = 0, m;
  while ((m = re.exec(tpl))) {
    const top = stack.at(-1);
    (top.inElse ? top.elseChildren : top.children).push(tpl.slice(last, m.index));
    last = re.lastIndex;
    const [, sigil, word, arg] = m;
    if (sigil === '#') {
      const node = { type: word, path: arg, children: [], elseChildren: [] };
      (top.inElse ? top.elseChildren : top.children).push(node);
      stack.push(node);
    } else if (sigil === '/') {
      if (stack.pop().type !== word) throw new Error(`Mismatched {{/${word}}}`);
    } else if (word === 'else') {
      top.inElse = true;
    } else {
      (top.inElse ? top.elseChildren : top.children).push({ type: 'var', word, arg });
    }
  }
  stack.at(-1).children.push(tpl.slice(last));
  if (stack.length !== 1) throw new Error(`Unclosed {{#${stack.at(-1).type}}}`);
  return root.children;
}

function render(nodes, scope) {
  return nodes.map((n) => {
    if (typeof n === 'string') return n;
    if (n.type === 'each') return lookup(n.path, scope).map((item) => render(n.children, { ...scope, item })).join('');
    if (n.type === 'if') {
      const v = lookup(n.path, scope);
      return render(v && (!Array.isArray(v) || v.length) ? n.children : n.elseChildren, scope);
    }
    if (n.word === 'html') return String(lookup(n.arg, scope)); // trusted text from site/lang only
    return escape(lookup(n.word, scope));
  }).join('');
}

const includes = (html, depth = 0) => {
  if (depth > 5) throw new Error('Partials nested too deep');
  return html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => includes(read(`site/partials/${name}.html`), depth + 1));
};

// ---------- URLs ----------
// /tarifs (fr) ↔ /en/pricing (en): slugs come from each language file
const prefix = (lang) => (lang === LANGS[0] ? '' : `/${lang}`);
const urlOf = (lang, page) => `${prefix(lang)}/${strings[lang].slugs[page]}`;
const fileOf = (lang, page) => join(OUT, prefix(lang), `${strings[lang].slugs[page] || 'index'}.html`);

// ---------- data for one language (shared structure + that language's words) ----------
function dataFor(lang, page) {
  const t = strings[lang];
  const other = LANGS.find((l) => l !== lang);
  const c = t.compare;
  return {
    ...content,
    t,
    lang,
    page: { name: page, url: content.site.url + urlOf(lang, page), ...t.pages[page] },
    home: urlOf(lang, 'index'),
    switch: { label: strings[other].label, name: strings[other].switch_label, lang: other, href: ONLY_DEFAULT.includes(page) ? urlOf(other, 'index') : urlOf(other, page) },
    alternates: ONLY_DEFAULT.includes(page) ? [] : LANGS.map((l) => ({ lang: l, href: content.site.url + urlOf(l, page) })),
    nav: content.nav.map((n) => ({ key: n.key, label: t.nav[n.key], href: urlOf(lang, n.page) + (n.anchor ?? ''), current: n.page === page && !n.anchor })),
    cta: { label: t.cta, href: urlOf(lang, content.cta.page) + content.cta.anchor },
    pricing: { // amounts in content.json, written the local way: "450 €" / "€450"
      first_year: t.price_format.replace('{n}', content.pricing.first_year),
      yearly: t.price_format.replace('{n}', content.pricing.yearly),
      credits: content.pricing.credits,
    },
    work: content.work.map((w) => ({ ...w, ...t.work[w.id] })),
    work_count: String(content.work.length).padStart(2, '0'),
    reviews: content.reviews.map((r) => ({ ...r, ...t.reviews.items[r.id] })),
    compare: {
      first: content.compare.rivals[0].label,
      us: c.labels.map((label, i) => ({ label, text: c.us[i] })),
      rivals: content.compare.rivals.map((r) => ({
        id: r.id, label: r.label,
        rows: c.labels.map((label, i) => ({ label, text: c.rivals[r.id][i], mid: r.mid[i] })),
      })),
    },
    // Same credit table as the client CMS (src/estimate.js); English labels from site/lang/en.json
    credit_grid: EXAMPLES.filter((e) => e.credits != null)
      .sort((a, b) => b.credits - a.credits)
      .map((e) => ({ label: t.credit_labels[e.id] ?? e.label, credits: e.credits })),
  };
}

// ---------- build ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync('public', OUT, { recursive: true });
cpSync('site/assets', join(OUT, 'assets'), { recursive: true });

const layout = read('site/layout.html');

for (const file of readdirSync('site/pages').filter((f) => f.endsWith('.html'))) {
  const page = file.replace(/\.html$/, '');
  const tpl = parse(includes(layout.replace('{{> content}}', read(join('site/pages', file)))));
  for (const lang of LANGS) {
    if (ONLY_DEFAULT.includes(page) && lang !== LANGS[0]) continue;
    const html = render(tpl, { root: dataFor(lang, page) });
    const out = fileOf(lang, page);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    console.log('built', out);
  }
}
