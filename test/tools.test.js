#!/usr/bin/env node
/* ============================================================================
   Reel — the moving-in tools.

     node test/tools.test.js

   These two scripts are what stand between a shelf written before this round
   and a shelf that keeps every word of it. So they get the same treatment as
   the rest of the site: a real file, real runs, real assertions.
   ==========================================================================*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIGRATE = path.join(ROOT, 'tools', 'migrate.js');
const RESTORE = path.join(ROOT, 'tools', 'restore.js');
const server = require(path.join(ROOT, 'api', 'moments.js'));

let bad = 0, run = 0;
const check = (ok, what, extra) => {
  run++;
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${what}${extra ? ' \u2014 ' + extra : ''}`);
  if (!ok) bad++;
};
const run$ = (script, args) => spawnSync(process.execPath, [script].concat(args), { encoding: 'utf8' });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-tools-'));
const SHELF = path.join(dir, 'moments.json');
const backups = () => (fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : []);

/* a shelf from before this round: no version 3 fields, an id that would break
   a page, one private draft, one public moment, a security log in use */
const LEGACY = {
  app: 'Reel', version: 1, owner: 'Yash Patel', exportedAt: '2026-01-02T03:04:05.000Z',
  security: { events: [{ at: '2026-01-01T00:00:00.000Z', what: 'signin' }], recoveryUsed: ['abcdef123456'] },
  entries: [
    { id: 'legacy one!', title: 'Old morning', raw: 'The first line of an old moment, kept exactly as it was written.', primary: { id: 'quiet-dreams', name: 'Quiet Dreams' }, published: false },
    { id: 'seed-2', title: 'Second', raw: 'Another old line here, and it stays a public one.', primary: { id: 'moments-of-joy', name: 'Moments of Joy' } }
  ]
};
fs.writeFileSync(SHELF, JSON.stringify(LEGACY, null, 2));

console.log('\n\u2014 a shelf written before this round moves in \u2014');

const dry = run$(MIGRATE, ['--file', SHELF, '--dry-run']);
check(dry.status === 0 && /--dry-run: nothing was written/.test(dry.stdout), 'the dry run says what it would do and writes nothing');
check(JSON.stringify(JSON.parse(fs.readFileSync(SHELF, 'utf8'))) === JSON.stringify(LEGACY), 'and leaves the file exactly as it found it');

const moved = run$(MIGRATE, ['--file', SHELF]);
check(moved.status === 0, 'the migration runs', moved.stderr.trim() || 'exit 0');
const after = JSON.parse(fs.readFileSync(SHELF, 'utf8'));
check(after.entries.length === LEGACY.entries.length, 'not one moment was lost in the move', LEGACY.entries.length + ' \u2192 ' + after.entries.length);
const draft = after.entries.filter(e => e.raw.indexOf('old moment') >= 0)[0];
const publicOne = after.entries.filter(e => /Another old line/.test(e.raw))[0];
check(!!draft && draft.published === false, 'the private draft is still private');
check(!!publicOne && publicOne.published === true, 'the public moment is still public');
check(!!draft && /^[A-Za-z0-9_-]{1,64}$/.test(draft.id) && draft.id !== 'legacy one!', 'the id that would break a page became a safe one', draft ? draft.id : 'missing');
check(!!draft && draft.title === 'Old morning' && draft.primary && draft.primary.name === 'Quiet Dreams', 'and it kept its title and its shelf');
check(JSON.stringify(after.security.recoveryUsed) === JSON.stringify(LEGACY.security.recoveryUsed), 'the recovery codes already used stay used');
check(backups().some(f => /pre-migration\.json$/.test(f)), 'the shelf it came from was copied aside first', backups().join(', '));
check(after.entries.every(e => e.deletedAt === null || typeof e.deletedAt === 'string'), 'every moment carries the shape this round expects');

const strict = server._internals.cleanDoc(after, after, { repair: true });
check(!strict.error && strict.problems.length === 0, 'the migrated shelf passes the server\u2019s own validation without a single complaint', (strict.problems || []).join('; ') || 'clean');
check(after.entries.length === strict.doc.entries.length, 'and nothing a second pass would drop');

console.log('\n\u2014 a shelf comes back after a bad save \u2014');

const copy = path.join(dir, 'backups', backups().filter(f => /pre-migration/.test(f))[0]);
const back = run$(RESTORE, ['--data', SHELF, '--file', copy, '--yes']);
check(back.status === 0, 'the snapshot restores', back.stderr.trim() || 'exit 0');
const restored = JSON.parse(fs.readFileSync(SHELF, 'utf8'));
check(restored.entries.length === LEGACY.entries.length, 'the shelf holds what the snapshot held', restored.entries.length + ' moments');
check(restored.entries.filter(e => e.id === 'seed-2').length === 1, 'with the moments it had, by id');
check(backups().length >= 2, 'and the shelf being replaced was copied aside too', backups().length + ' copies on disk');

console.log('\n\u2014 two restores in the same second \u2014');
const one = run$(RESTORE, ['--data', SHELF, '--latest', '--yes']);
const two = run$(RESTORE, ['--data', SHELF, '--latest', '--yes']);
check(one.status === 0 && two.status === 0, 'both restores run');
check(new Set(backups()).size === backups().length, 'and every copy on disk is a distinct one', backups().length + ' copies');

console.log('\n\u2014 a snapshot nobody can read \u2014');
const broken = path.join(dir, 'backups', 'moments-broken.json');
fs.writeFileSync(broken, '{ this is not json');
const refused = run$(RESTORE, ['--data', SHELF, '--file', broken, '--yes']);
const watched = JSON.parse(fs.readFileSync(SHELF, 'utf8'));
check(refused.status === 1 && /not readable/.test(refused.stdout), 'it is refused, and it says why');
check(watched.entries.length === restored.entries.length, 'and the live shelf is untouched by the attempt');

console.log('\n\u2014 a shelf that does not exist yet \u2014');
const fresh = path.join(dir, 'elsewhere', 'not-yet.json');   /* nothing beside it, not even a backups folder */
const none = run$(MIGRATE, ['--file', fresh]);
check(none.status === 0 && /nothing to migrate/.test(none.stdout), 'the migration explains itself instead of failing', 'exit 0');
const list = run$(RESTORE, ['--data', fresh]);
check(list.status === 0 && /no snapshots yet/.test(list.stdout), 'and so does the restore');

fs.rmSync(dir, { recursive: true, force: true });

console.log(bad ? `\n${bad} OF ${run} TOOL CHECKS FAILED\n` : `\nALL TOOL CHECKS PASSED (${run})\n`);
process.exit(bad ? 1 : 0);
