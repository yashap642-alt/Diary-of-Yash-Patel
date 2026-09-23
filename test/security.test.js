/* ============================================================================
   Reel — does the door actually hold?

     node test/security.test.js

   It starts the real server (serve.js, which mounts the same api/moments.js
   Vercel runs) against a throwaway shelf, then tries to break the rules:

     · a visitor must never receive a draft, the trash, or the audit trail
     · a write must be refused without a live keeper session, from another
       site, or with a forged, expired or revoked cookie
     · the password must not be guessable at speed (rate limit, lockout)
     · the second factor must work, and a recovery code must work once
     · ids and payloads must be validated, sizes capped
     · deletion must be reversible, and snapshots must exist to restore
     · the shelf must not be readable through the project file browser

   Every check below is one line of output. No check is claimed that this file
   does not run.
   ==========================================================================*/
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KEY = 'the draft nobody should read: sk-9f2c-secret-marker';
const TRASHED = 'a moment that was deleted, marker REMOVED-7b1';

let bad = 0, ran = 0;
function check(ok, what, extra) {
  ran++;
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + what + (extra ? ' \u2014 ' + extra : ''));
  if (!ok) bad++;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ── the keeper's test credentials, made here, not in the repository ─────── */
const PASS = 'correct horse battery staple';
const HASH = require(path.join(ROOT, 'api/moments.js'))._internals.scryptHash(PASS);
const SECRET = crypto.randomBytes(32).toString('base64url');
const TOTP = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';           /* RFC 6238 test secret */
const RECOVERY = ['AAAAA-BBBBB', 'CCCCC-DDDDD'];
const RECOVERY_HASHES = RECOVERY.map(c => crypto.createHash('sha256').update(c).digest('hex')).join(',');

const internals = require(path.join(ROOT, 'api/moments.js'))._internals;
const code = () => internals.totpAt(TOTP, Math.floor(Date.now() / 1000 / 30));

function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function forgeSession(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + sig;
}

function startServer(env, port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'serve.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', REEL_TRUST_PROXY: '1' }, env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return child;
}
async function alive(port) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/api/health'); if (r.ok) return true; } catch (e) {}
    await wait(150);
  }
  return false;
}

/* a tiny client: it keeps its own cookie jar, so the test can hold a session
   and a visitor side by side */
function client(port) {
  let cookie = '';
  const jar = r => {
    const list = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.raw && r.headers.raw()['set-cookie']) || [];
    list.forEach(c => {
      const pair = c.split(';')[0];
      if (/Max-Age=0/.test(c)) cookie = '';
      else cookie = pair;
    });
  };
  return {
    get cookie() { return cookie; },
    clear() { cookie = ''; },
    async send(p, opts) {
      opts = opts || {};
      const headers = Object.assign({}, opts.headers || {});
      if (opts.ip) headers['x-forwarded-for'] = opts.ip;
      if (cookie && opts.withCookie !== false) headers.cookie = cookie;
      let body;
      if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
      if (opts.raw !== undefined) { headers['content-type'] = 'application/json'; body = opts.raw; }
      const r = await fetch('http://127.0.0.1:' + port + p, { method: opts.method || 'GET', headers: headers, body: body, redirect: 'manual' });
      jar(r);
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) {}
      return { status: r.status, headers: r.headers, text, json };
    }
  };
}
async function signIn(c, ip) {
  const one = await c.send('/api/session', { method: 'POST', ip: ip, json: { id: 'YashPatel', password: PASS } });
  if (one.json && one.json.mfa) {
    return c.send('/api/session/mfa', { method: 'POST', ip: ip, json: { ticket: one.json.ticket, code: code() } });
  }
  return one;
}

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-sec-'));
const FILE = path.join(DIR, 'moments.json');
const PORT = 8700 + (process.pid % 250);
const OPEN_PORT = PORT + 1;
let server, open400;
const author = client(PORT), visitor = client(PORT), attacker = client(PORT);

