#!/usr/bin/env node
/* ============================================================================
   Reel — the whole project, on one link.

     node serve.js            # http://localhost:8080  (PORT to change)

   It serves, from this one origin:

     /                 the diary itself (the built single-file app)
     /diary            the same page, at the name it has always had
     /download         reel-diary.html as a download
     /project/…        every source, test, tool and screenshot in the repo
     /project.zip      the whole repo as a zip (no node_modules, no caches)
     /moments.json     the shelf as a file, for a static host
     /api/moments      the live backend: GET the shelf, PUT a new one
                       (api/moments.js — the same handler Vercel deploys;
                        REEL_DATA_FILE picks the file, KV_* picks a key/value store,
                        the keeper's sign-in locks the writes; with no
                        REEL_ADMIN_HASH set the endpoint is read-only)

   Zero dependencies. Binds 0.0.0.0 so a hosting proxy or a phone on the same
   network can both reach it.
   ==========================================================================*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const api = require('./api/moments.js');                  /* the same handler Vercel runs */

const ROOT = __dirname;                              /* the project, and the repo root */
const SINGLE = process.env.REEL_DIARY || path.join(ROOT, 'reel-diary.html');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.zip': 'application/zip', '.wav': 'audio/wav', '.mp3': 'audio/mpeg'
};

const SKIP = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'coverage']);

function send(res, code, type, body, extra) {
  const head = Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, extra || {});
  res.writeHead(code, head);
  if (body === null) res.end();
  else res.end(body);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

/* take the policy the built page carries and add what only a header can say */
function cspFrom(page) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page || '');
  const base = m ? m[1].replace(/;\s*frame-ancestors[^;]*/i, '') : "default-src 'self'";
  return base + "; frame-ancestors 'none'";
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ── listing the project, for /project/ ──────────────────────────────────── */
function listDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => !SKIP.has(d.name) && !d.name.startsWith('.'))
    .map(d => ({ name: d.name, dir: d.isDirectory(), size: d.isDirectory() ? null : fs.statSync(path.join(dir, d.name)).size }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

/* ── the whole repo as a zip, made when it is asked for ──────────────────── */
function zipRepo(res) {
  const out = path.join(require('os').tmpdir(), 'reel-project.zip');
  execFile('zip', ['-r', '-q', out, '.',
    '-x', 'node_modules/*', '-x', '.git/*', '-x', '.cache/*', '-x', '.npm/*', '-x', '.config/*',
    '-x', '.local/*', '-x', '*.DS_Store', '-x', '*.zip', '-x', 'moments.json', '-x', 'backups/*'],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }, (err) => {
    if (err) return send(res, 500, 'text/plain; charset=utf-8', 'could not zip: ' + err.message);
    const body = fs.readFileSync(out);
    send(res, 200, 'application/zip', body, { 'Content-Disposition': 'attachment; filename="reel-project.zip"' });
  });
}

/* ── the tests, run on request ───────────────────────────────────────────── */
let testCache = { at: 0, body: null };
function runTests(res, only) {
  const fresh = Date.now() - testCache.at < 60000;
  if (fresh && !only) return send(res, 200, TYPES['.txt'], testCache.body);
  const suites = only ? [only] : ['test/ui.test.js', 'test/contrast.test.js'];
  const lines = [], start = Date.now();
  let i = 0;
  const next = () => {
    if (i >= suites.length) {
      const body = lines.join('\n') + '\n— ' + suites.join(' · ') + ' in ' + ((Date.now() - start) / 1000).toFixed(1) + 's —\n';
      if (!only) testCache = { at: Date.now(), body: body };
      return send(res, 200, TYPES['.txt'], body);
    }
    const file = suites[i++];
    lines.push('\n$ node ' + file);
    execFile('node', [file], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      lines.push((stdout || '').trim());
      if (stderr) lines.push((stderr || '').trim());
      if (err) lines.push('(exited ' + (err.code || err.message) + ')');
      next();
    });
  };
  next();
}

/* ── serving ─────────────────────────────────────────────────────────────── */
/* files that are nobody's business through a directory listing: the shelf
   itself (it holds drafts), the snapshots, and anything that ever held a key */
