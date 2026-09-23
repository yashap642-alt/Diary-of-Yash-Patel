/* ============================================================================
   Reel — /api/moments, and the keeper's door.

   One self-contained handler, three hosts:

     · on Vercel            api/moments.js is the function for /api/*
     · under serve.js       the same file is mounted for /api/*
     · from a test          require() it and drive it with a fake request

   THE RULES THIS FILE ENFORCES (they are not enforced anywhere else):

     · a visitor may read, and only ever reads what is PUBLISHED. A draft, a
       moment in the trash, and the audit trail never leave this process for
       anybody who is not signed in as the keeper.
     · the keeper is whoever holds a live session cookie. The cookie is signed
       here, expires here, and can be cancelled here. Nothing in the browser
       decides who the keeper is: a forged flag in localStorage unlocks a
       screen and then every write is refused by this file.
     · the password is checked against REEL_ADMIN_HASH (scrypt) and never
       leaves the environment. There is no password in the source, and no
       password in the browser.
     · a second factor (TOTP, RFC 6238) if REEL_TOTP_SECRET is set, with
       one-time recovery codes that are stored hashed.
     · repeated failures are slowed down and then locked out, counted per
       source and per identity. Retry-After says how long.
     · every save writes a timestamped snapshot first, and deletion is soft:
       a deleted moment moves to the trash and can be brought back.
     · what is written is validated: known fields only, capped lengths, ids
       that cannot escape an HTML attribute, 2 MB of body at most.

   WHAT IT DOES NOT DO: it does not store the shelf. The shelf lives in the
   key/value store or the file named by REEL_DATA_FILE, exactly as before.
   ==========================================================================*/
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP = 'Reel';
const OWNER = 'Yash Patel';
const VERSION = 3;

/* ── configuration, read once, from the environment ──────────────────────── */
function env(name, dflt) {
  const v = process.env[name];
  return (v === undefined || v === null || v === '') ? dflt : v;
}
function num(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return dflt;   /* '' is not zero */
  const n = Number(raw);
  return Number.isFinite(n) ? n : dflt;
}
function flag(name, dflt) { const v = env(name, ''); return v === '' ? dflt : /^(1|true|yes|on)$/i.test(v); }

const CFG = {
  keeperId: env('REEL_KEEPER_ID', 'YashPatel'),
  hash: env('REEL_ADMIN_HASH', ''),
  devPassword: env('REEL_ADMIN_PASSWORD', ''),      /* development only, warned about */
  secret: env('REEL_SESSION_SECRET', ''),
  epoch: String(env('REEL_SESSION_EPOCH', '1')),
  sessionHours: num('REEL_SESSION_HOURS', 12),
  sessionMaxDays: num('REEL_SESSION_MAX_DAYS', 7),
  totp: env('REEL_TOTP_SECRET', ''),
  recovery: env('REEL_RECOVERY_CODES', '').split(',').map(s => s.trim()).filter(Boolean),
  corsOrigin: env('REEL_CORS_ORIGIN', ''),
  cookieName: env('REEL_COOKIE_NAME', 'reel_session'),
  trustProxy: flag('REEL_TRUST_PROXY', false),
  loginMax: num('REEL_LOGIN_MAX', 5),
  loginWindowMin: num('REEL_LOGIN_WINDOW_MIN', 15),
  mfaMax: num('REEL_MFA_MAX', 5),
  writeMax: num('REEL_WRITE_MAX', 240),
  writeWindowMin: num('REEL_WRITE_WINDOW_MIN', 10),
  maxBody: num('REEL_MAX_BODY', 2 * 1024 * 1024),
  maxEntries: num('REEL_MAX_ENTRIES', 5000),
  backupsKept: num('REEL_BACKUPS_KEPT', 30),
  kvUrl: env('KV_REST_API_URL', env('UPSTASH_REDIS_REST_URL', '')),
  kvToken: env('KV_REST_API_TOKEN', env('UPSTASH_REDIS_REST_TOKEN', '')),
  kvKey: env('REEL_KV_KEY', 'reel:moments'),
  file: env('REEL_DATA_FILE', path.join(process.cwd(), 'moments.json'))
};

const usingKv = !!(CFG.kvUrl && CFG.kvToken);
const authorConfigured = !!(CFG.hash || CFG.devPassword);
const sessionsUsable = !!CFG.secret;

