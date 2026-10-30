# Tacto — agency site, team tools and client CMS

Tacto is Audra Rosales's web studio for small businesses (sister brand of Metodas). This repo is ONE Cloudflare
Worker (`tacto`) that serves three things:

| Part | URLs | Who |
|---|---|---|
| Agency website | `/`, `/assets/*`, any page in `site/pages/` | public |
| Contact form | `POST /api/contact` → inbox at `/outils/messages` | public form, private inbox |
| Team tools | `/login`, `/outils` (photo tool), `/outils/messages`, `POST /api/images/edit` | Tacto team (`TOOLS_PASSWORD`) |
| Client CMS | `/<client>` e.g. `/gutea` | each client, own password |

Live: https://tacto.a-rosales.workers.dev/ — deployed by Cloudflare Workers Builds on every push to `main`
(the build runs `node build.mjs`, see `wrangler.jsonc`). Check a deploy with
`gh api repos/arosales-stack/tacto/commits/<sha>/check-runs`.

## Folder map

```
build.mjs            builds dist/ (the ONLY folder Cloudflare publishes): site pages + site/assets + public/
site/                agency website source
  content.json       menu, CTA, projects ("Travaux"), comparison table — data used by the pages
  layout.html        page shell: <head>, header, footer. Written once, used by every page
  partials/          header.html, footer.html (+ any reusable block: {{> name}})
  pages/             one file per page; front matter = title, description, nav. index.html → /, 404.html → unknown URLs
  assets/            site.css (all styles, tokens at the top), site.js (tabs + contact form)
public/              files for the tools and CMS, copied as-is: app.css, logo.png, cms/, clients/<id>/, outils/
src/                 Worker code (never published as files)
  worker.js          routing (read the header comment first)
  security.js        security headers (CSP…), same-origin POST check, KV rate limits
  auth.js            password sessions (HMAC cookies, HttpOnly, Secure, SameSite=Strict)
  contact.js         contact form endpoint + /outils/messages inbox
  cms.js             client CMS: login, text fields → commit to the client's repo, requests & credits
  estimate.js        credit estimate table for client requests
  clients/           one JSON per client (brand, repo, editable fields with limits) + index.js
```

## Agency website

- Same header and footer on every page: edit `site/partials/`, never copy them into pages.
- New page: add `site/pages/<name>.html` with front matter (`title`, `description`, optional `nav`), it is served at `/<name>`.
  Add it to `nav` in `site/content.json` if it belongs in the menu.
- Projects in "Travaux récents": `work` in `site/content.json` (currently placeholders until real clients are added).
  `tone` = yellow | lilac | mint | pink.
- Styles: only `site/assets/site.css`, tokens in `:root`. No inline styles or inline scripts — the CSP blocks them.
- The hero must fit the first screen on desktop and phones (`.hero` min-height + title size use svh). Check at
  1440×900, 1280×720, 1024×768, 820×1180, 390×844, 360×640 after any hero change.
- Template tags: `{{site.name}}`, `{{#each work}} {{.name}} {{/each}}`, `{{#if .mid}}…{{else}}…{{/if}}`, `{{> header}}`.

## Contact form

`POST /api/contact` (JSON from site.js, or a plain form post without JS). Required: name, business, contact.
Honeypot field `website`. Max 5 sends / IP / hour. Stored in KV as `contact:<date>:<id>`; read at `/outils/messages`.
No email notification (needs a custom domain + Cloudflare Email Routing).

## Photo tool (`/outils`)

Batch photo cleanup for client sites. The browser sends images + one prompt to `POST /api/images/edit`; the Worker
only adds `OPENAI_API_KEY` and streams to OpenAI `/v1/images/edits`. Files: `public/outils/index.html`, `public/outils/app.js`, `public/app.css`.

## Client CMS (`/<client>`)

- Client config: `src/clients/<id>.json` (brand, `repo`, `content_path`, `password_secret`, credits, editable fields with
  min/max/type). Register it in `src/clients/index.js`. Add the client's logo/favicon in `public/clients/<id>/`.
- Text edits: validated server-side against the field rules, then committed to the client's `content/site.json` via the
  GitHub Contents API (`GITHUB_TOKEN`, fine-grained, Contents read/write on client repos). The client's Worker rebuilds.
- Requests & credits: KV `<id>:requests`. Estimates in `src/estimate.js`: fixed table; unknown requests = "À estimer"
  (credits null, nothing reserved); shop/payment/app etc. = "Hors forfait – devis séparé". Requests handled < 24 h.

## Security rules (keep them)

- Secrets ONLY in Cloudflare (Worker → Settings → Variables and Secrets): `TOOLS_PASSWORD`, `OPENAI_API_KEY`,
  `GITHUB_TOKEN`, one `<CLIENT>_CMS_PASSWORD` per client. Never in code, never in git. `.dev.vars` (local, gitignored) holds test values only.
- Only `dist/` is published, and build.mjs only copies `site/assets/` and `public/` into it. Never put private files in those folders.
- `run_worker_first: true`: every request passes through the Worker → security headers on everything,
  `/outils*` and `/api/images/*` need the team session, private pages get `X-Robots-Tag: noindex` + `Cache-Control: no-store`.
- CSP: site pages allow only own files + Google Fonts (no inline code). Tools/CMS also allow inline styles and data:/blob: images.
- POSTs from another origin are refused. Logins: 10 attempts / IP / 15 min (team and each CMS).
- Sessions: HMAC cookies, 30 days, HttpOnly + Secure + SameSite=Strict; changing a password logs everyone out.

## Local dev

`npm install`, then `npx wrangler dev` (runs the build, uses `.dev.vars`, local KV). Screenshot pages with Playwright
before shipping visual changes.