const PRIVATE_NAME = /(^|\/)(moments\.json|moments\..*\.json|\.env[a-z.]*|.*\.tmp|backups?)(\/|$)/i;
const PRIVATE_SECRET = /(id_rsa|\.pem$|\.key$|credentials|secrets?\.json|\.netrc)/i;
function isPrivate(rel) {
  const clean = decodeURIComponent(rel || '').replace(/^\/+/, '');
  return PRIVATE_NAME.test(clean) || PRIVATE_SECRET.test(clean);
}

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, decodeURIComponent(rel)));
  return p.startsWith(root) ? p : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = url.pathname;

  if (p === '/' || p === '/index.html' || p === '/diary' || p === '/diary/') {
    if (!fs.existsSync(SINGLE)) return send(res, 404, TYPES['.txt'], 'not built yet — run: node build.js');
    const page = fs.readFileSync(SINGLE, 'utf8')
      .replace('</title>', '</title>\n<link rel="icon" href="/favicon.svg">');
    return send(res, 200, TYPES['.html'], page, Object.assign({}, SECURITY_HEADERS, {
      /* the page carries its own script hashes; this adds what a meta tag
         cannot say: nobody may frame the diary */
      'Content-Security-Policy': cspFrom(page)
    }));
  }
  if (p === '/download') {
    if (!fs.existsSync(SINGLE)) return send(res, 404, TYPES['.txt'], 'not built yet');
    return send(res, 200, TYPES['.html'], fs.readFileSync(SINGLE),
      { 'Content-Disposition': 'attachment; filename="reel-diary.html"' });
  }
  if (p === '/project.zip') return zipRepo(res);
  if (p === '/moments.json') {
    /* what a static host would serve: published moments only. The file on disk
       may hold drafts and the trash; this path never hands those out. */
    const f = process.env.REEL_DATA_FILE || path.join(ROOT, 'moments.json');
    let body = JSON.stringify({ app: 'Reel', entries: [], count: 0 });
    try {
      const doc = api._internals.normalizeDoc(JSON.parse(fs.readFileSync(f, 'utf8')));
      if (doc) body = JSON.stringify(api._internals.publicView(doc), null, 2);
    } catch (e) { /* an empty shelf, not an error, so a visitor's console stays quiet */ }
    return send(res, 200, TYPES['.json'], body);
  }
  if (p.startsWith('/api/')) {
    /* the whole API: shelf, sessions, second factor, snapshots. One handler,
       the same file Vercel deploys as its function. */
    process.env.REEL_DATA_FILE = process.env.REEL_DATA_FILE || path.join(ROOT, 'moments.json');
    return api(req, res);
  }
  if (p === '/favicon.ico' || p === '/favicon.svg') {
    return send(res, 200, TYPES['.svg'],
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1d26"/>' +
      '<path d="M20 14h10a9 9 0 0 1 0 18h-10z" fill="#ddab61"/><path d="M20 32h13a10 10 0 0 1 0 18H20z" fill="#924520"/>' +
      '<rect x="14" y="14" width="4" height="36" fill="#e7dfcb"/></svg>');
  }
  if (p === '/tests') return runTests(res, url.searchParams.get('only'));

  if (p === '/health') return send(res, 200, TYPES['.json'], JSON.stringify({ ok: true, root: ROOT }));

  const rel = p.startsWith('/project/') ? p.slice('/project'.length) : null;
  if (rel === null) return send(res, 404, TYPES['.txt'], 'not found');
  if (isPrivate(rel)) return send(res, 404, TYPES['.txt'], 'not found');   /* the shelf is not source code */
  const abs = safeJoin(ROOT, rel || '/');
  if (!abs || !fs.existsSync(abs)) return send(res, 404, TYPES['.txt'], 'not found');
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    const rows = listDir(abs);
    const body = `<!doctype html><meta charset="utf-8"><title>${esc(rel)}</title>
<style>body{font:15px/1.7 ui-sans-serif,system-ui,sans-serif;background:#e7dfcb;color:#212732;padding:36px;max-width:820px;margin:0 auto}
a{color:#924520;text-decoration:none}a:hover{text-decoration:underline}li{margin:4px 0;list-style:none}
h1{font-family:Palatino,Georgia,serif;font-weight:400;font-size:22px}</style>
<h1>${esc(rel || '/')}</h1><ul>
<li><a href="/project/">… root</a></li>
${rows.map(r => `<li><a href="/project${rel}${rel.endsWith('/') ? '' : '/'}${encodeURIComponent(r.name)}">${esc(r.name)}${r.dir ? '/' : ''}</a></li>`).join('')}
</ul>`;
    return send(res, 200, TYPES['.html'], body);
  }
  const ext = path.extname(abs).toLowerCase();
  send(res, 200, TYPES[ext] || 'application/octet-stream', fs.readFileSync(abs));
});

server.listen(PORT, HOST, () => {
  console.log('REEL is served');
  console.log('  local      http://localhost:' + PORT + '/');
  console.log('  the diary  http://localhost:' + PORT + '/diary');
  console.log('  the code   http://localhost:' + PORT + '/project/');
  console.log('  the zip    http://localhost:' + PORT + '/project.zip');
  console.log('  the back   http://localhost:' + PORT + '/api/moments  →  ' +
    (process.env.KV_REST_API_URL ? 'key/value store' : (process.env.REEL_DATA_FILE || path.join(ROOT, 'moments.json'))));
});
