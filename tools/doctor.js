#!/usr/bin/env node
/* ============================================================================
   Reel — deploy doctor.

     node tools/doctor.js

   Checks the things that actually break a GitHub Pages or Vercel deploy of
   this project, and says what to do about each one. Run it before you push.
   ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let hard = 0, notes = 0;
const ok = (what, extra) => console.log('  ✓ ' + what + (extra ? '  → ' + extra : ''));
const warn = (what, fix) => { notes++; console.log('  ! ' + what + '\n      fix: ' + fix); };
const bad = (what, fix) => { hard++; console.log('  ✗ ' + what + '\n      fix: ' + fix); };

console.log('\n— the project —');
const need = ['reel-diary.html', 'build.js', 'package.json', 'vercel.json', 'api/moments.js', 'src/app.js', 'src/store.js', 'src/auth.js'];
need.forEach(f => {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) ok(f, (fs.statSync(p).size / 1024).toFixed(1) + ' kb');
  else if (f === 'reel-diary.html') bad(f + ' is missing', 'run: node build.js');
  else warn(f + ' is missing', 'that file belongs to the project — restore it from the repository');
});

console.log('\n— the build —');
const built = path.join(ROOT, 'reel-diary.html');
if (fs.existsSync(built)) {
  const html = fs.readFileSync(built, 'utf8');
  const stale = ['src/app.js', 'src/ui.css', 'src/engine.js', 'src/auth.js', 'src/store.js', 'src/shell.html']
    .filter(f => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).mtimeMs > fs.statSync(built).mtimeMs);
  if (stale.length) warn('the built page is older than ' + stale.join(', '), 'run: node build.js');
  else ok('the built page is newer than every source');

  ['ReelAuth', 'ReelStore', 'REEL'].forEach(mark =>
    html.includes(mark) ? ok('the built page carries ' + mark) : bad('the built page does not carry ' + mark, 'run: node build.js'));
  if (/hari2114ya|971264/.test(html)) bad('a password is written into the built page', 'check src/auth.js — only verifiers belong there');
  else ok('no plaintext password in the built page');
} else bad('reel-diary.html is missing', 'run: node build.js');

console.log('\n— the backend —');
try {
  const api = require(path.join(ROOT, 'api', 'moments.js'));
  typeof api === 'function' || typeof api.handler === 'function'
    ? ok('api/moments.js exports a handler')
    : bad('api/moments.js exports nothing callable', 'its module.exports must be the handler');
} catch (e) { bad('api/moments.js will not load: ' + e.message, 'fix the file — Vercel will fail the same way'); }

const hasFile = fs.existsSync(path.join(ROOT, 'moments.json'));
ok(hasFile ? 'moments.json exists (published shelf)' : 'no moments.json yet', hasFile ? 'visitors read it on load' : 'the keeper can commit one');

console.log('\n— what the host will do —');
let vj = {};
try { vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); } catch (e) {}
if (vj.buildCommand) ok('vercel.json build: ' + vj.buildCommand);
else warn('vercel.json has no buildCommand', 'Vercel will guess; keep "node build.js" or leave the file as shipped');
if (vj.outputDirectory === '.') ok('vercel.json serves the project root');
else warn('vercel.json outputDirectory is ' + JSON.stringify(vj.outputDirectory), '"." is right for this layout');
if (vj.functions && vj.functions['api/moments.js']) ok('vercel.json declares the /api/moments function');
else warn('vercel.json does not declare api/moments.js', 'without it Vercel may not build the function');

const script = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
/['"]\/home\/|['"]\/Users\//.test(script)
  ? bad('build.js writes to an absolute path', 'a hosted build cannot write outside the project')
  : ok('build.js writes only inside the project');

console.log('\n— could a host mistake this for something else? —');
const VITE_MARKERS = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs'];
function viteSearch(dir, depth) {
  if (depth > 2) return [];
  let found = [];
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return found; }
  for (const it of items) {
    if (['node_modules', '.git', '.cache', 'dist', 'build', '.next', '.arena'].includes(it.name)) continue;
    const full = path.join(dir, it.name);
    if (!it.isDirectory() && VITE_MARKERS.includes(it.name)) found.push(full);
    if (!it.isDirectory() && it.name === 'package.json') {
      try {
        const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
        const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
        if (deps && deps.vite) found.push(full + '  (depends on vite)');
        if (pkg.scripts && /vite/.test(pkg.scripts.build || '')) found.push(full + '  (build script runs vite)');
      } catch (e) {}
    }
    if (it.isDirectory()) found = found.concat(viteSearch(full, depth + 1));
  }
  return found;
}
const markers = viteSearch(path.join(ROOT, '..'), 0).concat(viteSearch(ROOT, 0));
if (markers.length) {
  warn('something here still smells of Vite:\n      ' + markers.join('\n      '),
    'a host that sees this runs `vite build`, which is not installed (exit 127).\n' +
    '      Remove those files, or make the framework explicit — this repo already ships\n' +
    '      vercel.json with "framework": null at the root of the repository.');
} else {
  ok('no Vite config, no Vite dependency, no `vite build` script');
}

/* the project is the repository root now: one layout, checked in one place */
const rv = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); } catch (e) { return null; } })();
if (rv) {
  (rv.framework === null || rv.framework === undefined)
    ? ok('vercel.json pins no framework', 'so a host cannot guess "vite build"')
    : warn('vercel.json names a framework: ' + rv.framework, 'set it to null — this project needs no framework');
  rv.buildCommand ? ok('the host runs the build: ' + rv.buildCommand)
    : warn('vercel.json has no buildCommand', 'set "buildCommand": "node build.js"');
  const toDiary = (rv.rewrites || []).some(r => r.destination === '/reel-diary.html');
  toDiary ? ok('the root serves the diary', 'rewrites / → /reel-diary.html')
          : warn('the root does not open the diary', 'add a rewrite from "/" to "/reel-diary.html"');
} else warn('there is no vercel.json', 'a host will guess the framework — and "vite build" is what it guesses');
fs.existsSync(path.join(ROOT, 'package.json')) ? ok('the repository has a package.json')
  : warn('no package.json', 'add one so a host stops guessing');

console.log('\n— the environment the deploy will meet —');
if (process.env.VERCEL) ok('running on Vercel');
const env = ['REEL_ADMIN_HASH', 'REEL_SESSION_SECRET', 'REEL_TOTP_SECRET', 'REEL_RECOVERY_CODES',
  'REEL_KEEPER_ID', 'REEL_SESSION_EPOCH', 'REEL_DATA_FILE', 'REEL_BACKUPS_KEPT',
  'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
const set = env.filter(k => process.env[k]);
if (set.length) ok('set here: ' + set.join(', '));
else notes && 0;
console.log('  · writes need the keeper on the host: REEL_ADMIN_HASH, REEL_SESSION_SECRET and REEL_TOTP_SECRET\n' +
  '  · in Environment Variables — node tools/keys.js makes all of them');
console.log('  · persistence on Vercel needs KV_REST_API_URL + KV_REST_API_TOKEN (Upstash/Vercel KV)');
console.log('  · on a machine with a disk, REEL_DATA_FILE picks the JSON file (default ./moments.json)');

console.log('\n' + (hard ? hard + ' thing(s) would break the deploy — fix those first'
  : notes ? 'nothing fatal — ' + notes + ' thing(s) worth a look' : 'everything checks out — safe to push'));
process.exit(hard ? 1 : 0);
