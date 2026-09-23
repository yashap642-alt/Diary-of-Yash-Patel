const fs = require('fs');
const path = require('path');
const src = p => fs.readFileSync(path.join(__dirname, 'src', p), 'utf8');

const shell = src('shell.html');
const css = src('ui.css');
const engine = src('engine.js');
const auth = src('auth.js');
const session = src('session.js');
const store = src('store.js');
const app = src('app.js');

let out = shell
  .replace('/*__CSS__*/', () => css)
  .replace('/*__ENGINE__*/', () => engine)
  .replace('/*__AUTH__*/', () => auth)
  .replace('/*__SESSION__*/', () => session)
  .replace('/*__STORE__*/', () => store)
  .replace('/*__APP__*/', () => app);

/* ── the policy the page carries with it ──────────────────────────────────
   A meta tag travels with the file, so GitHub Pages, Netlify, a USB stick and
   this project's own server all get the same rules. The script blocks are
   hashed exactly as they are assembled, which is why this happens after the
   inlining and not before. serve.js and vercel.json add the headers a meta tag
   cannot express (frame-ancestors, nosniff, and the rest). */
const crypto = require('crypto');
const hashes = [];
const SCRIPT = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let m;
while ((m = SCRIPT.exec(out))) {
  if (!m[1].trim()) continue;
  hashes.push("'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");
}
const CSP = [
  "default-src 'none'",
  'script-src ' + hashes.join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'self' https://api.github.com",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
].join('; ');
const meta = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">';
out = out.replace('<head>', '<head>\n' + meta);
if (out.indexOf(meta) < 0) throw new Error('the policy could not be placed: is there a <head> tag?');

/* One file, one place. The page is written beside this script — the project
   root — and nowhere else: no second copy to keep in step, nothing written
   outside the folder the build was given, which is also what a host expects. */
const target = path.join(__dirname, 'reel-diary.html');

const written = [];
try {
  fs.writeFileSync(target, out);
  written.push(target);
} catch (e) {
  console.warn('could not write ' + target + ' — ' + e.message);
  process.exitCode = 1;
}
console.log('built', written.join(', '), (out.length / 1024).toFixed(1) + ' kb');
