// Assembles everything the Worker serves into dist/ (the only folder Cloudflare publishes).
//
//   site/content.json   agency site data: menu, projects, comparison table
//   site/layout.html    page shell: head, header, footer — written once for every page
//   site/partials/      blocks reused across pages: {{> name}}
//   site/pages/         one file per page, starting with front matter (title, description, nav)
//                       index.html → /   about.html → /about   404.html → shown for unknown URLs
//   site/assets/        agency CSS/JS/images → /assets/
//   public/             tool + client CMS files (app.css, logo, /cms, /clients, /outils) → copied as-is
//
// Nothing else is copied: CLAUDE.md, src/, .dev.vars, etc. never reach dist/.
//
// Template tags (no dependencies):
//   {{nav.0.label}}                  value from site/content.json (HTML-escaped)
//   {{#each work}} {{.name}} {{/each}}   loop; ".field" reads the current item
//   {{#if .mid}} … {{else}} … {{/if}}    condition
//   {{> name}}                       insert site/partials/name.html
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist';
const read = (p) => readFileSync(p, 'utf8');
const content = JSON.parse(read('site/content.json'));
content.work_count = String(content.work.length).padStart(2, '0'); // derived: "03 projets"

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
  const re = /\{\{\s*([#/]?)([\w.]+)\s*([^}]*?)\s*\}\}/g;
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
      (top.inElse ? top.elseChildren : top.children).push({ type: 'var', word });
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
    return escape(lookup(n.word, scope));
  }).join('');
}

const includes = (html, depth = 0) => {
  if (depth > 5) throw new Error('Partials nested too deep');
  return html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => includes(read(`site/partials/${name}.html`), depth + 1));
};

// ---------- build ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync('public', OUT, { recursive: true });
cpSync('site/assets', join(OUT, 'assets'), { recursive: true });

const layout = read('site/layout.html');

for (const file of readdirSync('site/pages').filter((f) => f.endsWith('.html'))) {
  const raw = read(join('site/pages', file));
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const page = {};
  for (const line of match ? match[1].split('\n') : []) {
    const i = line.indexOf(':');
    if (i > 0) page[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const body = match ? raw.slice(match[0].length) : raw;
  const tpl = includes(layout.replace('{{> content}}', body));
  let html = render(parse(tpl), { root: { ...content, page: { title: '', description: '', nav: '', ...page } } });
  if (page.nav) html = html.replaceAll(`data-nav="${page.nav}"`, `data-nav="${page.nav}" aria-current="page"`); // highlight the current page in the menu
  writeFileSync(join(OUT, file), html);
  console.log('built', file);
}
