/* ============================================================================
   Reel — the keeper's lock.

   The diary is public: anybody may open it, walk the shelves and read every
   moment. Only the keeper may add, change or delete anything. This file is
   that gate, and it is deliberately honest about what a gate on a static page
   can be:

     · no password is ever written down. What ships is PBKDF2-SHA256 verifiers
       (salt + digest) for the keeper's ID, password and PIN — the words
       themselves appear nowhere in the repository;
     · unlocking is per session (or per device, if the keeper asks for it) and
       everything re-locks when the session ends;
     · wrong attempts are throttled, doubling the wait each time;
     · a forgotten credential can be replaced after a code has been mailed to
       the keeper's own inbox — a courtesy lock, not a vault.

   A page served from GitHub Pages cannot defend its own source: a determined
   visitor can always read the script and write to their own copy of the shelf.
   What this protects is the honest case — that nobody wanders into the diary
   and edits Yash's life by accident.
   ==========================================================================*/
var ReelAuth = (function () {
  'use strict';

  var VAULT_KEY = 'reel.vault.v1';
  var SESSION_KEY = 'reel.admin.v1';
  var KEEP_KEY = 'reel.admin.keep.v1';
  var TRIES_KEY = 'reel.admin.tries.v1';
  var RESET_KEY = 'reel.admin.reset.v1';

  var MAIL = 'yashap642@gmail.com';
  var ITER = 12000;                       /* ~150ms a check: real hashing, no wait */
  var KEEP_DAYS = 30;
  var MAX_TRIES = 5;                      /* then the wait starts doubling */
  var RESET_MINUTES = 20;

  /* the keeper's defaults, as verifiers only — never as words */
  var DEFAULT_VAULT = {
    v: 1, iter: ITER, mail: MAIL, updated: null, seed: true,
    id: { salt: '5dfvdD/DWdcRnGxJ0Yxq0Q==', hash: 'BcNRLERZt+M410mhhDybbUignlkuBCekU5x7+tpIxkw=' },
    pass: { salt: 'Tz0ZCG3QxwLz2kRDTsRRdg==', hash: 'DxxYPmUI1SxEvD48SUKdtatIRFK29QveQPJ7TohhMMg=' },
    pin: { salt: 'bP2a1HUFXBWGqjd7VmybyQ==', hash: 'JntzkRu3hLt2Wh8W/+Ez8FQprvynTJpMufEoNzRz6po=' }
  };

  /* ── SHA-256 ───────────────────────────────────────────────────────────── */
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  /* one compression over a 64-byte block */
  function block(H, w, bytes, off) {
    for (var i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
             (bytes[off + i * 4 + 2] << 8) | (bytes[off + i * 4 + 3]);
    }
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  function sha256(bytes) {
    var H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var w = new Int32Array(64);
    var len = bytes.length;
    var full = (len + 9 + 63) & ~63;                 /* room for 0x80 and the length */
    var buf = new Uint8Array(full);
    buf.set(bytes);
    buf[len] = 0x80;
    var bits = len * 8;
    buf[full - 4] = (bits >>> 24) & 255; buf[full - 3] = (bits >>> 16) & 255;
    buf[full - 2] = (bits >>> 8) & 255;  buf[full - 1] = bits & 255;
    for (var off = 0; off < full; off += 64) block(H, w, buf, off);
    var out = new Uint8Array(32);
    for (var i = 0; i < 8; i++) {
      out[i * 4] = (H[i] >>> 24) & 255; out[i * 4 + 1] = (H[i] >>> 16) & 255;
      out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255;
    }
    return out;
  }

  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    var k = new Uint8Array(64);
    k.set(key);
    var inner = new Uint8Array(64 + msg.length);
    var outer = new Uint8Array(64 + 32);
    for (var i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
    inner.set(msg, 64);
    outer.set(sha256(inner), 64);
    return sha256(outer);
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {                 /* only needed if very old */
      c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function pbkdf2(password, salt, iterations, len) {
    var pw = utf8(password), out = new Uint8Array(len), done = 0, blockNo = 1;
    while (done < len) {
      var msg = new Uint8Array(salt.length + 4);
      msg.set(salt);
      msg[salt.length] = (blockNo >>> 24) & 255; msg[salt.length + 1] = (blockNo >>> 16) & 255;
      msg[salt.length + 2] = (blockNo >>> 8) & 255; msg[salt.length + 3] = blockNo & 255;
      var u = hmac(pw, msg), t = u.slice();
      for (var i = 1; i < iterations; i++) {
        u = hmac(pw, u);
        for (var j = 0; j < 32; j++) t[j] ^= u[j];
      }
      var take = Math.min(32, len - done);
      out.set(t.subarray(0, take), done);
      done += take; blockNo++;
    }
    return out;
  }

  /* ── base64 (no btoa dependency, so it runs anywhere) ─────────────────── */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      s += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)];
      s += i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c || 0) >> 6)] : '=';
      s += i + 2 < bytes.length ? B64[c & 63] : '=';
    }
    return s;
  }
  function unb64(str) {
    var clean = String(str).replace(/[^A-Za-z0-9+/]/g, '');
    var out = new Uint8Array(Math.floor(clean.length * 3 / 4)), i = 0, j = 0;
    for (; i < clean.length; i += 4) {
      var n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) |
              ((B64.indexOf(clean[i + 2]) || 0) << 6) | (B64.indexOf(clean[i + 3]) || 0);
      if (j < out.length) out[j++] = (n >> 16) & 255;
      if (j < out.length) out[j++] = (n >> 8) & 255;
      if (j < out.length) out[j++] = n & 255;
    }
    return out.subarray(0, j);
  }

  function digest(secret, saltB64, iter) {
    return b64(pbkdf2(secret, unb64(saltB64), iter || ITER, 32));
  }
  function freshSalt() {
    var b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    return b64(b);
  }
  function same(a, b) {                     /* no early exit worth timing */
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ── the vault ─────────────────────────────────────────────────────────── */
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) {} },
    sget: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    sset: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} },
    sdel: function (k) { try { window.sessionStorage.removeItem(k); } catch (e) {} }
  };

  var listeners = [];
  function announce() { listeners.forEach(function (fn) { try { fn(state()); } catch (e) {} }); }

  function vault() {
    var raw = store.get(VAULT_KEY);
    if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    var v = JSON.parse(JSON.stringify(DEFAULT_VAULT));
    v.name = 'the keeper';
    store.set(VAULT_KEY, JSON.stringify(v));
    return v;
  }
  function saveVault(v) { v.updated = new Date().toISOString(); store.set(VAULT_KEY, JSON.stringify(v)); }
  function field(secret, iter) { var salt = freshSalt(); return { salt: salt, hash: digest(String(secret), salt, iter) }; }

  /* who is signed in, and until when */
  function session() {
    var s = store.sget(SESSION_KEY);
    if (s) { try { return JSON.parse(s); } catch (e) {} }
    var k = store.get(KEEP_KEY);
    if (k) {
      try {
        var kept = JSON.parse(k);
        if (kept && kept.until && new Date(kept.until).getTime() > Date.now()) return kept;
      } catch (e) {}
      store.del(KEEP_KEY);
    }
    return null;
  }
  function state() {
    var s = session(), v = vault();
    return {
      admin: !!s, id: s ? s.id : null, kept: !!(s && s.kept), how: s ? s.by : null,
      mail: v.mail, seed: !!v.seed, updated: v.updated || null, waiting: blockedFor()
    };
  }

  function lock() { store.sdel(SESSION_KEY); store.del(KEEP_KEY); announce(); }

  /* The server has checked the password and vouched for this session. The
     mark below lives in sessionStorage, so it dies with the tab, and every
     write is checked against the server again anyway: this only decides which
     screens are on show, never what may be written. */
  function adopt(source) {
    var v = vault();
    var s = { id: v.name || 'the keeper', at: new Date().toISOString(), by: source || 'server', kept: false };
    store.sset(SESSION_KEY, JSON.stringify(s));
    announce();
    return { ok: true, by: s.by };
  }

  /* does this secret open that field? */
  function verify(id, secret) {
    var v = vault();
    if (!id) return same(digest(String(secret), v.pin.salt, v.iter), v.pin.hash)
      ? { ok: true, by: 'pin' } : { ok: false, why: 'that PIN does not open this diary' };
    var idOk = same(digest(String(id), v.id.salt, v.iter), v.id.hash);
    var passOk = same(digest(String(secret), v.pass.salt, v.iter), v.pass.hash);
    if (idOk && passOk) return { ok: true, by: 'password' };
    return { ok: false, why: idOk ? 'that password does not match' : 'no keeper by that ID' };
  }

  function unlock(id, secret, opts) {
    opts = opts || {};
    var wait = blockedFor();
    if (wait > 0) return { ok: false, wait: wait, why: 'too many tries — wait ' + wait + 's' };
    var res = verify(id, secret);
    if (!res.ok) { fail(); return { ok: false, why: res.why }; }
    succeed();
    var v = vault();
    var s = { id: id ? String(id) : (v.name || 'the keeper'), at: new Date().toISOString(), by: res.by, kept: !!opts.remember };
    if (opts.remember) {
      s.until = new Date(Date.now() + KEEP_DAYS * 864e5).toISOString();
      store.set(KEEP_KEY, JSON.stringify(s));
    }
    store.sset(SESSION_KEY, JSON.stringify(s));
    announce();
    return { ok: true, id: s.id, by: res.by };
  }

  /* ── throttling ───────────────────────────────────────────────────────── */
  function tries() {
    var raw = store.get(TRIES_KEY);
    if (!raw) return { n: 0, until: 0 };
    try { return JSON.parse(raw); } catch (e) { return { n: 0, until: 0 }; }
  }
  function blockedFor() {
    var t = tries();
    return t.until && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 1000) : 0;
  }
  function fail() {
    var t = tries();
    t.n = (t.n || 0) + 1;
    if (t.n >= MAX_TRIES) t.until = Date.now() + Math.min(8 * 60, 30 * Math.pow(2, t.n - MAX_TRIES)) * 1000;
    store.set(TRIES_KEY, JSON.stringify(t));
    announce();
  }
  function succeed() { store.del(TRIES_KEY); }

  /* ── changing the keeper's keys (needs the old one first) ─────────────── */
  function change(values) {
    var res = verify(values.currentId || null, values.currentSecret || '');
    if (!res.ok) { fail(); return { ok: false, why: res.why }; }
    succeed();
    var v = vault();
    if (values.newId) { v.id = field(values.newId, v.iter); v.name = String(values.newId); }
    if (values.newPass) v.pass = field(values.newPass, v.iter);
    if (values.newPin) v.pin = field(values.newPin, v.iter);
    if (values.mail) v.mail = String(values.mail);
    v.seed = false;
    saveVault(v);
    /* whatever was unlocked stays unlocked, under the new name */
    var s = session();
    if (s) {
      if (values.newId) { s.id = String(values.newId); store.sset(SESSION_KEY, JSON.stringify(s)); }
      if (s.kept) store.set(KEEP_KEY, JSON.stringify(s));
    }
    announce();
    return { ok: true };
  }

  /* ── the mail route, for a key that has been lost ─────────────────────── */
  function requestReset(mail) {
    var bytes = new Uint8Array(4);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    var code = '';
    for (var j = 0; j < 4; j++) code += bytes[j] % 10;
    var salt = freshSalt();
    store.set(RESET_KEY, JSON.stringify({
      salt: salt, hash: digest(code, salt, ITER), made: Date.now(),
      until: Date.now() + RESET_MINUTES * 60000, mail: mail || vault().mail
    }));
    return { code: code, mail: mail || vault().mail, minutes: RESET_MINUTES };
  }
  function checkResetCode(code) {
    var raw = store.get(RESET_KEY);
    if (!raw) return { ok: false, why: 'no request has been made' };
    var rec = JSON.parse(raw);
    if (!rec.until || rec.until < Date.now()) return { ok: false, why: 'that code has expired' };
    if (!same(digest(String(code), rec.salt, ITER), rec.hash)) return { ok: false, why: 'that is not the code' };
    return { ok: true };
  }
  function reset(values) {
    var c = checkResetCode(values.code);
    if (!c.ok) return c;
    var v = vault();
    if (values.newId) { v.id = field(values.newId, v.iter); v.name = String(values.newId); }
    if (values.newPass) v.pass = field(values.newPass, v.iter);
    if (values.newPin) v.pin = field(values.newPin, v.iter);
    v.seed = false;
    saveVault(v);
    store.del(RESET_KEY);
    store.del(TRIES_KEY);
    announce();
    return { ok: true };
  }

  function onChange(fn) { listeners.push(fn); }

  return {
    ITER: ITER, MAIL: MAIL, MAX_TRIES: MAX_TRIES,
    ready: function () { vault(); },
    isAdmin: function () { return !!session(); },
    state: state,
    unlock: unlock,
    adopt: adopt, lock: lock, change: change, verify: verify,
    requestReset: requestReset, reset: reset, checkResetCode: checkResetCode,
    blockedFor: blockedFor,
    onChange: onChange,
    /* handy for the test rig */
    _digest: digest, _b64: b64, _unb64: unb64, _pbkdf2: pbkdf2, _sha256: sha256,
    _setVault: function (o) { store.set(VAULT_KEY, JSON.stringify(o)); },
    _resetTries: function () { store.del(TRIES_KEY); }
  };
})();
if (typeof window !== 'undefined') window.ReelAuth = ReelAuth;
if (typeof module !== 'undefined' && module.exports) module.exports = ReelAuth;