/* ── small tools ─────────────────────────────────────────────────────────── */
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  try { return crypto.timingSafeEqual(A, B); } catch (e) { return false; }
}
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/* scrypt$N$r$p$salt$key  — what tools/keys.js prints */
function scryptCheck(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  if (!N || !r || !p || !salt.length || !want.length) return false;
  const got = crypto.scryptSync(String(password), salt, want.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return safeEqual(got, want);
}
function scryptHash(password, N) {
  N = N || 16384;
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32, { N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return ['scrypt', N, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

/* RFC 6238, SHA-1, 6 digits, 30-second steps, one step of slack either way */
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '', out = Buffer.alloc(0);
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    bits += A.indexOf(ch).toString(2).padStart(5, '0');
    while (bits.length >= 8) { out = Buffer.concat([out, Buffer.from([parseInt(bits.slice(0, 8), 2)])]); bits = bits.slice(8); }
  }
  return out;
}
function totpAt(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const mac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code = ((mac[off] & 0x7f) << 24 | mac[off + 1] << 16 | mac[off + 2] << 8 | mac[off + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
function totpCheck(secretB32, code, nowMs) {
  const step = Math.floor((nowMs || Date.now()) / 1000 / 30);
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) return false;
  for (const d of [-1, 0, 1]) if (safeEqual(totpAt(secretB32, step + d), code)) return true;
  return false;
}

/* ── who is asking ───────────────────────────────────────────────────────── */
function clientIp(req) {
  if (CFG.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd.slice(0, 45);
  }
  const sock = (req.socket && (req.socket.remoteAddress || req.connection && req.connection.remoteAddress)) || '';
  return String(sock).replace(/^::ffff:/, '').slice(0, 45) || 'unknown';
}
function proto(req) {
  const f = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (f) return f;
  return (req.socket && req.socket.encrypted) ? 'https' : 'http';
}
function hostOf(req) { return String(req.headers.host || '').toLowerCase(); }
function originOf(req) { return proto(req) + '://' + hostOf(req); }
function isLocalHost(req) {
  const h = hostOf(req).split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
}
/* a write must come from our own page: a custom header (which a foreign site
   cannot send without a preflight we do not allow) plus a matching Origin */
function sameOriginOk(req) {
  const o = req.headers.origin;
  if (!o) return true;                       /* curl and friends: header check still applies */
  const allowed = CFG.corsOrigin.split(',').map(s => s.trim()).filter(Boolean);
  return o === originOf(req) || allowed.indexOf(o) >= 0;
}
function corsHeaders(req) {
  const o = req.headers.origin;
  if (!o) return {};
  const allowed = CFG.corsOrigin.split(',').map(s => s.trim()).filter(Boolean);
  if (o === originOf(req) || allowed.indexOf(o) >= 0) {
    return {
      'Access-Control-Allow-Origin': o,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'content-type, x-reel',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Vary': 'Origin'
    };
  }
  return {};                                 /* no header: the browser refuses it */
}

/* ── slower and slower ───────────────────────────────────────────────────── */
const buckets = new Map();                   /* key → { hits:[ms], until:ms } */
function limited(name, max, windowMin) {
  const now = Date.now(), b = buckets.get(name);
  if (!b) return null;
  if (b.until > now) return Math.ceil((b.until - now) / 1000);
  const fresh = b.hits.filter(t => now - t < windowMin * 60000);
  if (fresh.length >= max) {
    const over = fresh.length - max;
    const waitMs = Math.min(15 * 60000 * Math.pow(2, Math.min(over, 6)), 24 * 3600000);
    b.until = now + waitMs;
    b.hits = fresh;
    return Math.ceil(waitMs / 1000);
  }
  return null;
}
function noted(name, ok, windowMin) {
  const now = Date.now();
  let b = buckets.get(name);
  if (!b) { b = { hits: [], until: 0 }; buckets.set(name, b); }
  if (ok) { b.hits = []; b.until = 0; return; }
  b.hits = b.hits.filter(t => now - t < windowMin * 60000);
  b.hits.push(now);
}
function limitKeys(scope, req, identity) {
  return [scope + ':ip:' + clientIp(req), scope + ':id:' + (identity || '-')];
}
function tooMany(res, scope, req, identity, max, windowMin, extra) {
  for (const k of limitKeys(scope, req, identity)) {
    const wait = limited(k, max, windowMin);
    if (wait) {
      res.setHeader && res.setHeader('Retry-After', String(wait));
      send(res, 429, Object.assign({
        error: 'too many attempts',
        wait: wait,
        say: 'Too many tries. Give it ' + Math.ceil(wait / 60) + ' minute' + (wait > 90 ? 's' : '') + ' and try once more.'
      }, extra || {}), req);
      return true;
    }
  }
  return false;
}
function noteAttempt(scope, req, identity, ok, windowMin) {
  limitKeys(scope, req, identity).forEach(k => noted(k, ok, windowMin));
}

/* ── the shelf: one document, wherever it is kept ────────────────────────── */
const kvHeaders = () => ({ 'Authorization': 'Bearer ' + CFG.kvToken, 'Content-Type': 'application/json' });
async function kvGet(key) {
  const r = await fetch(CFG.kvUrl + '/get/' + encodeURIComponent(key), { headers: kvHeaders(), cache: 'no-store' });
  if (!r.ok) throw new Error('kv read failed (' + r.status + ')');
  const body = await r.json();
  if (!body || body.result == null) return null;
  const val = body.result;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch (e) { return null; }
}
async function kvSet(key, value) {
  const r = await fetch(CFG.kvUrl + '/set/' + encodeURIComponent(key), {
    method: 'POST', headers: kvHeaders(), body: JSON.stringify(JSON.stringify(value))
  });
  if (!r.ok) throw new Error('kv write failed (' + r.status + ')');
}
async function shelfGet() {
  if (usingKv) return kvGet(CFG.kvKey);
  try { return JSON.parse(fs.readFileSync(CFG.file, 'utf8')); } catch (e) { return null; }
}
async function shelfPut(doc) {
  if (usingKv) return kvSet(CFG.kvKey, doc);
  const dir = path.dirname(CFG.file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const tmp = path.join(dir, '.' + path.basename(CFG.file) + '.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, CFG.file);
}

/* ── the pulse ──────────────────────────────────────────────────────────────
   Every open page asks this once a second: "has anything moved?" The answer is
   a short string, and a momentary memory cache means a hundred readers cost one
   read of the shelf per tick rather than a hundred. What a visitor's pulse is
   built from is only what a visitor can see, so a draft being written does not
   wake every reader's page. */
const PULSE_MS = Math.max(0, num('REEL_PULSE_MS', 350));
let pulse = { at: 0, visitor: null, keeper: null, counts: null, savedAt: null };

function hash32(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function signatureOf(list) {
  return list.map(e => [e.id, e.changedAt || e.createdAt || '', e.deletedAt ? 1 : 0,
    e.published ? 1 : 0, (e.title || '').length, (e.raw || '').length, (e.summary || '').length].join('~')).join('|');
}
function pulseOf(doc) {
  if (!doc) return { visitor: 'empty', keeper: 'empty', counts: { published: 0, drafts: 0, trash: 0 }, savedAt: null };
  const published = doc.entries.filter(e => e.published && !e.deletedAt);
  return {
    visitor: hash32(signatureOf(published)),
    keeper: hash32(signatureOf(doc.entries) + '|' + (doc.savedAt || '')),
    counts: {
      published: published.length,
      drafts: doc.entries.filter(e => !e.published && !e.deletedAt).length,
      trash: doc.entries.filter(e => !!e.deletedAt).length
    },
    savedAt: doc.savedAt || null
  };
}
function pulseClear() { pulse.at = 0; }

/* ── snapshots, and getting one back ─────────────────────────────────────── */
function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}
function backupDir() { return path.join(path.dirname(CFG.file), 'backups'); }
async function snapshot(doc) {
  const name = 'moments-' + stamp(new Date()) + '-' + crypto.randomBytes(2).toString('hex') + '.json';
  try {
    if (usingKv) {
      await kvSet(CFG.kvKey + ':snap:' + name, doc);
      const index = (await kvGet(CFG.kvKey + ':snaps')) || [];
      index.unshift(name);
      await kvSet(CFG.kvKey + ':snaps', index.slice(0, CFG.backupsKept));
    } else {
      fs.mkdirSync(backupDir(), { recursive: true });
      fs.writeFileSync(path.join(backupDir(), name), JSON.stringify(doc, null, 2));
      const all = fs.readdirSync(backupDir()).filter(f => /^moments-.*\.json$/.test(f)).sort();
      all.slice(0, Math.max(0, all.length - CFG.backupsKept)).forEach(f => { try { fs.unlinkSync(path.join(backupDir(), f)); } catch (e) {} });
    }
    return name;
  } catch (e) {
    return null;                             /* a failed snapshot must not stop the save */
  }
}
async function listSnapshots() {
  try {
    if (usingKv) return ((await kvGet(CFG.kvKey + ':snaps')) || []).map(name => ({ name: name }));
    return fs.readdirSync(backupDir()).filter(f => /^moments-.*\.json$/.test(f)).sort().reverse()
      .map(f => ({ name: f, bytes: fs.statSync(path.join(backupDir(), f)).size }));
  } catch (e) { return []; }
}
async function readSnapshot(name) {
  if (!/^moments-[0-9]{8}-[0-9]{6}-[a-f0-9]{4}\.json$/.test(String(name))) return null;
  try {
    if (usingKv) return await kvGet(CFG.kvKey + ':snap:' + name);
    return JSON.parse(fs.readFileSync(path.join(backupDir(), name), 'utf8'));
  } catch (e) { return null; }
}

/* ── what may be stored: known fields only, capped, ids that stay ids ────── */
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const CAPS = {
  id: 64, title: 200, titleStyle: 40, raw: 200000, summary: 2000, logline: 2000,
  highlight: 1000, scene: 40, confidence: 8, words: 8, when: 40, createdAt: 40,
  changedAt: 40, deletedAt: 40, publishedAt: 40
};
const STR_LIST = { altTitles: 200 };
const OBJ_LIST = { emotions: 60, allEmotions: 60, physical: 40, mental: 40, themes: 40, crossLinks: 10 };
function str(v, cap) {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, cap);
}
/* an object of the shapes the diary actually uses: primitives, short lists of
   primitives, one level of nesting. Keys that could poison a prototype are
   dropped, every string is capped, and nothing unknown survives. */
const NO_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
function cleanObject(o, depth) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  Object.keys(o).slice(0, 30).forEach(k => {
    if (NO_KEYS[k]) return;
    const v = o[k];
    if (v === null || v === undefined) return;
    if (typeof v === 'string') out[k] = str(v, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = cleanList(v, 12, t => (typeof t === 'string' ? str(t, 200)
      : (typeof t === 'number' && Number.isFinite(t) ? t : null)));
    else if (!depth && typeof v === 'object') {
      const n = cleanObject(v, 1);
      if (n && Object.keys(n).length) out[k] = n;
    }
  });
  return out;
}
function cleanList(list, cap, item) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, cap).map(item).filter(v => v !== null && v !== undefined);
}
function cleanEntry(raw, seen, repair) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  if (typeof raw.id === 'string' && ID_OK.test(raw.id) && !seen[raw.id]) { out.id = raw.id; seen[raw.id] = 1; }
  else if (repair) {
    /* moving an older shelf in: an id that would break a page is replaced, not
       thrown away with the moment it belongs to */
    let id, tries = 0;
    do { id = 'moved-' + Math.random().toString(36).slice(2, 10); } while (seen[id] && ++tries < 60);
    out.id = id; seen[id] = 1;
  }
  else return null;
  for (const k of ['title', 'summary', 'logline', 'highlight', 'titleStyle', 'when', 'createdAt', 'changedAt', 'deletedAt', 'publishedAt']) {
    if (raw[k] === null || raw[k] === undefined) continue;
    out[k] = str(raw[k], CAPS[k] || 200);
  }
  /* the scene and the life-phase are little objects the page paints with:
     they keep their shape, within reason */
  if (raw.scene && typeof raw.scene === 'object') { const c = cleanObject(raw.scene, 0); if (c) out.scene = c; }
  else if (typeof raw.scene === 'string') out.scene = str(raw.scene, 40);
  out.raw = str(raw.raw === undefined ? '' : raw.raw, CAPS.raw);
  out.words = Number.isFinite(Number(raw.words)) ? Math.max(0, Math.min(1000000, Math.round(Number(raw.words)))) : undefined;
  out.confidence = Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(raw.confidence)))) : undefined;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  if (raw.phase && typeof raw.phase === 'object') { const p = cleanObject(raw.phase, 0); if (p) out.phase = p; }
  if (raw.primary && typeof raw.primary === 'object') out.primary = { id: str(raw.primary.id, 64), name: str(raw.primary.name, 120) };
  if (raw.entities && typeof raw.entities === 'object') {
    out.entities = {};
    for (const k of ['place', 'time', 'people', 'props']) {
      out.entities[k] = cleanList(raw.entities[k], 60, t => t === null || t === undefined ? null : str(t, 200));
    }
  }
  for (const k of Object.keys(STR_LIST)) out[k] = cleanList(raw[k], STR_LIST[k], t => str(t, 200));
  for (const k of Object.keys(OBJ_LIST)) {
    out[k] = cleanList(raw[k], OBJ_LIST[k], item => {
      if (!item || typeof item !== 'object') return null;
      const o = {};
      for (const f of ['id', 'label', 'kind', 'color', 'name', 'terms']) {
        if (item[f] === null || item[f] === undefined) continue;
        o[f] = Array.isArray(item[f]) ? cleanList(item[f], 20, t => str(t, 80)) : str(item[f], 200);
      }
      if (Number.isFinite(Number(item.pct))) o.pct = Math.max(0, Math.min(100, Math.round(Number(item.pct))));
      if (Number.isFinite(Number(item.score))) o.score = Math.max(0, Math.min(100, Math.round(Number(item.score))));
      return Object.keys(o).length ? o : null;
    });
  }
  if (raw.wish && typeof raw.wish === 'object') {
    out.wish = {
      detected: !!raw.wish.detected,
      amounts: cleanList(raw.wish.amounts, 40, t => str(t, 40)),
      items: cleanList(raw.wish.items, 200, item => {
        if (!item || typeof item !== 'object') return null;
        return { text: str(item.text, 300), kind: str(item.kind, 40), checked: !!item.checked };
      })
    };
  }
  out.sample = !!raw.sample;
  /* an entry that has never said otherwise is published: that is what the
     shelf meant before drafts existed, so nothing you already wrote moves */
  out.published = raw.published === undefined ? true : !!raw.published;
  if (raw.deletedAt) out.deletedAt = str(raw.deletedAt, 40); else out.deletedAt = null;
  if (raw.auto) out.auto = true;                       /* an autosaved draft */
  if (!out.createdAt) out.createdAt = new Date().toISOString();
  if (out.published && !out.publishedAt) out.publishedAt = out.createdAt;
  return out;
}
function cleanDoc(raw, previous, opts) {
  const problems = [];
  const repair = !!(opts && opts.repair);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the shelf must be an object' };
  if (!Array.isArray(raw.entries)) return { error: 'entries[] is required' };
  if (raw.entries.length > CFG.maxEntries) return { error: 'that is more than ' + CFG.maxEntries + ' moments' };
  const seen = Object.create(null);
  const entries = [];
  raw.entries.forEach((e, i) => {
    const c = cleanEntry(e, seen, repair);
    if (c) entries.push(c);
    else problems.push('entry ' + i + ' was dropped (no usable id, or a duplicate)');
  });
  const security = (previous && previous.security) || { events: [], recoveryUsed: [] };
  return {
    doc: {
      app: APP, version: VERSION, owner: str(raw.owner, 80) || OWNER,
      savedAt: new Date().toISOString(),
      shelves: raw.shelves && typeof raw.shelves === 'object' ? raw.shelves : (previous && previous.shelves) || null,
      security: security,
      entries: entries
    },
    problems: problems
  };
}
/* reads upgrade older documents in memory: no draft, trash or flag is
   invented, and nothing is written until the keeper saves something */
