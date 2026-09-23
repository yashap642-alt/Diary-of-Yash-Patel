#!/usr/bin/env node
/* ============================================================================
   Reel — put a backed-up shelf back.

     node tools/restore.js                      list what could be restored
     node tools/restore.js --latest             restore the newest snapshot
     node tools/restore.js --file <path.json>   restore one named snapshot
     node tools/restore.js --file <snap> --yes  skip the question

   A snapshot is a whole shelf, taken by the site itself before every write it
   makes (the server keeps the last REEL_BACKUPS_KEPT of them, 30 by default).
   Restoring is itself a write, so the shelf you are about to replace is copied
   aside first: nothing is ever the only place a moment lives.
   ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const server = require('../api/moments.js');
const I = server._internals;

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const DATA = arg('--data', process.env.REEL_DATA_FILE || path.join(process.cwd(), 'moments.json'));
const BACKUPS = path.join(path.dirname(DATA), 'backups');

function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function uniqueName(dir, base) {
  let name = base;
  for (let i = 0; i < 60 && fs.existsSync(path.join(dir, name)); i++) {
    name = base.replace(/\.json$/, '-' + Math.random().toString(36).slice(2, 6) + '.json');
  }
  return name;
}

function snaps() {
  if (!fs.existsSync(BACKUPS)) return [];
  return fs.readdirSync(BACKUPS)
    .filter(f => /\.json$/.test(f))
    .map(f => {
      const full = path.join(BACKUPS, f);
      const st = fs.statSync(full);
      let count = null;
      try { const d = JSON.parse(fs.readFileSync(full, 'utf8')); count = Array.isArray(d.entries) ? d.entries.length : null; } catch (e) { count = null; }
      return { file: full, name: f, at: st.mtime, bytes: st.size, count: count };
    })
    .sort((a, b) => b.at - a.at);
}

function describe(s, i) {
  const when = s.at.toISOString().slice(0, 16).replace('T', ' ');
  const kept = s.count === null ? 'unreadable' : s.count + ' moment' + (s.count === 1 ? '' : 's');
  return '  ' + (i === 0 ? '\u25b8' : ' ') + ' ' + (i + 1) + '. ' + s.name + '  \u00b7  ' + when + '  \u00b7  ' + kept + '  \u00b7  ' + Math.round(s.bytes / 1024) + ' kb';
}

const all = snaps();

if (!has('--file') && !has('--latest')) {
  console.log('\n  shelf: ' + DATA);
  if (!all.length) {
    console.log('  no snapshots yet. They are made by the site before every write.');
    console.log('  If you keep this site on a host, look for the same folder beside the shelf file.\n');
    process.exit(0);
  }
  console.log('  ' + all.length + ' snapshot' + (all.length === 1 ? '' : 's') + ', newest first:');
  all.forEach(describe);
  console.log('\n  restore one with:  node tools/restore.js --file "' + all[0].file + '"');
  console.log('  or the newest with: node tools/restore.js --latest\n');
  process.exit(0);
}

const pick = has('--latest') ? (all[0] && all[0].file) : path.resolve(arg('--file'));
if (!pick) { console.log('\n  no snapshots to restore.\n'); process.exit(1); }
if (!fs.existsSync(pick)) { console.log('\n  no such snapshot: ' + pick + '\n'); process.exit(1); }

let doc;
try { doc = JSON.parse(fs.readFileSync(pick, 'utf8')); }
catch (err) { console.log('\n  that snapshot is not readable: ' + err.message + '\n'); process.exit(1); }
const cleaned = I.cleanDoc(doc, doc, { repair: true });
if (cleaned.error) { console.log('\n  that snapshot was refused: ' + cleaned.error + '\n'); process.exit(1); }

const now = fs.existsSync(DATA) ? (() => { try { const d = JSON.parse(fs.readFileSync(DATA, 'utf8')); return Array.isArray(d.entries) ? d.entries.length : 0; } catch (e) { return 0; } })() : 0;
const then = cleaned.doc.entries.length;
const when = fs.statSync(pick).mtime.toISOString().slice(0, 16).replace('T', ' ');

console.log('\n  snapshot: ' + path.basename(pick) + '   taken ' + when);
console.log('  the live shelf holds ' + now + ' moment' + (now === 1 ? '' : 's') + '; this snapshot holds ' + then + '.');
console.log('  restoring replaces the live shelf with the snapshot (the live one is copied aside first).');

function doIt() {
  fs.mkdirSync(BACKUPS, { recursive: true });
  if (fs.existsSync(DATA)) {
    const before = path.join(BACKUPS, uniqueName(BACKUPS, path.basename(DATA, '.json') + '-' + stamp(new Date()) + '-before-restore.json'));
    fs.copyFileSync(DATA, before);
    console.log('\n  the shelf you had: ' + before);
  }
  const tmp = path.join(path.dirname(DATA), '.' + path.basename(DATA) + '.restore.tmp');
  fs.writeFileSync(tmp, JSON.stringify(cleaned.doc, null, 2));
  fs.renameSync(tmp, DATA);
  console.log('  restored: ' + then + ' moment' + (then === 1 ? '' : 's') + ' are back on the shelf.\n');
}

if (has('--yes') || has('-y') || !process.stdin.isTTY) { doIt(); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('  go ahead? (y/N) ', a => {
  rl.close();
  if (/^y(es)?$/i.test(a.trim())) doIt();
  else console.log('  nothing was changed.\n');
  process.exit(0);
});
