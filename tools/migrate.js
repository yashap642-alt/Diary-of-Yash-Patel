#!/usr/bin/env node
/* ============================================================================
   Reel — bring an older shelf up to the current shape, without losing a word.

     node tools/migrate.js                  upgrade REEL_DATA_FILE (or ./moments.json)
     node tools/migrate.js --file path.json
     node tools/migrate.js --dry-run        say what would change, write nothing

   What it does, in order:

     1. copies the shelf to backups/moments-<stamp>-pre-migration.json
     2. reads every moment through the same validation the server uses, so a
        field that would be refused at the door is fixed here instead
     3. gives every moment what the new shape expects:
          published    true unless it says otherwise (what was public stays public)
          deletedAt    null
          id           a safe id, if the old one could break a page
        and reports anything that was dropped
     4. writes the result next to the original, atomically

   Nothing is deleted, and the copy from step 1 is what you would restore from.
   ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const server = require('../api/moments.js');

const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const fileArg = argv.indexOf('--file');
const FILE = (fileArg >= 0 ? argv[fileArg + 1] : '') || process.env.REEL_DATA_FILE || path.join(process.cwd(), 'moments.json');
const I = server._internals;

if (!fs.existsSync(FILE)) {
  console.log('\n  nothing to migrate: ' + FILE + ' does not exist yet.');
  console.log('  (a shelf appears the first time the keeper saves something)\n');
  process.exit(0);
}

function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
/* two writes in the same second must not land on the same name: a copy is the
   one thing that may never overwrite another copy */
function uniqueName(dir, base) {
  let name = base;
  for (let i = 0; i < 60 && fs.existsSync(path.join(dir, name)); i++) {
    name = base.replace(/\.json$/, '-' + Math.random().toString(36).slice(2, 6) + '.json');
  }
  return name;
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  console.log('\n  that file is not JSON: ' + err.message + '\n');
  process.exit(1);
}

const before = Array.isArray(raw.entries) ? raw.entries : [];
const cleaned = I.cleanDoc(raw, raw, { repair: true });
if (cleaned.error) {
  console.log('\n  the shelf could not be read: ' + cleaned.error + '\n');
  process.exit(1);
}
const after = cleaned.doc.entries;

const drafts = after.filter(e => e.published === false).length;
const trash = after.filter(e => e.deletedAt).length;
const idFixes = before.filter(e => !e || typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(e.id)).length;
const newHere = after.filter(e => e.published === true && !e.publishedAt).length;

console.log('\n  shelf: ' + FILE);
console.log('  version ' + (raw.version || 1) + '  \u2192  version ' + cleaned.doc.version);
console.log('  moments ' + before.length + '  \u2192  ' + after.length);
console.log('  ' + drafts + ' draft' + (drafts === 1 ? '' : 's') + ' \u00b7 ' + trash + ' in the trash \u00b7 ' + (after.length - drafts - trash) + ' published');
if (idFixes) console.log('  ' + idFixes + ' moment' + (idFixes === 1 ? '' : 's') + ' had an id that could break a page: a safe one was made');
if (newHere) console.log('  ' + newHere + ' moment' + (newHere === 1 ? '' : 's') + ' that had no published flag are treated as published (they were public before)');
if (cleaned.problems.length) {
  console.log('  dropped:');
  cleaned.problems.slice(0, 12).forEach(p => console.log('    \u00b7 ' + p));
  if (cleaned.problems.length > 12) console.log('    \u00b7 and ' + (cleaned.problems.length - 12) + ' more');
}

if (dry) {
  console.log('\n  --dry-run: nothing was written.\n');
  process.exit(0);
}

const dir = path.dirname(FILE);
const backups = path.join(dir, 'backups');
fs.mkdirSync(backups, { recursive: true });
const copy = path.join(backups, uniqueName(backups, path.basename(FILE, '.json') + '-' + stamp(new Date()) + '-pre-migration.json'));
fs.writeFileSync(copy, JSON.stringify(raw, null, 2));

const tmp = path.join(dir, '.' + path.basename(FILE) + '.migrate.tmp');
fs.writeFileSync(tmp, JSON.stringify(cleaned.doc, null, 2));
fs.renameSync(tmp, FILE);

console.log('\n  the shelf was upgraded.');
console.log('  the copy it was upgraded from: ' + copy);
console.log('  put it back with: node tools/restore.js --file ' + copy + '\n');