function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return null;
  const seen = Object.create(null);
  const entries = raw.entries.map(e => cleanEntry(e, seen)).filter(Boolean);
  return {
    app: APP,
    version: Math.max(VERSION, Number(raw.version) || VERSION),
    owner: raw.owner || OWNER,
    savedAt: raw.savedAt || raw.exportedAt || null,
    shelves: raw.shelves || null,
    security: raw.security && typeof raw.security === 'object' ? raw.security : { events: [], recoveryUsed: [] },
    entries: entries,
    upgraded: (Number(raw.version) || 0) !== VERSION
  };
}
function publicView(doc) {
  const published = doc.entries.filter(e => e.published && !e.deletedAt);
  return {
    app: APP, version: VERSION, owner: doc.owner, savedAt: doc.savedAt,
    counts: { published: published.length, drafts: doc.entries.filter(e => !e.published && !e.deletedAt).length, trash: doc.entries.filter(e => !!e.deletedAt).length },
    count: published.length,
    empty: !doc.entries.length && !doc.savedAt,
    role: 'visitor',
    entries: published
  };
}
function keeperView(doc, snapshots) {
  return {
    app: APP, version: VERSION, owner: doc.owner, savedAt: doc.savedAt, shelves: doc.shelves,
    role: 'keeper',
    counts: {
      published: doc.entries.filter(e => e.published && !e.deletedAt).length,
      drafts: doc.entries.filter(e => !e.published && !e.deletedAt).length,
      trash: doc.entries.filter(e => !!e.deletedAt).length
    },
    entries: doc.entries,
    events: (doc.security && doc.security.events || []).slice(-40).reverse(),
    snapshots: snapshots || [],
    store: usingKv ? 'kv' : 'file'
  };
}