function entry(id, extra) {
  return Object.assign({
    id: id, createdAt: new Date().toISOString(), title: 'a moment called ' + id,
    raw: 'Words for ' + id + '.', summary: 'a summary', words: 4, confidence: 82,
    emotions: [{ id: 'calm', label: 'calm', pct: 60 }], published: true, deletedAt: null
  }, extra || {});
}

(async () => {
  try {
    server = startServer({
      REEL_DATA_FILE: FILE,
      REEL_ADMIN_HASH: HASH,
      REEL_SESSION_SECRET: SECRET,
      REEL_TOTP_SECRET: TOTP,
      REEL_RECOVERY_CODES: RECOVERY_HASHES,
      REEL_BACKUPS_KEPT: '12'
    }, PORT);
    if (!await alive(PORT)) throw new Error('the test server never came up');
    console.log('\n\u2014 the shape of the door \u2014');

    const health = await visitor.send('/api/health');
    check(health.status === 200 && health.json.authorConfigured === true, 'the server says an author is configured', 'readOnly=' + health.json.readOnly);
    check(health.json.mfa === true, 'and that a second factor is required');

    /* the algorithm itself, against the RFC's own numbers */
    const decode = internals.base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString();
    check(decode === '12345678901234567890', 'the TOTP secret decodes as RFC 6238 expects');
    check(internals.totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1) === '287082', 'TOTP at T=59 is 287082 (RFC 6238 vector)');
    check(internals.totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 37037036) === '081804', 'TOTP at T=1111111109 is 081804 (RFC 6238 vector)');

    console.log('\n\u2014 signing in \u2014');
    const noMfa = await visitor.send('/api/session', { method: 'POST', ip: '203.0.113.9', json: { id: 'YashPatel', password: PASS } });
    check(noMfa.status === 200 && noMfa.json.mfa === true && !!noMfa.json.ticket, 'the password alone gets a five-minute ticket, not a session');
    check(!visitor.cookie, 'and sets no cookie yet');

    const wrongCode = await visitor.send('/api/session/mfa', { method: 'POST', ip: '203.0.113.9', json: { ticket: noMfa.json.ticket, code: '000000' } });
    check(wrongCode.status === 401, 'a wrong second factor is refused', wrongCode.json && wrongCode.json.error);

    const good = await visitor.send('/api/session/mfa', { method: 'POST', ip: '203.0.113.9', json: { ticket: noMfa.json.ticket, code: code() } });
    check(good.status === 200 && good.json.role === 'keeper', 'the right code signs the keeper in');
    const setCookie = (good.headers.getSetCookie ? good.headers.getSetCookie() : []).join(' ');
    check(/HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), 'the cookie is HttpOnly and SameSite=Strict');
    check(!/role|keeper|password/i.test(visitor.cookie), 'and carries no readable identity');

    const who = await visitor.send('/api/session');
    check(who.json.role === 'keeper', 'the server tells the page that the keeper is signed in');

    console.log('\n\u2014 what a visitor may see \u2014');
    author.clear();
    await signIn(author, '198.51.100.4');
    check(author.cookie.length > 20, 'the keeper has a session on their own device');

    const seed = {
      what: 'test seed',
      entries: [
        entry('pub-1', { title: 'the moment that is published' }),
        entry('draft-1', { title: 'a draft', raw: KEY, published: false, auto: true }),
        entry('gone-1', { title: 'a deleted moment', raw: TRASHED, deletedAt: new Date().toISOString() })
      ]
    };
    const put = await author.send('/api/moments', { method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, json: seed });
    check(put.status === 200 && put.json.ok, 'the keeper can write', put.json && put.json.detail);
    check(Array.isArray(put.json.dropped) && put.json.dropped.length === 0, 'and nothing the keeper sent was dropped on the way in',
      (put.json.dropped || []).join('; ') || 'nothing dropped');
    check(put.json.counts && put.json.counts.published === 1 && put.json.counts.drafts === 1 && put.json.counts.trash === 1,
      'and it answers with what the shelf now holds', JSON.stringify(put.json.counts || null));

    const pub = await client(PORT).send('/api/moments');
    check(pub.status === 200 && pub.json.role === 'visitor', 'a stranger reading the shelf is a visitor');
    check(pub.json.entries.length === 1 && pub.json.entries[0].id === 'pub-1', 'and receives the published moment', pub.json.entries.length + ' entries');
    check(pub.text.indexOf('sk-9f2c-secret-marker') < 0, 'the draft\u2019s own words are not in the reply at all');
    check(pub.text.indexOf('REMOVED-7b1') < 0, 'nor the deleted moment');
    check(pub.text.indexOf('YashPatel') < 0, 'nor anything about the keeper');
    check(pub.json.counts && pub.json.counts.drafts === 1 && pub.json.counts.trash === 1, 'counts are honest about what is held back', JSON.stringify(pub.json.counts));
    check(!('security' in pub.json), 'and the audit trail stays on the server');

    const keeperRead = await author.send('/api/moments', { ip: '198.51.100.4' });
    check(keeperRead.json.role === 'keeper' && keeperRead.json.entries.length === 3, 'the keeper reads everything, drafts and trash included', keeperRead.json.entries.length + ' entries');
    check(Array.isArray(keeperRead.json.events) && keeperRead.json.events.length > 0, 'with the audit trail', (keeperRead.json.events[0] || {}).event);

    console.log('\n\u2014 writes that must be refused \u2014');
    const strangerWrite = await client(PORT).send('/api/moments', {
      method: 'PUT', ip: '203.0.113.77', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, json: seed
    });
    check(strangerWrite.status === 401, 'a write with no session is refused', strangerWrite.json && strangerWrite.json.error);

    const noHeader = await author.send('/api/moments', { method: 'PUT', ip: '198.51.100.4', headers: { origin: 'http://127.0.0.1:' + PORT }, json: seed });
    check(noHeader.status === 403, 'a write without the diary\u2019s own header is refused', noHeader.json && noHeader.json.error);

    const otherSite = await author.send('/api/moments', { method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'https://evil.example' }, json: seed });
    check(otherSite.status === 403, 'a write from another site is refused', otherSite.json && otherSite.json.error);

    const badSig = await client(PORT).send('/api/moments', {
      method: 'PUT', ip: '203.0.113.78', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT, cookie: 'reel_session=' + forgeSession({ sub: 'YashPatel', kind: 'session', mfa: true, epoch: '1', iat: Date.now(), exp: Date.now() + 3600000 }).split('').reverse().join('') }, json: seed
    });
    check(badSig.status === 401, 'a cookie with a broken signature is refused');

    const oldEpoch = await client(PORT).send('/api/moments', {
      method: 'PUT', ip: '203.0.113.79', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT, cookie: 'reel_session=' + forgeSession({ sub: 'YashPatel', kind: 'session', mfa: true, epoch: '99', iat: Date.now(), exp: Date.now() + 3600000 }) }, json: seed
    });
    check(oldEpoch.status === 401, 'a session from before "sign out everywhere" is refused');

    const expired = await client(PORT).send('/api/moments', {
      method: 'PUT', ip: '203.0.113.80', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT, cookie: 'reel_session=' + forgeSession({ sub: 'YashPatel', kind: 'session', mfa: true, epoch: '1', iat: Date.now() - 90000000, exp: Date.now() - 1000 }) }, json: seed
    });
    check(expired.status === 401, 'an expired session is refused');

    const legacyToken = await client(PORT).send('/api/moments', {
      method: 'PUT', ip: '203.0.113.81', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT, authorization: 'Bearer anything-at-all' }, json: seed
    });
    check(legacyToken.status === 401, 'the old shared bearer token no longer writes anything');
    check(fs.readFileSync(FILE, 'utf8').indexOf('Bearer') < 0, 'and nothing from those attempts reached the shelf');

    console.log('\n\u2014 how fast a guess can go \u2014');
    const guesser = client(PORT);
    let lastStatus = 0;
    for (let i = 0; i < 7; i++) {
      const r = await guesser.send('/api/session', { method: 'POST', ip: '192.0.2.10', json: { id: 'YashPatel', password: 'guess-' + i } });
      lastStatus = r.status;
      if (r.status === 429) { var retry = r.headers.get('retry-after'); break; }
    }
    check(lastStatus === 429, 'the sixth wrong password meets a lockout, not another guess');
    check(Number(retry) > 60, 'and is told how long to wait', 'Retry-After: ' + retry + 's');
    const lockedOut = await guesser.send('/api/session', { method: 'POST', ip: '192.0.2.10', json: { id: 'YashPatel', password: PASS } });
    check(lockedOut.status === 429, 'even the right password waits out the lockout');

    console.log('\n\u2014 a recovery code, once \u2014');
    const rec = client(PORT);
    const step1 = await rec.send('/api/session', { method: 'POST', ip: '192.0.2.40', json: { id: 'YashPatel', password: PASS } });
    const used = await rec.send('/api/session/mfa', { method: 'POST', ip: '192.0.2.40', json: { ticket: step1.json.ticket, code: RECOVERY[0] } });
    check(used.status === 200 && used.json.recovery === true, 'a recovery code signs the keeper in');
    const again = client(PORT);
    const step2 = await again.send('/api/session', { method: 'POST', ip: '192.0.2.41', json: { id: 'YashPatel', password: PASS } });
    const reuse = await again.send('/api/session/mfa', { method: 'POST', ip: '192.0.2.41', json: { ticket: step2.json.ticket, code: RECOVERY[0] } });
    check(reuse.status === 401, 'and the same code is spent after one use');

    console.log('\n\u2014 what may be stored \u2014');
    const hostile = await author.send('/api/moments', {
      method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT },
      json: { entries: [
        entry('fine-1'),
        { id: '" onmouseover="alert(1)', title: 'x', raw: 'x' },
        { id: 'ok-2', title: '<img src=x onerror=alert(1)>', raw: 'x', published: true, deletedAt: null },
        { id: '../../etc/passwd', title: 'x', raw: 'x' },
        { no: 'id at all' }
      ] }
    });
    check(hostile.status === 200, 'a hostile payload is answered, not crashed on', hostile.status);
    const after = await author.send('/api/moments', { ip: '198.51.100.4' });
    const ids = after.json.entries.map(e => e.id);
    check(ids.indexOf('" onmouseover="alert(1)') < 0 && ids.indexOf('../../etc/passwd') < 0, 'ids that could escape an attribute or a path are not stored');
    check(ids.indexOf('ok-2') >= 0, 'while a clean entry in the same payload is kept');
    check(hostile.json.dropped && hostile.json.dropped.length === 3, 'and the save says what it dropped', (hostile.json.dropped || []).length + ' dropped');
    const longTitle = await author.send('/api/moments', {
      method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT },
      json: { entries: [entry('long-1', { title: 'T'.repeat(5000), raw: 'R'.repeat(500000) })] }
    });
    const longBack = await author.send('/api/moments', { ip: '198.51.100.4' });
    const stored = longBack.json.entries.filter(e => e.id === 'long-1')[0];
    check(stored.title.length === 200 && stored.raw.length === 200000, 'over-long text is cut to the cap, not stored whole',
      stored.title.length + ' / ' + stored.raw.length);
    const badJson = await author.send('/api/moments', { method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, raw: '{not json' });
    check(badJson.status === 400, 'malformed JSON is refused', badJson.json && badJson.json.error);
    const noEntries = await author.send('/api/moments', { method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, json: { entries: 'nope' } });
    check(noEntries.status === 400, 'a payload without entries[] is refused');
    const huge = await author.send('/api/moments', { method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, raw: JSON.stringify({ entries: [entry('huge-1', { raw: 'x'.repeat(3 * 1024 * 1024) })] }) });
    check(huge.status === 413, 'and a body over the cap is refused, not buffered', 'HTTP ' + huge.status);

    console.log('\n\u2014 deleting, and un-deleting \u2014');
    const del = await author.send('/api/moments', {
      method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT },
      json: { what: 'moment removed', entries: [entry('pub-1', { deletedAt: new Date().toISOString() }), entry('draft-1', { raw: KEY, published: false })] }
    });
    check(del.status === 200, 'the keeper deletes a moment');
    const pubAfter = await client(PORT).send('/api/moments');
    check(pubAfter.json.entries.length === 0, 'the visitor sees it leave the shelf', pubAfter.json.entries.length + ' published');
    const keeperAfter = await author.send('/api/moments', { ip: '198.51.100.4' });
    check(keeperAfter.json.counts.trash === 1, 'and it is waiting in the keeper\u2019s trash, not gone');
    await author.send('/api/moments', {
      method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT },
      json: { what: 'moment restored', entries: [entry('pub-1', { deletedAt: null }), entry('draft-1', { raw: KEY, published: false })] }
    });
    const back = await client(PORT).send('/api/moments');
    check(back.json.entries.length === 1 && back.json.entries[0].id === 'pub-1', 'restoring puts it back for visitors');

    console.log('\n\u2014 the pulse \u2014');
    /* every open page asks this once a second: has anything moved? */
    const pulseV = await client(PORT).send('/api/moments/version');
    check(pulseV.status === 200 && typeof pulseV.json.revision === 'string' && pulseV.json.revision.length > 0,
      'a visitor may ask whether the shelf moved', 'revision ' + String(pulseV.json.revision).slice(0, 10));
    check(pulseV.json.counts === undefined,
      'and is told nothing about drafts or the trash', JSON.stringify(pulseV.json.counts) || 'no counts in the answer');
    const pulseK = await author.send('/api/moments/version', { ip: '198.51.100.4' });
    check(pulseK.status === 200 && pulseK.json.counts && typeof pulseK.json.counts.drafts === 'number',
      'the keeper is told how the whole shelf stands', JSON.stringify(pulseK.json.counts));
    check(pulseK.json.revision !== pulseV.json.revision, 'the keeper\u2019s pulse is about more than a visitor\u2019s');

    /* the writes below hand the shelf back the way the keeper's own page does:
       every moment exactly as it stands, with one of them changed. (A helper
       that minted fresh entries each time would change the published one's
       timestamps too, and the test would be measuring its own noise.) */
    const putWhole = async (mutate) => {
      const current = (await author.send('/api/moments', { ip: '198.51.100.4' })).json.entries;
      const next = JSON.parse(JSON.stringify(current));
      mutate(next);
      return author.send('/api/moments', {
        method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT },
        json: { what: 'the pulse section', entries: next }
      });
    };
    const withDraft = (list, change) => {
      const d = list.filter(e => e.id === 'draft-1')[0];
      change(d);
      d.changedAt = new Date().toISOString();
    };

    /* a draft being written must not wake every reader's page */
    const beforeDraftEdit = (await client(PORT).send('/api/moments/version')).json.revision;
    await putWhole(list => withDraft(list, d => { d.raw = d.raw + ' the draft grew by a sentence'; }));
    const afterDraftEdit = (await client(PORT).send('/api/moments/version')).json.revision;
    check(afterDraftEdit === beforeDraftEdit, 'editing a draft does not disturb a reader');

    /* publishing it does, and at once */
    await putWhole(list => withDraft(list, d => { d.published = true; }));
    const afterPublish = (await client(PORT).send('/api/moments/version')).json;
    check(afterPublish.revision !== beforeDraftEdit, 'publishing one changes what a reader is asked to fetch');
    check(afterPublish.at && afterPublish.at === (await client(PORT).send('/api/moments')).json.savedAt,
      'and the pulse carries the time the shelf was written', String(afterPublish.at).slice(0, 19));
    await putWhole(list => withDraft(list, d => { d.published = false; }));

    console.log('\n\u2014 snapshots \u2014');
    /* first take the shelf to a state worth coming back from: nothing published */
    await author.send('/api/moments', {
      method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT },
      json: { entries: [entry('draft-1', { raw: KEY, published: false })] }
    });
    const goneNow = await client(PORT).send('/api/moments');
    check(goneNow.json.entries.length === 0, 'the shelf can be emptied of published moments');
    const snaps = await author.send('/api/moments/snapshots', { ip: '198.51.100.4' });
    check(snaps.json.snapshots.length > 0, 'saves leave snapshots behind', snaps.json.snapshots.length + ' kept');
    const listOnDisk = fs.existsSync(path.join(DIR, 'backups')) ? fs.readdirSync(path.join(DIR, 'backups')) : [];
    check(listOnDisk.length > 0, 'and they are real files beside the shelf', listOnDisk.length + ' files');
    /* the shelf keeps only the newest few of them, so a test that means to put
       one back says which one it means and picks it from a fresh listing, right
       before asking for it. Snapshots taken in the same second sort by their
       random tail, so the file is chosen by what it holds, never by its name */
    const shelfOf = name => JSON.parse(fs.readFileSync(path.join(DIR, 'backups', name), 'utf8'));
    const holds = (name, wantDeleted) => (shelfOf(name).entries || []).some(e => e.id === 'pub-1' && (wantDeleted ? !!e.deletedAt : !e.deletedAt));
    const pickNow = wantDeleted => fs.readdirSync(path.join(DIR, 'backups'))
      .filter(f => /^moments-.*\.json$/.test(f)).sort().reverse().filter(n => holds(n, wantDeleted))[0] || null;
    const inTrash = pickNow(true);
    const victim = pickNow(false);
    check(!!victim, 'one of them holds the moment that was deleted, published as it was', victim || 'none');
    check(!!inTrash, 'and one of them holds it as it sat in the trash', inTrash || 'none');
    const backFromTrash = await author.send('/api/moments/restore', { method: 'POST', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, json: { name: inTrash } });
    const hiddenAgain = await client(PORT).send('/api/moments');
    check(backFromTrash.status === 200 && !hiddenAgain.json.entries.some(e => e.id === 'pub-1'),
      'a snapshot taken while it sat in the trash keeps it hidden from visitors',
      'http ' + backFromTrash.status + ' | visitor sees ' + hiddenAgain.json.entries.map(e => e.id).join(','));
    const restore = await author.send('/api/moments/restore', { method: 'POST', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, json: { name: pickNow(false) } });
    check(restore.status === 200 && restore.json.count > 0, 'a snapshot puts it all back',
      restore.json.restored || ('http ' + restore.status + ' ' + JSON.stringify(restore.json).slice(0, 120)));
    const restoredPub = await client(PORT).send('/api/moments');
    check(restoredPub.json.entries.some(e => e.id === 'pub-1'), 'and the visitor sees the restored moment again');
    const weird = await author.send('/api/moments/restore', { method: 'POST', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT }, json: { name: '../../etc/passwd' } });
    check(weird.status === 404, 'a snapshot name that is not a snapshot is refused');
    /* the cap is a real cap: write more often than it allows and the oldest
       snapshots make room, so a long-lived site cannot grow a folder forever */
    for (let i = 0; i < 14; i++) {
      await author.send('/api/moments', {
        method: 'PUT', ip: '198.51.100.4', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + PORT },
        json: { entries: [entry('draft-1', { raw: KEY + ' page ' + i, published: false })] }
      });
    }
    const capped = await author.send('/api/moments/snapshots', { ip: '198.51.100.4' });
    check(capped.json.snapshots.length === 12, 'and it keeps no more snapshots than it is told to', capped.json.snapshots.length + ' kept');
    /* which file goes is not worth asserting: a whole suite can run inside one
       second, and inside one second the names sort by their random tail. What
       must hold is that the folder itself cannot grow forever */
    const filesNow = fs.readdirSync(path.join(DIR, 'backups')).filter(f => /^moments-.*\.json$/.test(f)).length;
    check(filesNow === 12, 'and the folder beside the shelf cannot grow past it', filesNow + ' files on disk');

    console.log('\n\u2014 other sites, and other routes \u2014');
    const foreign = await fetch('http://127.0.0.1:' + PORT + '/api/moments', { headers: { origin: 'https://evil.example' } });
    check(!foreign.headers.get('access-control-allow-origin'), 'a foreign origin gets no CORS permission to read');
    const own = await fetch('http://127.0.0.1:' + PORT + '/api/moments', { headers: { origin: 'http://127.0.0.1:' + PORT } });
    check(own.headers.get('access-control-allow-origin') === 'http://127.0.0.1:' + PORT, 'our own page still may');
    const diary = await fetch('http://127.0.0.1:' + PORT + '/diary');
    check(diary.headers.get('x-frame-options') === 'DENY', 'the diary refuses to be framed');
    check(diary.headers.get('x-content-type-options') === 'nosniff', 'and does not allow MIME sniffing');
    check(/frame-ancestors 'none'/.test(diary.headers.get('content-security-policy') || ''), 'and says so in the policy as well');
    const projectShelf = await fetch('http://127.0.0.1:' + PORT + '/project/moments.json');
    check(projectShelf.status === 404, 'the shelf is not readable through the project file browser');
    const projectBackups = await fetch('http://127.0.0.1:' + PORT + '/project/backups/');
    check(projectBackups.status === 404, 'nor are the snapshots');
    const staticShelf = await fetch('http://127.0.0.1:' + PORT + '/moments.json');
    const staticText = await staticShelf.text();
    check(staticShelf.status === 200 && staticText.indexOf('sk-9f2c-secret-marker') < 0, 'the static shelf a hosting provider would serve holds no draft');
    const envProbe = await fetch('http://127.0.0.1:' + PORT + '/project/.env');
    check(envProbe.status === 404, 'and nothing that looks like an environment file is served');

    console.log('\n\u2014 signing out \u2014');
    const out = await author.send('/api/session', { method: 'DELETE', ip: '198.51.100.4' });
    check(out.status === 200, 'the keeper signs out');
    check(/Max-Age=0/.test((out.headers.getSetCookie ? out.headers.getSetCookie() : []).join(' ')), 'and the cookie is cleared');
    const afterOut = await author.send('/api/moments', { ip: '198.51.100.4' });
    check(afterOut.json.role === 'visitor', 'the desk is a visitor\u2019s again');

    console.log('\n\u2014 a server with no author configured \u2014');
    open400 = startServer({ REEL_DATA_FILE: path.join(DIR, 'open.json'), REEL_ADMIN_HASH: '', REEL_SESSION_SECRET: '' }, OPEN_PORT);
    if (await alive(OPEN_PORT)) {
      const oc = client(OPEN_PORT);
      const h = await oc.send('/api/health');
      check(h.json.readOnly === true, 'it calls itself read-only');
      const s = await oc.send('/api/session', { method: 'POST', json: { id: 'YashPatel', password: PASS } });
      check(s.status === 503 && /REEL_ADMIN_HASH/.test(JSON.stringify(s.json)), 'signing in explains exactly what to set', s.json && s.json.error);
      const w = await oc.send('/api/moments', { method: 'PUT', headers: { 'x-reel': '1', origin: 'http://127.0.0.1:' + OPEN_PORT }, json: { entries: [entry('nope-1')] } });
      check(w.status === 401, 'and there is no way in at all', 'HTTP ' + w.status);
      check(!fs.existsSync(path.join(DIR, 'open.json')), 'nothing was written to the shelf');
      const r = await oc.send('/api/moments');
      check(r.status === 200 && r.json.entries.length === 0, 'reading still works, as it should');
    } else {
      check(false, 'the unconfigured server came up');
    }

    console.log('\n' + (bad ? bad + ' SECURITY CHECK(S) FAILED' : 'ALL SECURITY CHECKS PASSED') + ' (' + ran + ' checks)');
  } catch (err) {
    console.log('\n  the suite itself broke: ' + (err && err.stack || err));
    bad++;
  } finally {
    if (server) server.kill();
    if (open400) open400.kill();
  }
  process.exit(bad ? 1 : 0);
})();
