/* ============================================================================
   Reel — talking to the site's own door.

   src/auth.js is the offline lock: it keeps a visitor from wandering into the
   diary and editing a life by accident, and it works with no server at all.
   THIS file is the real thing. When the site has a backend, the question
   "may this person write?" is answered by the server, with a session cookie
   the page cannot read, and everything below is a thin, honest client for it:

     · sign in with the ID and password  →  POST /api/session
     · if a second factor is asked for    →  POST /api/session/mfa
     · is anyone signed in, and who?      →  GET  /api/session
     · sign out                           →  DELETE /api/session

   No password, no token, no cookie value is ever kept in localStorage. The
   only thing this file remembers is whether the server said yes a moment ago.
   ==========================================================================*/
var ReelSession = (function () {
  'use strict';

  var st = {
    known: false,          /* have we asked the server yet */
    server: false,         /* is there a backend answering */
    role: 'visitor',
    configured: false,     /* has the host set a keeper password */
    mfa: false,
    readable: false,
    expiresAt: null,
    at: null,
    refused: false         /* the last write was refused: the session is gone */
  };
  var listeners = [];

  function emit() {
    listeners.forEach(function (fn) { try { fn(st); } catch (e) {} });
  }
  function canFetch() { return typeof fetch === 'function'; }
  function json(path, opts) {
    opts = opts || {};
    if (!canFetch()) return Promise.reject(new Error('no fetch here'));
    var headers = { 'Cache-Control': 'no-store' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.reel) headers['X-Reel'] = '1';
    return fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (r) {
      return r.text().then(function (t) {
        var body = null;
        try { body = JSON.parse(t); } catch (e) {}
        return { status: r.status, ok: r.ok, body: body || {}, text: t };
      });
    });
  }
  /* the API lives beside the page; on the workspace server that is /api/…,
     and on a page served from a subfolder it is still absolute because the
     backend is mounted at the origin root */
  function api(path) {
    var base = '';
    try { base = new URL('.', location.href).pathname.replace(/\/$/, ''); } catch (e) {}
    /* only strip the subfolder when the page is not itself at the root */
    return (base && base !== '' ? base : '') + path;
  }

  function status() {
    return json(api('/api/session')).then(function (r) {
      st.readable = r.ok;
      st.server = r.ok;
      st.known = true;
      if (r.ok && r.body) {
        st.role = r.body.role === 'keeper' ? 'keeper' : 'visitor';
        st.configured = !!r.body.authorConfigured;
        st.mfa = !!r.body.mfa;
        st.expiresAt = r.body.expiresAt || null;
      } else {
        st.role = 'visitor';
        st.server = false;                      /* no door here: the offline lock is what there is */
      }
      st.at = new Date().toISOString();
      emit();
      return st;
    })['catch'](function () {
      st.known = true; st.server = false; st.readable = false; st.role = 'visitor';
      emit();
      return st;
    });
  }

  function signIn(id, password) {
    return json(api('/api/session'), { method: 'POST', body: { id: id, password: password } }).then(function (r) {
      if (r.ok && r.body.mfa) return { ok: true, mfa: true, ticket: r.body.ticket, say: r.body.say };
      if (r.ok) { st.role = 'keeper'; st.known = true; st.refused = false; emit(); return { ok: true, role: 'keeper', say: r.body.say }; }
      if (r.status === 429) return { ok: false, wait: r.body.wait || 60, why: r.body.say || 'Too many tries. Wait a little.' };
      return { ok: false, why: r.body.say || r.body.error || 'that did not work', status: r.status };
    })['catch'](function () {
      return { ok: false, why: 'the site did not answer', offline: true };
    });
  }

  function code(ticket, value) {
    return json(api('/api/session/mfa'), { method: 'POST', body: { ticket: ticket, code: value } }).then(function (r) {
      if (r.ok) { st.role = 'keeper'; st.known = true; st.refused = false; emit(); return { ok: true, say: r.body.say, recovery: !!r.body.recovery }; }
      if (r.status === 429) return { ok: false, wait: r.body.wait || 60, why: r.body.say || 'Too many tries. Wait a little.' };
      return { ok: false, why: r.body.say || r.body.error || 'that code is not right' };
    })['catch'](function () { return { ok: false, why: 'the site did not answer', offline: true }; });
  }

  function out() {
    return json(api('/api/session'), { method: 'DELETE' }).then(function () {
      st.role = 'visitor'; st.expiresAt = null; emit(); return { ok: true };
    })['catch'](function () { st.role = 'visitor'; emit(); return { ok: true }; });
  }

  /* called when a write comes back 401: the server, not this page, decides */
  function refused(why) {
    st.role = 'visitor';
    st.refused = true;
    emit();
    return why || 'the site refused that: nobody is signed in there';
  }

  return {
    state: function () { return st; },
    known: function () { return st.known; },
    server: function () { return st.server; },
    role: function () { return st.role; },
    isKeeper: function () { return st.role === 'keeper'; },
    onChange: function (fn) { listeners.push(fn); },
    status: status,
    signIn: signIn,
    code: code,
    out: out,
    refused: refused,
    api: api
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ReelSession;