/* ── sessions ────────────────────────────────────────────────────────────── */
function issueToken(req, kind, extra) {
  const now = Date.now();
  const payload = {
    sub: CFG.keeperId, kind: kind, jti: crypto.randomBytes(9).toString('hex'),
    iat: now, exp: now + (kind === 'ticket' ? 5 * 60000 : CFG.sessionHours * 3600000),
    oi: now, epoch: CFG.epoch
  };
  Object.assign(payload, extra || {});
  const body = b64u(JSON.stringify(payload));
  return body + '.' + b64u(hmac(CFG.secret, body));
}
function readToken(token) {
  if (!CFG.secret || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!safeEqual(b64u(hmac(CFG.secret, body)), sig)) return null;
  let p;
  try { p = JSON.parse(unb64u(body).toString('utf8')); } catch (e) { return null; }
  if (!p || p.exp < Date.now()) return null;
  if (String(p.epoch) !== String(CFG.epoch)) return null;
  return p;
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function sessionOf(req) {
  const p = readToken(cookies(req)[CFG.cookieName]);
  if (!p || p.kind !== 'session' || !p.mfa) return null;
  return p;
}
function cookieFor(req, token, maxAgeSec, clear) {
  const bits = [
    CFG.cookieName + '=' + (clear ? '' : token),
    'Path=/', 'HttpOnly', 'SameSite=Strict',
    'Max-Age=' + (clear ? 0 : Math.max(0, Math.floor(maxAgeSec)))
  ];
  if (proto(req) === 'https' || isLocalHost(req)) bits.push('Secure');
  return bits.join('; ');
}
function renew(res, req, session) {
  if (!session) return;
  const age = Date.now() - session.iat;
  const left = session.exp - Date.now();
  const maxAge = CFG.sessionMaxDays * 86400000;
  if (left < CFG.sessionHours * 3600000 / 2 && age < maxAge) {
    const token = issueToken(req, 'session', { mfa: true, oi: session.oi || session.iat });
    res.setHeader('Set-Cookie', cookieFor(req, token, Math.min(CFG.sessionHours * 3600, Math.max(0, (maxAge - age) / 1000))));
  }
}

/* ── the audit trail, kept with the shelf, never sent to a visitor ───────── */
function record(doc, event, req, ok, detail) {
  const sec = doc.security = doc.security || { events: [], recoveryUsed: [] };
  if (!Array.isArray(sec.events)) sec.events = [];
  sec.events.push({ at: new Date().toISOString(), event: String(event).slice(0, 60), ok: !!ok, ip: clientIp(req), detail: detail ? String(detail).slice(0, 120) : undefined });
  if (sec.events.length > 200) sec.events = sec.events.slice(-200);
}

/* ── replies ─────────────────────────────────────────────────────────────── */
function send(res, code, body, req) {
  const out = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  };
  Object.assign(headers, req ? corsHeaders(req) : {});
  res.writeHead(code, headers);
  res.end(out);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let raw = '', done = false;
    req.on('data', c => {
      if (done) return;                       /* over the cap: stop keeping it, answer 413 */
      raw += c;
      if (raw.length > limit) { done = true; reject(Object.assign(new Error('too large'), { code: 413 })); }
    });
    req.on('end', () => { if (!done) resolve(raw); });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}
