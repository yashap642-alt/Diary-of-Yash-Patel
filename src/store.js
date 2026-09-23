/* ============================================================================
   Reel — where the moments actually live.

   Until now the diary only ever wrote to this browser, and read a
   moments.json that nothing could update. So a moment added as keeper showed
   on this machine and nowhere else, and a deleted one came back on the next
   load. This file is the fix: one small persistence layer with three backs,
   chosen automatically, so the same page works on a laptop, on GitHub Pages
   and on Vercel without a rewrite.

     local  — this browser only. The default when nothing else is configured.
     git    — the GitHub repository itself: every change is committed to
              moments.json through the GitHub Contents API. Works on GitHub
              Pages and on Vercel, needs no server at all.
     api    — the site's own endpoint, /api/moments, which api/moments.js
              serves: key/value store on Vercel, or a plain JSON file when the
              site runs on a machine with a disk.

   Nothing here trusts the client for security: the site's backend checks a
   signed session cookie on every write, and the keeper's sign-in decides who may
   press the button.
   ==========================================================================*/
var ReelStore = (function () {
  'use strict';

  var CFG_KEY = 'reel.backend.v1';
  var CFG = {
    mode: 'auto',                    /* auto | local | git | api */
    git: { owner: '', repo: '', branch: 'main', path: 'moments.json', token: '', api: 'https://api.github.com', private: false },
    api: { url: '/api/moments', token: '' }        /* the token field is kept for old configs; the api back uses a session cookie instead */
  };
  var state = { mode: 'local', detail: 'this browser', at: null, busy: false, role: null, snapshots: [] };
  var listeners = [];

  /* ── small helpers ─────────────────────────────────────────────────────── */
  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }
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
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(unescape(encodeURIComponent(str)).split('').map(function (c) { return c.charCodeAt(0); }));
  }
  function b64utf8(str) { return b64(utf8(str)); }

  function loadCfg() {
    var raw = store(CFG_KEY);
    if (!raw) return CFG;
    try {
      var saved = JSON.parse(raw);
      CFG.mode = saved.mode || 'auto';
      if (saved.git) Object.keys(CFG.git).forEach(function (k) { if (saved.git[k] !== undefined) CFG.git[k] = saved.git[k]; });
      if (saved.api) Object.keys(CFG.api).forEach(function (k) { if (saved.api[k] !== undefined) CFG.api[k] = saved.api[k]; });
    } catch (e) {}
    return CFG;
  }
  function saveCfg() { store(CFG_KEY, JSON.stringify(CFG)); announce(); }

  function announce() { listeners.forEach(function (fn) { try { fn(status()); } catch (e) {} }); }
  function status() {
    return { mode: state.mode, detail: state.detail, at: state.at, busy: state.busy,
             role: state.role, gitPrivate: !!CFG.git.private, snapshots: state.snapshots || [],
             configured: state.mode === 'git' ? !!(CFG.git.owner && CFG.git.repo && CFG.git.token)
               : state.mode === 'api' ? !!CFG.api.url : true,
             cfg: CFG };
  }
  function set(mode, detail) { state.mode = mode; state.detail = detail; announce(); }

  function absUrl(u) {
    try { return new window.URL(u, window.location.href).href; } catch (e) { return ''; }
  }
  function json(url, opts) {
    var abs = absUrl(url);
    if (!/^https?:/i.test(abs)) return Promise.reject(new Error('not a web address'));
    opts = opts || {};
    if (opts.credentials === undefined) opts.credentials = 'same-origin';
    return (window.fetch ? window.fetch(abs, opts) : Promise.reject(new Error('no fetch')))
      .then(function (r) { return r.text().then(function (t) {
        var body = null;
        try { body = JSON.parse(t); } catch (e) { body = t; }
        if (!r.ok) {
          var msg = (body && (body.say || body.error || body.message)) || ('HTTP ' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          err.body = body;
          err.refused = r.status === 401 || r.status === 403;
          throw err;
        }
        return body;
      }); });
  }

  /* A 200 is not enough. A static host will happily serve /api/moments as a
     file — GitHub Pages hands back this very script — so the probe insists on
     something that actually looks like a shelf before it trusts the host. */
  function looksLikeShelf(doc) {
    return !!doc && typeof doc === 'object' && !Array.isArray(doc) &&
      (Array.isArray(doc.entries) || doc.app === 'Reel');
  }

  /* ── the git back: a commit is a save ──────────────────────────────────── */
  function gitUrl() {
    return (CFG.git.api || 'https://api.github.com').replace(/\/$/, '') + '/repos/' + CFG.git.owner + '/' + CFG.git.repo +
      '/contents/' + CFG.git.path.split('/').map(encodeURIComponent).join('/');
  }
  function gitHeaders() {
    return {
      Authorization: 'Bearer ' + CFG.git.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }
  function gitLoad() {
    return json(gitUrl() + '?ref=' + encodeURIComponent(CFG.git.branch) + '&t=' + Date.now(), { headers: gitHeaders() })
      .then(function (doc) {
        if (doc && doc.content) {
          var text = (typeof atob === 'function' ? atob(doc.content.replace(/\n/g, '')) : '');
          if (text) return JSON.parse(text);
        }
        return null;
      })
      .catch(function (err) {
        if (err.status === 404) return null;             /* no file committed yet */
        throw err;
      });
  }
  function gitSave(doc, what) {
    return json(gitUrl() + '?ref=' + encodeURIComponent(CFG.git.branch), { headers: gitHeaders() })
      .then(function (cur) { return cur && cur.sha ? cur.sha : null; })
      .catch(function (err) { if (err.status === 404) return null; throw err; })
      .then(function (sha) {
        var body = {
          message: 'Reel — ' + what + ' (' + (doc.entries || []).length + ' moments, ' +
                   new Date().toISOString().slice(0, 16).replace('T', ' ') + ')',
          content: b64utf8(JSON.stringify(doc, null, 2)),
          branch: CFG.git.branch
        };
        if (sha) body.sha = sha;
        return json(gitUrl(), { method: 'PUT', headers: gitHeaders(), body: JSON.stringify(body) });
      })
      .then(function (res) {
        if (!res || !res.commit) throw new Error('the repository did not accept the commit');
        return { ok: true, mode: 'git', detail: 'committed ' + res.commit.sha.slice(0, 7) + ' to ' +
          CFG.git.owner + '/' + CFG.git.repo, at: new Date().toISOString(), url: res.commit.html_url };
      });
  }

  /* ── the api back: the site's own endpoint ─────────────────────────────── */
  function apiHeaders() {
    var h = { 'Content-Type': 'application/json' };
    /* no Authorization header: the keeper's session is an HttpOnly cookie the
       page cannot read, and the server is the only thing that can judge it */
    h['X-Reel'] = '1';
    return h;
  }
  function apiLoad() {
    return json(CFG.api.url + '?t=' + Date.now(), { headers: apiHeaders(), cache: 'no-store' })
      .then(function (doc) {
        if (!looksLikeShelf(doc)) {
          var err = new Error('the endpoint answered, but not with a shelf');
          err.status = 200;
          throw err;
        }
        return doc;
      });
  }
  /* the pulse: a short answer that says whether anything moved. Asking this
     once a second costs a few dozen bytes instead of the whole shelf. A server
     that does not know the route is remembered as such and the caller falls
     back to reading the shelf itself. */
  var noPulse = false;
  function apiVersion() {
    if (noPulse) return Promise.resolve({ ok: false, unsupported: true });
    var url = (CFG.api.url || '/api/moments').replace(/\/$/, '') + '/version?t=' + Date.now();
    return json(url, { headers: apiHeaders(), cache: 'no-store' })
      .then(function (res) {
        if (!res || !res.ok || typeof res.revision !== 'string') return { ok: false, unsupported: true };
        return { ok: true, revision: res.revision, at: res.at || null, counts: res.counts || null, role: res.role || null };
      })
      .catch(function () { return { ok: false, unsupported: false }; });
  }

  function apiSave(doc, what) {
    return json(CFG.api.url, { method: 'PUT', headers: apiHeaders(), body: JSON.stringify(doc) })
      .then(function (res) {
        return { ok: true, mode: 'api', detail: (res && res.detail) || ('saved to ' + CFG.api.url),
                 at: (res && res.savedAt) || new Date().toISOString() };
      });
  }

  /* ── choosing a back ───────────────────────────────────────────────────── */
  function detect() {
    loadCfg();
    if (CFG.mode === 'local') { set('local', 'this browser'); return Promise.resolve(status()); }
    if (CFG.mode === 'git') { set('git', CFG.git.owner + '/' + CFG.git.repo); return Promise.resolve(status()); }
    if (CFG.mode === 'api') { set('api', CFG.api.url); return Promise.resolve(status()); }
    /* auto: an endpoint first, then a configured repository, then this browser */
    return json(CFG.api.url + '?t=' + Date.now(), { headers: apiHeaders(), cache: 'no-store' })
      .then(function (doc) {
        if (!looksLikeShelf(doc)) throw new Error('that address answered, but it is not a shelf');
        set('api', CFG.api.url);
        return status();
      })
      .catch(function () {
        if (CFG.git.owner && CFG.git.repo && CFG.git.token) { set('git', CFG.git.owner + '/' + CFG.git.repo); return status(); }
        set('local', 'this browser');
        return status();
      });
  }

  /* ── the two verbs the diary needs ─────────────────────────────────────── */
  /* the same read, but as it came off the wire — the caller fingerprints it
     to notice that another device has written something */
  function loadRaw() {
    if (state.mode === 'local') return Promise.resolve({ ok: true, mode: 'local', doc: null });
    var call = state.mode === 'git' ? gitLoad : apiLoad;
    return call().then(function (doc) {
      return { ok: true, mode: state.mode, doc: doc || null };
    }).catch(function (err) {
      return { ok: false, mode: state.mode, doc: null, detail: err.message };
    });
  }

  /* the pulse, only for the back that has one */
  function version() {
    if (state.mode !== 'api') return Promise.resolve({ ok: false, unsupported: true });
    return apiVersion();
  }

  function load() {
    if (state.mode === 'local') return Promise.resolve({ ok: true, mode: 'local', entries: null });
    set(state.mode, state.detail);
    var call = state.mode === 'git' ? gitLoad : apiLoad;
    return call().then(function (doc) {
      state.at = (doc && doc.savedAt) || (doc && doc.exportedAt) || null;
      announce();
      if (doc && Array.isArray(doc.snapshots)) state.snapshots = doc.snapshots;
      if (doc && doc.role) state.role = doc.role;
      var list = ((doc && doc.entries) || []).map(function (e) {
        if (!e || (!e.pending && !e.published)) return e;
        var c = {}, k;
        for (k in e) { if (k !== 'pending' && k !== 'published') c[k] = e[k]; }
        return c;
      });
      return { ok: true, mode: state.mode, entries: list,
               /* nothing has ever been saved at the other end */
               empty: !!((doc && doc.empty) || (!list.length && !state.at)) };
    }).catch(function (err) {
      return { ok: false, mode: state.mode, entries: null, detail: err.message };
    });
  }

  function save(entries, what) {
    if (state.mode === 'local') {
      state.at = new Date().toISOString();
      announce();
      return Promise.resolve({ ok: true, mode: 'local', detail: 'kept in this browser', at: state.at });
    }
    state.busy = true; announce();
    /* pending is this browser's business, not the shelf's: another device
       reading it would keep a deleted moment alive */
    var clean = (entries || []).map(function (e) {
      if (!e || !e.pending) return e;
      var c = {}, k;
      for (k in e) { if (k !== 'pending') c[k] = e[k]; }
      return c;
    });
    var kept = clean.length, heldBack = 0;
    if (state.mode === 'git' && !CFG.git.private) {
      /* a repository anyone can read must never hold a draft or the trash */
      var before = clean.length;
      clean = clean.filter(function (e) { return e.published !== false && !e.deletedAt; });
      heldBack = before - clean.length;
    }
    var doc = {
      app: 'Reel', version: 2, owner: 'Yash Patel',
      savedAt: new Date().toISOString(),
      shelves: (window.ReelShelves || null),
      entries: clean
    };
    var call = state.mode === 'git' ? gitSave : apiSave;
    return call(doc, what || 'shelf updated').then(function (res) {
      state.busy = false; state.at = res.at; state.detail = res.detail;
      if (res.url) state.lastCommit = res.url;
      res.kept = kept; res.heldBack = heldBack;
      announce();
      return res;
    }).catch(function (err) {
      state.busy = false; announce();
      return { ok: false, mode: state.mode, detail: err.message, error: err, status: err.status, refused: !!err.refused };
    });
  }

  /* ── a handshake the keeper can press ──────────────────────────────────── */
  function test(cfg) {
    if (cfg) { Object.assign(CFG, cfg); saveCfg(); }
    return detect().then(function (st) {
      if (st.mode === 'local') return { ok: true, mode: 'local', detail: 'this browser — nothing shared yet' };
      return load().then(function (res) {
        if (!res.ok) return { ok: false, mode: st.mode, detail: res.detail };
        if (st.mode === 'git' && !(res.entries || []).length) {
          return { ok: true, mode: 'git', detail: 'connected — the repository has no moments.json yet (the first save commits it)' };
        }
        return { ok: true, mode: st.mode, detail: 'connected — ' + (res.entries || []).length + ' moments at the other end' };
      });
    });
  }

  function configure(cfg) { Object.assign(CFG, cfg); saveCfg(); }

  return {
    init: detect, detect: detect, load: load, loadRaw: loadRaw, version: version, save: save, test: test,
    configure: configure, status: status,
    config: function () { return JSON.parse(JSON.stringify(CFG)); },
    on: function (fn) { listeners.push(fn); },
    snapshots: function () { return state.snapshots || []; },
    _reset: function () { noPulse = false; CFG.mode = 'auto'; CFG.git = { owner: '', repo: '', branch: 'main', path: 'moments.json', token: '', api: 'https://api.github.com', private: false }; CFG.api = { url: '/api/moments', token: '' }; saveCfg(); }
  };
})();
if (typeof window !== 'undefined') window.ReelStore = ReelStore;
if (typeof module !== 'undefined' && module.exports) module.exports = ReelStore;