async function jsonBody(req) {
  const raw = await readBody(req, CFG.maxBody);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw Object.assign(new Error('that was not JSON'), { code: 400 }); }
}
function routePath(req) {
  let p = String(req.url || '/').split('?')[0];
  try { p = decodeURIComponent(p); } catch (e) {}
  return p.replace(/\/+$/, '') || '/api/moments';
}
function apiPath(req) {
  const p = routePath(req);
  const i = p.indexOf('/api/');
  return i >= 0 ? p.slice(i) : p;
}

/* ── the routes ──────────────────────────────────────────────────────────── */
async function handle(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const p = apiPath(req);

  if (method === 'OPTIONS') {
    const headers = Object.assign({ 'Allow': 'GET, POST, PUT, DELETE, OPTIONS', 'X-Content-Type-Options': 'nosniff' }, corsHeaders(req));
    res.writeHead(204, headers);
    return res.end();
  }

  if (p === '/api/health') {
    return send(res, 200, {
      ok: true, app: APP, version: VERSION,
      authorConfigured: authorConfigured,
      sessions: sessionsUsable,
      mfa: !!CFG.totp,
      store: usingKv ? 'kv' : 'file',
      readOnly: !authorConfigured || !sessionsUsable
    }, req);
  }

  /* ── who am I ─────────────────────────────────────────────────────────── */
  if (p === '/api/session' && method === 'GET') {
    const s = sessionOf(req);
    if (s) renew(res, req, s);
    return send(res, 200, {
      role: s ? 'keeper' : 'visitor',
      id: s ? s.sub : null,
      expiresAt: s ? new Date(s.exp).toISOString() : null,
      authorConfigured: authorConfigured,
      mfa: !!CFG.totp,
      server: true
    }, req);
  }

  /* ── signing in ───────────────────────────────────────────────────────── */
  if (p === '/api/session' && method === 'POST') {
    if (tooMany(res, 'login', req, '-', CFG.loginMax, CFG.loginWindowMin)) return;
    if (!authorConfigured) {
      return send(res, 503, {
        error: 'this site has no author configured yet',
        say: 'Nothing can be written until the host knows your password. Run "node reel/tools/keys.js password" and put the line it prints into the environment as REEL_ADMIN_HASH.'
      }, req);
    }
    if (!sessionsUsable) {
      return send(res, 503, {
        error: 'sessions cannot be signed here',
        say: 'The host is missing REEL_SESSION_SECRET. Run "node reel/tools/keys.js secrets" and put the lines it prints into the environment.'
      }, req);
    }
    let body;
    try { body = await jsonBody(req); } catch (e) { return send(res, e.code || 400, { error: e.message }, req); }
    const id = str(body.id, 80) || '';
    const pass = String(body.password || '').slice(0, 300);
    const idOk = safeEqual(id.toLowerCase(), CFG.keeperId.toLowerCase());
    const passOk = CFG.hash ? scryptCheck(pass, CFG.hash) : safeEqual(pass, CFG.devPassword);
    if (!idOk || !passOk) {
      noteAttempt('login', req, id || '-', false, CFG.loginWindowMin);
      const doc = normalizeDoc(await shelfGet());
      if (doc) { record(doc, 'sign-in refused', req, false, id.slice(0, 20)); try { await shelfPut(doc); } catch (e) {} }
      return send(res, 401, {
        error: idOk ? 'that password does not match' : 'no keeper by that ID',
        say: idOk ? 'That password does not match. Nothing was written.' : 'There is no keeper by that ID. Nothing was written.'
      }, req);
    }
    noteAttempt('login', req, id, true, CFG.loginWindowMin);
    if (CFG.totp) {
      const ticket = issueToken(req, 'ticket');
      return send(res, 200, { mfa: true, ticket: ticket, say: 'One more thing: the six digits from your authenticator.' }, req);
    }
    const token = issueToken(req, 'session', { mfa: true });
    res.setHeader('Set-Cookie', cookieFor(req, token, CFG.sessionHours * 3600));
    const doc = normalizeDoc(await shelfGet());
    if (doc) { record(doc, 'signed in', req, true); try { await shelfPut(doc); } catch (e) {} }
    return send(res, 200, { role: 'keeper', id: CFG.keeperId, signedInFor: CFG.sessionHours * 3600, say: 'You are the keeper.' }, req);
  }

  /* ── the second factor ────────────────────────────────────────────────── */
  if (p === '/api/session/mfa' && method === 'POST') {
    if (tooMany(res, 'mfa', req, '-', CFG.mfaMax, CFG.loginWindowMin)) return;
    let body;
    try { body = await jsonBody(req); } catch (e) { return send(res, e.code || 400, { error: e.message }, req); }
    const ticket = readToken(body.ticket);
    if (!ticket || ticket.kind !== 'ticket') return send(res, 401, { error: 'that sign-in expired', say: 'Start again: the code step is only good for five minutes.' }, req);
    const code = String(body.code || '').replace(/\s+/g, '');
    let doc = normalizeDoc(await shelfGet());
    const spent = (doc && doc.security && doc.security.recoveryUsed) || [];
    let ok = false, used = '', spentAlready = false;
    if (totpCheck(CFG.totp, code)) ok = true;
    else if (CFG.recovery.length) {
      const h = sha256(code.toUpperCase());
      if (CFG.recovery.some(c => safeEqual(c.toLowerCase(), h))) {
        if (spent.indexOf(h) >= 0) spentAlready = true;     /* written down, already used */
        else { ok = true; used = h; }
      }
    }
    if (spentAlready) {
      noteAttempt('mfa', req, ticket.sub, false, CFG.loginWindowMin);
      return send(res, 401, {
        error: 'that recovery code has already been used',
        say: 'Each recovery code works once. Use the next one, or the six digits from your authenticator.'
      }, req);
    }
    if (!ok) {
      noteAttempt('mfa', req, ticket.sub, false, CFG.loginWindowMin);
      return send(res, 401, { error: 'that code is not right', say: 'That code does not match. Check the clock on your phone and try again.' }, req);
    }
    noteAttempt('mfa', req, ticket.sub, true, CFG.loginWindowMin);
    const token = issueToken(req, 'session', { mfa: true });
    res.setHeader('Set-Cookie', cookieFor(req, token, CFG.sessionHours * 3600));
    /* a recovery code is spent once: the spent hash is written down with the
       shelf, so the same code cannot sign anybody in twice */
    if (!doc) doc = { app: APP, version: VERSION, owner: OWNER, savedAt: null, shelves: null, security: { events: [], recoveryUsed: [] }, entries: [] };
    if (used) {
      doc.security = doc.security || { events: [], recoveryUsed: [] };
      doc.security.recoveryUsed = (doc.security.recoveryUsed || []).concat([used]).slice(-50);
      record(doc, 'recovery code used', req, true);
    } else record(doc, 'second factor accepted', req, true);
    try { await shelfPut(doc); } catch (e) {}
    return send(res, 200, { role: 'keeper', id: ticket.sub, recovery: !!used, say: used ? 'That recovery code is now spent. It will not work again.' : 'You are the keeper.' }, req);
  }

  /* ── signing out ──────────────────────────────────────────────────────── */
  if ((p === '/api/session' && method === 'DELETE') || p === '/api/session/logout') {
    res.setHeader('Set-Cookie', cookieFor(req, '', 0, true));
    const s = sessionOf(req);
    if (s) {
      const doc = normalizeDoc(await shelfGet());
      if (doc) { record(doc, 'signed out', req, true); try { await shelfPut(doc); } catch (e) {} }
      pulseClear();
    }
    return send(res, 200, { role: 'visitor', say: 'Signed out. Reading stays open.' }, req);
  }

  /* ── the pulse: one short answer, small enough to ask every second ────── */
  if (p === '/api/moments/version' && method === 'GET') {
    const session = sessionOf(req);
    const now = Date.now();
    if (!pulse.at || now - pulse.at > PULSE_MS) {
      let doc = null;
      try { doc = normalizeDoc(await shelfGet()); } catch (err) { doc = null; }
      const fresh = pulseOf(doc);
      pulse = { at: now, visitor: fresh.visitor, keeper: fresh.keeper, counts: fresh.counts, savedAt: fresh.savedAt };
    }
    if (session) { renew(res, req, session); }
    /* a visitor is told what a visitor may know: whether what they can read has
       changed. How many drafts are waiting is the keeper's business. */
    return send(res, 200, session
      ? { ok: true, role: 'keeper', revision: pulse.keeper, at: pulse.savedAt, counts: pulse.counts, store: usingKv ? 'kv' : 'file' }
      : { ok: true, role: 'visitor', revision: pulse.visitor, at: pulse.savedAt, store: usingKv ? 'kv' : 'file' }, req);
  }

  /* ── reading: published only, unless you are the keeper ───────────────── */
  if (p === '/api/moments' && method === 'GET') {
    let doc;
    try { doc = normalizeDoc(await shelfGet()); } catch (err) { return send(res, 500, { error: 'the shelf could not be read' }, req); }
    const session = sessionOf(req);
    if (session) {
      renew(res, req, session);
      if (doc) {
        const snapshots = await listSnapshots();
        return send(res, 200, keeperView(doc, snapshots), req);
      }
      return send(res, 200, {
        app: APP, version: VERSION, owner: OWNER, savedAt: null, role: 'keeper', entries: [],
        counts: { published: 0, drafts: 0, trash: 0 }, events: [], snapshots: [], store: usingKv ? 'kv' : 'file'
      }, req);
    }
    if (doc) return send(res, 200, publicView(doc), req);
    return send(res, 200, {
      app: APP, version: VERSION, owner: OWNER, savedAt: null, entries: [], count: 0, empty: true,
      counts: { published: 0, drafts: 0, trash: 0 }, role: 'visitor', store: usingKv ? 'kv' : 'file'
    }, req);
  }

  /* ── writing: keeper only, on their own page, within the limits ───────── */
  if (p === '/api/moments' && (method === 'PUT' || method === 'POST')) {
    if (req.headers['x-reel'] !== '1' || !sameOriginOk(req)) {
      return send(res, 403, { error: 'that request did not come from the diary', say: 'Writes have to come from the diary itself.' }, req);
    }
    const session = sessionOf(req);
    if (!session) {
      return send(res, 401, {
        error: 'not signed in',
        say: 'Only the keeper may write. Sign in on the diary itself and try again. Nothing was written.'
      }, req);
    }
    if (tooMany(res, 'write', req, session.sub, CFG.writeMax, CFG.writeWindowMin)) return;
    if (!usingKv && process.env.VERCEL) {
      return send(res, 501, {
        error: 'the shelf cannot be written on this host',
        say: 'This function has no disk and no key/value store attached. Add Upstash KV (KV_REST_API_URL + KV_REST_API_TOKEN) in the project environment, or use the GitHub back.'
      }, req);
    }
    let body;
    try { body = await jsonBody(req); } catch (e) {
      noteAttempt('write', req, session.sub, false, CFG.writeWindowMin);
      return send(res, e.code || 400, { error: e.message }, req);
    }
    const previous = normalizeDoc(await shelfGet());
    const clean = cleanDoc(body, previous);
    if (clean.error) return send(res, 400, { error: clean.error, say: 'Nothing was written.' }, req);
    const incoming = clean.doc;
    /* the audit trail and spent recovery codes are the server's, not the
       client's: they are carried over, never taken from the request */
    incoming.security = (previous && previous.security) || { events: [], recoveryUsed: [] };
    record(incoming, body.what ? String(body.what).slice(0, 60) : 'shelf saved', req, true,
      clean.problems.length ? clean.problems.length + ' dropped' : '');
    const snapshotName = previous ? await snapshot(previous) : null;
    try {
      await shelfPut(incoming);
    } catch (err) {
      return send(res, 500, { error: 'the shelf could not be written', say: 'Nothing changed. Try again in a moment.' }, req);
    }
    pulseClear();                                   /* the next second carries it */
    noteAttempt('write', req, session.sub, true, CFG.writeWindowMin);
    renew(res, req, session);
    return send(res, 200, {
      ok: true, role: 'keeper', savedAt: incoming.savedAt,
      count: incoming.entries.length,
      counts: keeperView(incoming, []).counts,
      snapshot: snapshotName,
      dropped: clean.problems,
      detail: usingKv ? 'saved to the key/value store' : 'saved to ' + path.basename(CFG.file)
    }, req);
  }

  /* ── snapshots: list them, or put one back ────────────────────────────── */
  if (p === '/api/moments/snapshots' && method === 'GET') {
    if (!sessionOf(req)) return send(res, 401, { error: 'not signed in' }, req);
    return send(res, 200, { snapshots: await listSnapshots() }, req);
  }
  if (p === '/api/moments/restore' && method === 'POST') {
    if (!sameOriginOk(req) || req.headers['x-reel'] !== '1') return send(res, 403, { error: 'that request did not come from the diary' }, req);
    const session = sessionOf(req);
    if (!session) return send(res, 401, { error: 'not signed in', say: 'Only the keeper may restore.' }, req);
    let body;
    try { body = await jsonBody(req); } catch (e) { return send(res, e.code || 400, { error: e.message }, req); }
    const snap = await readSnapshot(body.name);
    if (!snap) return send(res, 404, { error: 'no such snapshot', say: 'Pick one from the list in the desk.' }, req);
    const current = await shelfGet();
    if (current) await snapshot(current);              /* the state you are leaving, kept too */
    const restored = cleanDoc(snap, null);
    if (restored.error) return send(res, 400, { error: 'that snapshot could not be read' }, req);
    restored.doc.security = (current && current.security) || { events: [], recoveryUsed: [] };
    record(restored.doc, 'shelf restored from ' + String(body.name).slice(0, 60), req, true);
    await shelfPut(restored.doc);
    pulseClear();
    return send(res, 200, { ok: true, restored: body.name, count: restored.doc.entries.length }, req);
  }

  send(res, 404, { error: 'no such route' }, req);
}

module.exports = handle;
module.exports.handler = handle;
module.exports._internals = { CFG, scryptHash, scryptCheck, totpAt, totpCheck, cleanDoc, normalizeDoc, publicView, base32Decode, buckets, pulseOf, pulseClear };
