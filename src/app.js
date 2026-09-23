/* ============================================================================
   REEL — app layer.  Plain script, no dependencies. Reads window.ReelEngine.

   The journey:
     cover  →  foyer  →  lab (write)  or  library (shelves of moments)
                            library → moment (the page opens, painted with the
                            atmosphere the entry happened in)
   ==========================================================================*/
(function () {
  'use strict';

  var Engine = window.ReelEngine;
  var OWNER = 'Yash Patel';
  var FOLDERS = Engine.SHELVES;
  var SCENES = Engine.SCENES;
  var FOLDER = {};
  FOLDERS.forEach(function (f) { FOLDER[f.id] = f; });
  var COLOR = {};
  (Engine.EMOTIONS || []).forEach(function (e) { COLOR[e.id] = 'var(--e-' + e.id + ', ' + e.color + ')'; });
  function emotionColor(em) {
    if (!em) return 'var(--e-quiet)';
    if (em.color) return em.color;
    return COLOR[em.id] || 'var(--e-quiet)';
  }

  /* ------------------------------------------------------------------ utils */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function wordsOf(t) { var m = String(t || '').match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g); return m ? m.length : 0; }
  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function fmtDate(iso, withTime) {
    var d = new Date(iso);
    var s = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    if (withTime) s += ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return s;
  }
  function shortDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  /* 24-hour, zero-padded, the way a clock reads: 09:05, 14:35 */
  function hhmm(d) {
    d = d || new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function timeOfDay(when) {
    var h = (when ? new Date(when) : new Date()).getHours();
    return h < 5 ? 'the small hours' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  }
  function rgba(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function sceneGradient(sc) {
    var stops = sc.stops || ['#191817', '#242322'];
    if (stops.length === 1) return 'linear-gradient(180deg, ' + stops[0] + ', ' + stops[0] + ')';
    return 'linear-gradient(165deg, ' + stops.map(function (c, i) {
      var pct = Math.round((i / (stops.length - 1)) * 100);
      return c + ' ' + pct + '%';
    }).join(', ') + ')';
  }
  function safeStorage() {
    try { window.localStorage.setItem('__reel_probe', '1'); window.localStorage.removeItem('__reel_probe'); return window.localStorage; }
    catch (e) {
      var mem = {};
      return { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
    }
  }
  var store = safeStorage();
  var KEY_E = 'reel.entries.v2', KEY_D = 'reel.draft.v1', KEY_T = 'reel.theme.v1', KEY_OPENED = 'reel.opened.v1';

  var state = {
    entries: [],
    draft: '',
    a: null,
    reading: false,
    seed: 0,
    style: null,
    primary: null,
    cross: [],
    titleIdx: 0,
    summary: '',
    summaryTouched: false,
    wishChecked: {},
    lastAnalyzed: '',
    overridesFor: null,
    shelf: 'all',
    query: '',
    screen: 'cover',
    viewing: null,
    returnTo: 'shelf',
    ready: false,
    reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    fit: { k: 1, portrait: false, short: false },
    editing: null,
    trash: [],                     /* soft-deleted: the keeper can bring it back */
    desk: 'drafts',
    autosave: { at: null, busy: false, id: null, text: '', err: null, wait: null },
    keptText: '',                  /* what the last local keep wrote down */
    quietPull: false,              /* the change the server is about to report is ours */
    previewing: false,
    publishing: false              /* is this moment meant for the public shelf */
  };

  /* --------------------------------------------------------- timers + toast */
  var timers = [];
  function later(ms, fn) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  /* the book-opening flight runs on its own lane: switching screens must not
     cut it off halfway (which would leave the overlay stuck open) */
  var boTimers = [];
  function laterBO(ms, fn) { var t = setTimeout(fn, ms); boTimers.push(t); return t; }
  function clearBO() { boTimers.forEach(clearTimeout); boTimers = []; }
  /* one-off timers that must outlive a screen change (e.g. the cover re-closing) */
  var soloTimers = [];
  function laterOnce(ms, fn) { var t = setTimeout(fn, ms); soloTimers.push(t); return t; }

  var toastEl = $('#toast'), toastTimer = null;
  function toast(msg, ms) {
    toastEl.innerHTML = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 4200);
  }

  /* ---------------------------------------------------------------- storage */
  function loadAll() {
    try { state.entries = JSON.parse(store.getItem(KEY_E) || '[]') || []; } catch (e) { state.entries = []; }
    if (!state.entries.length) state.entries = seedEntries();
    state.draft = store.getItem(KEY_D) || '';
    var t = store.getItem(KEY_T);
    if (t) document.documentElement.setAttribute('data-theme', t);
  }
  /* everything this device holds: the live shelf and the trash beside it */
  function allEntries() { return state.entries.concat(state.trash); }
  function saveEntries() {
    try { store.setItem(KEY_E, JSON.stringify(allEntries())); } catch (e) {}
    syncUp();
  }
  /* a shelf can arrive carrying soft-deleted moments: they belong in the
     trash, never in the room with the living ones */
  function splitEntries(list) {
    var live = [], trash = [];
    (list || []).forEach(function (e) { (e && e.deletedAt ? trash : live).push(e); });
    return { live: live, trash: trash };
  }
  /* ── pushing the shelf to whichever back is configured ─────────────────── */
  var syncTimer = null, syncState = { mode: 'local', detail: 'this browser', busy: false, queued: false, ownAt: null };
  function paintSync() {
    var el = $('#shelfSync');
    if (!el) return;
    var live = syncState.mode !== 'local';
    el.classList.toggle('is-live', live);
    el.textContent = syncState.busy
      ? 'saving\u2026'
      : live
        ? 'saved to ' + (syncState.mode === 'git' ? 'the repository' : 'the site\u2019s backend') +
          (syncState.at ? ' \u00b7 ' + hhmm(new Date(syncState.at)) : '')
        : 'kept in this browser';
    el.title = syncState.detail || '';
  }
  function syncUp(what) {
    if (syncTimer) clearTimeout(syncTimer);
    syncState.busy = true; syncState.queued = true; paintSync();
    syncTimer = setTimeout(function () {
      ReelStore.save(allEntries(), what || 'shelf updated').then(function (res) {
        syncState.mode = res.mode; syncState.detail = res.detail; syncState.at = res.at;
        /* the shelf this page just wrote, stamped by the server: anything older
           than this arriving later is a picture from before the keeper's own
           press, and must not be drawn on top of it */
        if (res.ok && res.at) syncState.ownAt = res.at;
        syncState.busy = false; syncState.queued = false; paintSync();
        allEntries().forEach(function (e) { e.pending = false; });
        try { store.setItem(KEY_E, JSON.stringify(allEntries())); } catch (e) {}
        if (res.ok) {
          forked = false;
          /* the change the pulse is about to announce is this page's own: the
             next look should be silent, so a writer is never told that he
             changed something */
          lastPulse = null;
          state.quietPull = true;
          shoutShelf();
          ReelStore.loadRaw().then(function (r) { if (r.ok) lastFinger = fingerprint(r.doc || {}); });
          if (res.heldBack) {
            toast(res.heldBack + ' moment' + (res.heldBack === 1 ? '' : 's') +
                  ' stayed in this browser: the repository anyone can read never receives a draft. ' +
                  'Publish it, or set <b>Where it saves</b> to say the repository is private.', 6200);
          }
          paintSaveLight(true);
        } else if (res.refused) {
          /* the server, not this page, decides who may write */
          auth.lock();
          paintKeeper();
          paintSaveLight(false, 'the site refused that');
          toast('The site refused that write: nobody is signed in there. ' +
                (ReelSession.server() ? 'Sign in again and the words stay here until you do.' : ''), 6000);
          openAdmin('The site refused that write. Sign in again.');
        } else {
          forked = true;
          paintSaveLight(false, res.status === 503 ? 'not configured on the host' : 'not saved');
          toast('Kept here, but the backend refused the write: ' + esc(res.detail) +
                ' \u2014 the moment is safe on this device.', 5200);
        }
      });
    }, 220);
  }
  /* what the backend has, coming the other way */
  /* two shelves look the same to a reader when every moment they can see is
     the same moment, unchanged and in the same order. Comparing before
     repainting keeps a live pull from rebuilding a screen nobody needs
     rebuilt — and from pulling a button out from under a finger that is
     already on its way down. */
  function sameShelf(before, after, beforeTrash, afterTrash) {
    function sig(list) {
      return (list || []).map(function (e) { return [e.id, e.changedAt || '', e.published === false ? 0 : 1, e.deletedAt || '', e.title || '', (e.raw || '').length].join('~'); }).join('|');
    }
    return sig(before) === sig(after) && sig(beforeTrash) === sig(afterTrash);
  }

  function pullShelf(loud) {
    if (syncState.mode === 'local') return Promise.resolve(false);
    if (syncState.queued || syncState.busy) return Promise.resolve(false);
    return ReelStore.load().then(function (res) {
      if (!res.ok || !res.entries) return false;
      /* and again now that it is here: if a change went up while this read was
         in the air, what came back is a picture of the shelf before it */
      if (syncState.queued || syncState.busy) return false;
      var theirs = res.at || null;
      if (syncState.ownAt && theirs && String(theirs) < String(syncState.ownAt)) return false;
      /* a backend that has never been written to does not get to empty the
         diary: the moments already here stay, and go up with the first save */
      if (res.empty && state.entries.length) {
        state.entries.forEach(function (e) { e.pending = true; });
        syncState.mode = res.mode; syncState.at = res.at || null;
        try { store.setItem(KEY_E, JSON.stringify(state.entries)); } catch (e) {}
        paintSync();
        return false;
      }
      var byId = {};
      res.entries.forEach(function (e) { byId[e.id] = 1; });
      /* what this device wrote but has not managed to push yet is kept */
      var pending = state.entries.filter(function (e) { return e.pending && !byId[e.id]; });
      /* once the backend holds a shelf, it is the truth: a moment deleted
         anywhere is deleted everywhere, samples included */
      var remoteExists = res.entries.length > 0 || !!res.at;
      var before = state.entries.slice();
      var beforeTrash = state.trash.slice();
      if (remoteExists) {
        var lost = before.filter(function (e) { return !e.pending && !byId[e.id]; }).length;
        if (lost && before.length !== res.entries.length + pending.length) {
          state.goneElsewhere = true;                   /* mentioned once, below */
        }
      }
      var wasOpen = state.viewing;
      var split = splitEntries(res.entries.concat(pending));
      state.entries = split.live.sort(function (a, b) {
        return String(b.when || '').localeCompare(String(a.when || ''));
      });
      /* a visitor never receives a deleted moment, so their trash is empty by
         construction; the keeper receives the lot and gets it sorted here */
      var remoteTrash = split.trash;
      var localTrash = state.trash.filter(function (e) {
        return !remoteTrash.some(function (r) { return r.id === e.id; });
      });
      state.trash = remoteTrash.concat(localTrash).sort(function (a, b) {
        return String(b.deletedAt || b.when || '').localeCompare(String(a.deletedAt || a.when || ''));
      });
      try { store.setItem(KEY_E, JSON.stringify(allEntries())); } catch (e) {}
      var moved = !sameShelf(before, state.entries, beforeTrash, state.trash);
      syncState.mode = res.mode; syncState.at = res.at || syncState.at;
      if (moved && state.screen === 'desk') renderDesk();
      if (moved && state.screen === 'shelf') renderLibrary();
      paintSync();

      /* what a live change means for the screen the reader is on */
      var added = state.entries.filter(function (e) { return !before.some(function (x) { return x.id === e.id; }); });
      var nowOpen = state.viewing ? state.entries.filter(function (e) { return e.id === state.viewing; })[0] : null;
      if (state.viewing && !nowOpen) {
        toast('That moment was removed from another device. Back to the shelves.', 4200);
        state.viewing = null;
        closeMoment();
      } else if (nowOpen) {
        var wasMoment = before.filter(function (e) { return e.id === nowOpen.id; })[0];
        if (wasMoment && (wasMoment.raw !== nowOpen.raw || wasMoment.title !== nowOpen.title || wasMoment.summary !== nowOpen.summary)) {
          var sc = nowOpen.scene || SCENES.paper;
          $('#momentInner').innerHTML = momentHtml(nowOpen, null, null);
          paintScene(sc);
          wireMoment(nowOpen, null, null);
          toast('This moment was changed elsewhere \u2014 the page you are reading is the new one.', 4200);
        }
      }
      if (state.goneElsewhere) {
        state.goneElsewhere = false;
        toast('A moment that was here has been removed from another device \u2014 the shelf now matches.', 4200);
      }
      if (loud) {
        if (added.length === 1 && added[0].id !== (state.viewing || '')) {
          toast('A moment just arrived from another device: <b>' + esc(added[0].title) + '</b>.', 4200);
        } else if (added.length > 1) {
          toast(added.length + ' moments just arrived from another device.', 3800);
        } else if (state.entries.length !== before.length) {
          toast('The shelf changed elsewhere \u2014 it is up to date now.', 3200);
        }
      }
      if (pending.length && auth.isAdmin()) syncUp('pushing the moments written here');
      return state.entries.length !== before.length || !!added.length;
    });
  }
  function saveDraft() { try { store.setItem(KEY_D, state.draft); } catch (e) {} }

  /* ------------------------------------------------------------ seed entries */
  function seedEntries() {
    var seeds = [
      'Ok so today was genuinely one of the best days in a long time. Woke up late, made chai, sat on the balcony while it rained. Amma called and we spoke for an hour about nothing. Then I finished the deck I had been avoiding for a week and my manager said it was the cleanest work she has seen from me. I felt light. I want to keep this feeling in my pocket.',
      'I want 3 matching blazer suits for the trio — me, Sana and Dhruv — plus coordinated outfits for our partners, so that at Sana\'s wedding we look like a film poster. Emerald green for the women, charcoal for the men. I have been saving up for this for four months and I still need about 40k. Also want a good camera before the wedding so I can shoot the haldi myself.',
      'Rohit and I talked for two hours and at the end he said he is moving to Bangalore in March. I said congratulations and I meant it, I do mean it, but I came home and cried in the bathroom with the tap running so nobody would hear. I keep replaying the part where he asked if I would visit. I do not know if I can survive another goodbye like this. My chest is heavy and I cannot sleep.',
      'Wants I keep in my notes, so I stop pretending they are small:\n- Kindle Paperwhite\n- black linen kurta set for the wedding\n- running shoes that do not hurt my knee\n- savings for the Leh trip in June',
      'Skipped lunch, missed the gym, three deadlines by Friday. My back hurts from the desk and I snapped at somebody in the group chat who did not deserve it. Not a disaster. Just heavy, and I am tired of carrying it quietly.',
      'Went to the temple with amma early morning, then we ate dosa standing outside, and she held my hand crossing the road like I was six again. Grateful in a way I cannot explain properly in words.',
      'It is 3 am and I cannot sleep. The appraisal is tomorrow and I keep rehearsing a conversation that has not happened. I sat on the kitchen floor with the fridge light on, thinking about how I have wanted this promotion for two years and how the wanting has started to feel like a job of its own.'
    ];
    var daysAgo = [11, 8, 5, 4, 3, 2, 1];
    return seeds.map(function (text, i) {
      var a = Engine.analyze(text);
      var d = new Date(); d.setDate(d.getDate() - daysAgo[i]); d.setHours(20 - i, 10 + i * 6, 0, 0);
      return buildEntry(a, {
        id: 'seed-' + (i + 1), sample: true, titleIdx: 0, summary: null,
        primary: a.primary.id, cross: a.crossLinks.map(function (c) { return c.id; }),
        when: d.toISOString(), wishChecked: {}
      });
    });
  }




  /* ═════════════════════════════ THE WATCHER ═════════════════════════════
     The shelf belongs to the diary, not to the device looking at it. Someone
     writing on a phone must show up on a laptop that is already open, so the
     page asks the backend what it holds every twenty seconds while it is
     being looked at, the instant the tab comes back to the front, and the
     instant another tab of the same browser writes something.

     Nothing here clobbers a writer's work: entries still waiting to go up
     (pending) are kept, and a poll that arrives mid-write is skipped. */
  var WATCH_MS = 1000;                 /* the shelf is asked every second */
  var watchTimer = null;
  var lastFinger = null;               /* for backs with no pulse: git, older servers */
  var lastPulse = null;                /* the short answer from /api/moments/version */
  var pokedWhileEditing = false;
  var chan = null;
  try { chan = typeof BroadcastChannel === 'function' ? new BroadcastChannel('reel.shelf') : null; } catch (e) { chan = null; }

  function fingerprint(doc) {
    var list = (doc && doc.entries) || [];
    var h = 5381, sig = (doc && (doc.savedAt || doc.exportedAt)) || '';
    sig += '|' + list.length;
    list.forEach(function (e) {
      sig += '|' + e.id + (e.changedAt || '');
      for (var i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
    });
    return String(h) + ':' + list.length + ':' + ((doc && doc.savedAt) || '');
  }

  function shoutShelf() {
    if (chan) { try { chan.postMessage({ t: 'shelf', at: Date.now() }); } catch (e) {} }
  }

  /* the fallback for a back with no pulse: read the shelf, fingerprint it here */
  function checkByFingerprint(loud) {
    return ReelStore.loadRaw().then(function (res) {
      if (!res.ok || !res.doc) return false;
      var f = fingerprint(res.doc);
      if (f === lastFinger) return false;
      var was = lastFinger;
      lastFinger = f;
      return pullShelf(!!loud || was !== null);       /* never silent the first time */
    });
  }

  function checkShelf(loud) {
    if (syncState.mode === 'local' || syncState.busy || syncState.queued) return Promise.resolve(false);
    /* while this browser holds words the backend would not take, its own shelf
       is the truth: pulling would undo what the keeper wrote and the site
       refused, and losing his words is the one thing not allowed here */
    if (forked) return Promise.resolve(false);
    if (document.hidden) return Promise.resolve(false);
    /* a change that lands mid-edit is remembered, never applied under the
       keeper's hands: his words stay where they are, and the shelf catches up
       the moment the edit is finished or dropped */
    if (state.editing) { pokedWhileEditing = true; return Promise.resolve(false); }
    if (syncState.mode === 'api') {
      return ReelStore.version().then(function (v) {
        if (!v || !v.ok) return v && v.unsupported ? checkByFingerprint(loud) : false;
        if (v.revision === lastPulse) return false;
        var first = lastPulse === null;
        lastPulse = v.revision;
        var quiet = state.quietPull;
        state.quietPull = false;
        return pullShelf(quiet ? false : (!!loud || !first));
      });
    }
    return checkByFingerprint(loud);
  }

  function startWatching() {
    stopWatching();
    watchTimer = setInterval(function () {
      if (document.hidden) return;                    /* nobody is reading: do not ask */
      if (state.editing) { pokedWhileEditing = true; return; }
      if (checkShelf.pending) return;                 /* one question at a time */
      checkShelf.pending = true;
      var done = function () { checkShelf.pending = false; };
      checkShelf(false).then(done, done);
    }, WATCH_MS);
  }
  function stopWatching() { if (watchTimer) { clearInterval(watchTimer); watchTimer = null; } }
  function watchEvery(ms) { WATCH_MS = Math.max(200, ms || 1000); startWatching(); return WATCH_MS; }
  /* once an edit ends, whatever arrived while it was open is brought in */
  function catchUpAfterEdit() {
    if (!pokedWhileEditing) return;
    pokedWhileEditing = false;
    lastPulse = null;
    later(120, function () { checkShelf(true); });
  }

  /* ═══════════════════════════════ THE CLOCK ═════════════════════════════
     A diary that says "today" has to know what today is. The date and the
     time are painted from the reader's own clock, and repainted every
     fifteen seconds, the moment the tab is brought back to the front, and
     when the day turns over while the diary is open. */
  function paintClock(at) {
    var now = at ? new Date(at) : new Date();
    var iso = now.toISOString();
    var dateLong = fmtDate(iso);
    var time = hhmm(now);
    var stamp = dateLong + ' · ' + time;

    var lab = $('#labDate');
    if (lab) lab.textContent = stamp;
    var draft = $('#draftDate');
    if (draft) draft.textContent = stamp + ' · ' + timeOfDay(now);
    var shelf = $('#shelfClock');
    if (shelf) shelf.textContent = stamp;
    var cover = $('#coverClock');
    if (cover) cover.textContent = dateLong + ' · ' + time;
    var sheet = $('.admin-card .clock');
    if (sheet) sheet.textContent = dateLong + ' · ' + time;
    state.now = iso;
    state.today = iso.slice(0, 10);
  }
  var clockTimer = null;
  function startClock() {
    paintClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(paintClock, 15000);      /* never more than a half-minute stale */
    window.addEventListener('focus', function () { paintClock(); keepShelfCurrent(); checkShelf(false); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { paintClock(); keepShelfCurrent(); checkShelf(false); }
    });
    window.addEventListener('pageshow', function () { paintClock(); keepShelfCurrent(); checkShelf(false); });
  }
  /* if midnight passed while the reader was away, the shelf's own labels
     ("today", "yesterday") are repainted too */
  var lastDay = null;
  function keepShelfCurrent() {
    var day = new Date().toISOString().slice(0, 10);
    if (lastDay && lastDay !== day) {
      if (state.screen === 'shelf') renderLibrary();
      if (state.screen === 'lab') renderPanel();
    }
    lastDay = day;
  }

  /* ════════════════════════════════ THE KEEPER'S SHEET ════════════════════
     The shelf is public; the pen is not. Any visitor may read every moment.
     Adding, changing and deleting go through here, and here only. */
  var auth = window.ReelAuth;

  function openAdmin(reason) {
    var sheet = $('#adminSheet');
    if (!sheet) return;
    var why = $('#adminWhy');
    if (why) why.textContent = reason || 'Reading is open to everyone. Adding, changing or removing a moment is Yash\u2019s.';
    $('#adminErr').hidden = true;
    sheet.classList.add('show');
    var id = $('#adminId');
    if (id) { setMode('pass'); setTimeout(function () { id.focus(); }, 260); }
  }
  function closeAdmin() {
    var sheet = $('#adminSheet');
    if (sheet) sheet.classList.remove('show');
    var p = $('#adminPanel'); if (p) { p.hidden = true; p.innerHTML = ''; }
  }
  var adminMode = 'pass';
  function setMode(mode) {
    adminMode = mode;
    $('#modePass').classList.toggle('is-on', mode === 'pass');
    $('#modePin').classList.toggle('is-on', mode === 'pin');
    $('#fieldId').style.display = mode === 'pass' ? '' : 'none';
    $('#secretLabel').textContent = mode === 'pass' ? 'Password' : 'PIN';
    var inp = $('#adminSecret');
    inp.value = '';
    inp.placeholder = mode === 'pass' ? 'the password' : 'the 6-digit PIN';
    inp.setAttribute('inputmode', mode === 'pass' ? 'text' : 'numeric');
    $('#adminErr').hidden = true;
  }
  function keeperHintHtml() {
    return auth.isAdmin()
      ? 'You are the keeper \u2014 this will be shelved under your name.'
      : 'Visitors read everything. <b>Writing needs the keeper\u2019s key.</b>';
  }
  function adminError(msg) {
    var e = $('#adminErr');
    if (!e) return;
    e.textContent = msg;
    e.hidden = false;
  }
  function paintKeeper() {
    var st = auth.state();
    Array.prototype.forEach.call(document.querySelectorAll('.js-keeper'), function (btn) {
      btn.classList.toggle('is-on', st.admin);
      btn.querySelector('span').textContent = st.admin ? 'Signed in' : 'Keeper';
      btn.title = st.admin ? 'Signed in as the keeper — manage the diary' : 'Sign in to write, change or delete';
      btn.setAttribute('aria-label', btn.title);
    });
    var hint = $('#keeperHint');
    if (hint) hint.innerHTML = keeperHintHtml();
    var locked = $('#adminLocked'), openEl = $('#adminOpen');
    if (locked) locked.hidden = st.admin;
    if (openEl) openEl.hidden = !st.admin;
    if (st.admin && $('#adminWho')) $('#adminWho').textContent = 'Yash';
    if ($('#adminMail')) $('#adminMail').textContent = st.mail;
    document.documentElement.classList.toggle('is-keeper', st.admin);
  }
  function showMfa(ticket, why) {
    pendingTicket = ticket;
    $('#adminLocked').hidden = true;
    var step = $('#adminMfa');
    if (step) step.hidden = false;
    $('#adminCodeWhy').textContent = why || 'The six digits from your authenticator app, or one of your recovery codes.';
    var inp = $('#adminCode');
    if (inp) { inp.value = ''; setTimeout(function () { inp.focus(); }, 120); }
  }
  function hideMfa() {
    pendingTicket = null;
    var step = $('#adminMfa');
    if (step) step.hidden = true;
  }
  var pendingTicket = null;
  function tryUnlock() {
    var id = adminMode === 'pass' ? $('#adminId').value : '';
    var secret = $('#adminSecret').value;
    if (adminMode === 'pass' && !id.trim()) return adminError('Who is writing? The ID, please.');
    if (!secret) return adminError(adminMode === 'pass' ? 'The password too.' : 'The PIN, please.');
    /* with a backend in play the server decides, not this page */
    if (adminMode === 'pin' && ReelSession.server()) {
      return adminError('The PIN is the offline lock. The site itself wants the password.');
    }
    if (ReelSession.server()) return unlockOnServer(id, secret);
    var wait = auth.blockedFor();
    if (wait > 0) return adminError('Too many tries. Wait ' + wait + ' seconds.');
    var btn = $('#adminGo');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }
    setTimeout(function () {
      var res = auth.unlock(id, secret, { remember: $('#adminKeep').checked });
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
      if (!res.ok) {
        adminError(res.why + (res.wait ? ' (' + res.wait + 's)' : ''));
        $('#adminSecret').value = '';
        return;
      }
      $('#adminSecret').value = '';
      $('#adminId') && ($('#adminId').value = '');
      closeAdmin();
      toast('Welcome back. The pen is yours \u2014 but only on this device, where no site is judging it.', 3400);
    }, 30);
  }
  function unlockOnServer(id, secret) {
    var btn = $('#adminGo');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }
    ReelSession.signIn(id, secret).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
      $('#adminSecret').value = '';
      if (!res.ok) {
        adminError(res.why + (res.wait ? ' Wait ' + res.wait + ' seconds.' : '') +
                   (res.offline ? ' The offline lock still stands on this device.' : ''));
        return;
      }
      if (res.mfa) return showMfa(res.ticket);
      $('#adminId') && ($('#adminId').value = '');
      auth.adopt('server');
      paintKeeper();
      closeAdmin();
      pullShelf(true);
      toast('Welcome back. The site knows you \u2014 drafts and all.', 3000);
    });
  }
  function tryCode() {
    var v = $('#adminCode') ? $('#adminCode').value.trim() : '';
    if (!v) return adminError('The six digits, or a recovery code.');
    var btn = $('#adminCodeGo');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }
    ReelSession.code(pendingTicket, v).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Enter the diary'; }
      if (!res.ok) {
        adminError(res.why + (res.wait ? ' Wait ' + res.wait + ' seconds.' : ''));
        return;
      }
      hideMfa();
      auth.adopt('server');
      paintKeeper();
      closeAdmin();
      pullShelf(true);
      toast(res.recovery
        ? 'In, with a recovery code. That one is spent now.'
        : 'Welcome back. The site knows you \u2014 drafts and all.', 3200);
    });
  }
  function signOut() {
    var had = ReelSession.server();
    auth.lock();
    var done = function () {
      closeAdmin();
      paintKeeper();
      toast('Signed out. The diary is a reading room again.', 2600);
    };
    if (had) return ReelSession.out().then(done);
    done();
  }
  /* the mail route: a code goes to the keeper's inbox, and only that code
     lets a new key be set */
  function startReset() {
    var req = auth.requestReset();
    var panel = $('#adminPanel');
    panel.hidden = false;
    panel.innerHTML =
      '<h3>Mail route</h3>' +
      '<p class="admin-lede">A code has been made for <b>' + esc(req.mail) + '</b>. Send it to yourself from that inbox ' +
      '(the button opens your mail app), then type it back here with the new keys.</p>' +
      '<div class="admin-code">' + req.code + '</div>' +
      '<p class="admin-ok">It is good for ' + req.minutes + ' minutes, and only on this device.</p>' +
      '<label class="admin-field"><span>Code from the mail</span><input id="resetCode" inputmode="numeric" placeholder="0000"></label>' +
      '<label class="admin-field"><span>New ID (optional)</span><input id="resetId" spellcheck="false" placeholder="leave blank to keep"></label>' +
      '<label class="admin-field"><span>New password (optional)</span><input id="resetPass" type="password" spellcheck="false"></label>' +
      '<label class="admin-field"><span>New PIN (optional)</span><input id="resetPin" inputmode="numeric" spellcheck="false"></label>' +
      '<div class="admin-actions"><button class="btn solid" id="resetGo">Set the new keys</button>' +
      '<button class="admin-link" id="resetMail">open the mail app</button></div>';
    $('#resetMail').addEventListener('click', function () {
      var subject = encodeURIComponent('Reel \u2014 reset code');
      var body = encodeURIComponent('My Reel reset code is ' + req.code + ' (good for ' + req.minutes + ' minutes).\n\nSent from ' + req.mail);
      window.open('mailto:' + req.mail + '?subject=' + subject + '&body=' + body, '_blank');
    });
    $('#resetGo').addEventListener('click', function () {
      var res = auth.reset({
        code: $('#resetCode').value.trim(), newId: $('#resetId').value.trim(),
        newPass: $('#resetPass').value, newPin: $('#resetPin').value.trim()
      });
      if (!res.ok) return adminError(res.why);
      panel.innerHTML = '<h3>Done.</h3><p class="admin-ok">The new keys work from now on. Sign in with them.</p>';
    });
  }
  function openChange(kind) {
    var panel = $('#adminPanel');
    panel.hidden = false;
    panel.innerHTML =
      '<h3>Change ' + (kind === 'pin' ? 'the PIN' : 'the ID and password') + '</h3>' +
      '<p class="admin-lede">Give the current key first \u2014 a change is not a back door.</p>' +
      '<label class="admin-field"><span>Current ID (blank if using the PIN)</span><input id="chgCurId" spellcheck="false" placeholder="the keeper ID"></label>' +
      '<label class="admin-field"><span>Current password or PIN</span><input id="chgCurSecret" type="password" spellcheck="false"></label>' +
      (kind === 'pin'
        ? '<label class="admin-field"><span>New PIN</span><input id="chgPin" inputmode="numeric" spellcheck="false"></label>'
        : '<label class="admin-field"><span>New ID</span><input id="chgId" spellcheck="false" placeholder="keep the same if blank"></label>' +
          '<label class="admin-field"><span>New password</span><input id="chgPass" type="password" spellcheck="false"></label>') +
      '<div class="admin-actions"><button class="btn solid" id="chgGo">Save the new key</button></div>';
    $('#chgGo').addEventListener('click', function () {
      var res = auth.change({
        currentId: $('#chgCurId').value.trim() || null,
        currentSecret: $('#chgCurSecret').value,
        newId: kind === 'pin' ? '' : $('#chgId').value.trim(),
        newPass: kind === 'pin' ? '' : $('#chgPass').value,
        newPin: kind === 'pin' ? $('#chgPin').value.trim() : ''
      });
      if (!res.ok) return adminError(res.why);
      panel.innerHTML = '<h3>Saved.</h3><p class="admin-ok">Use the new key next time \u2014 the old one is gone.</p>';
      paintKeeper();
    });
  }
  /* the publish route for a static page */
  function openPublish() {
    var panel = $('#adminPanel');
    panel.hidden = false;
    panel.innerHTML =
      '<h3>Publishing a moment</h3>' +
      '<p class="admin-lede">A page on GitHub is a file; it cannot write to itself. So a new moment is published like this:</p>' +
      '<p class="admin-note" style="border:0;padding:0;margin:0 0 12px">' +
      '1 \u00b7 write it in the lab, then <b>Confirm &amp; Archive</b>;<br>' +
      '2 \u00b7 on the shelf press <b>Export .json</b>;<br>' +
      '3 \u00b7 save that file beside the page as <b>moments.json</b> and commit both.</p>' +
      '<div class="admin-actions"><button class="btn solid" id="pubExport">Export .json now</button>' +
      '<button class="btn ghost" id="pubCopy">copy the JSON</button><button class="btn ghost" id="pubStore">connect a backend instead</button></div>' +
      '<p class="admin-note">Visitors get the published copy on their own: the diary reads <b>moments.json</b> ' +
      'when it is there and merges it with what the browser holds.</p>';
    $('#pubExport').addEventListener('click', function () {
      download('moments.json', JSON.stringify({
        app: 'Reel', owner: OWNER, exportedAt: new Date().toISOString(),
        shelves: FOLDERS, atmospheres: SCENES, entries: state.entries
      }, null, 2));
      toast('Saved. Commit it as moments.json.', 3200);
    });
    $('#pubCopy').addEventListener('click', function () {
      copyText(JSON.stringify({ app: 'Reel', owner: OWNER, entries: state.entries }, null, 2))
        .then(function () { toast('Copied \u2014 paste it into moments.json', 3200); });
    });
  }

  /* where the moments are kept, and how to point it somewhere else */
  function openStorePanel() {
    var panel = $('#adminPanel');
    var st = ReelStore.status(), cfg = ReelStore.config();
    panel.hidden = false;
    panel.innerHTML =
      '<h3>Where the moments are kept</h3>' +
      '<p class="admin-lede">Right now: <b>' + (st.mode === 'local' ? 'this browser only' :
        (st.mode === 'git' ? 'the GitHub repository' : 'the site\u2019s own backend')) + '</b>' +
      (st.detail ? ' \u2014 ' + esc(st.detail) : '') + '.</p>' +
      '<div class="admin-modes" role="radiogroup">' +
        [['local', 'this browser'], ['git', 'GitHub repository'], ['api', 'site backend'], ['auto', 'choose automatically']]
          .map(function (m) {
            return '<button class="admin-mode' + (cfg.mode === m[0] ? ' is-on' : '') + '" data-mode="' + m[0] + '">' + m[1] + '</button>';
          }).join('') +
      '</div>' +
      '<div id="storeGit" hidden>' +
        '<label class="admin-field"><span>Owner / organisation</span><input id="stOwner" placeholder="yashpatel" spellcheck="false" value="' + esc(cfg.git.owner) + '"></label>' +
        '<label class="admin-field"><span>Repository</span><input id="stRepo" placeholder="reel-diary" spellcheck="false" value="' + esc(cfg.git.repo) + '"></label>' +
        '<label class="admin-field"><span>Branch</span><input id="stBranch" spellcheck="false" value="' + esc(cfg.git.branch) + '"></label>' +
        '<label class="admin-field"><span>File to keep the shelf in</span><input id="stPath" spellcheck="false" value="' + esc(cfg.git.path) + '"></label>' +
        '<label class="admin-field"><span>Fine-grained token (contents: read &amp; write)</span><input id="stToken" type="password" spellcheck="false" placeholder="github_pat_\u2026"></label>' +
      '</div>' +
      '<div id="storeApi" hidden>' +
        '<label class="admin-field"><span>Endpoint</span><input id="stUrl" spellcheck="false" value="' + esc(cfg.api.url) + '"></label>' +
        '<p class="admin-note" id="storeSession">Writes here are signed by your own sign-in, not by a string kept in this browser: sign in with the keeper\u2019s key and the site\u2019s backend accepts what you archive. If the host has not been given a keeper yet, the endpoint will say it is read-only rather than pretend.</p>' +
      '</div>' +
      '<p class="admin-note" id="storeHelp">Every add, change and delete is written to the place you choose. ' +
      'A GitHub token stays in this browser; the site\u2019s backend needs no token at all \u2014 it checks your signed-in session on every write.</p>' +
      '<div class="admin-actions"><button class="btn solid" id="storeSave">Save &amp; test</button>' +
      '<button class="admin-link" id="storeNow">push the shelf now</button></div>' +
      '<p class="admin-ok" id="storeOut" hidden></p>';
    function showMode(m) {
      Array.prototype.forEach.call(panel.querySelectorAll('[data-mode]'), function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-mode') === m);
      });
      $('#storeGit').hidden = m !== 'git';
      $('#storeApi').hidden = !(m === 'api' || m === 'auto');
    }
    Array.prototype.forEach.call(panel.querySelectorAll('[data-mode]'), function (btn) {
      btn.addEventListener('click', function () { showMode(btn.getAttribute('data-mode')); });
    });
    showMode(cfg.mode);
    $('#storeNow').addEventListener('click', function () {
      syncUp('shelf pushed by hand');
      $('#storeOut').hidden = false;
      $('#storeOut').textContent = 'Pushing\u2026';
      setTimeout(function () { $('#storeOut').textContent = syncState.busy ? 'Still pushing\u2026' : 'Pushed. ' + (syncState.detail || ''); }, 1200);
    });
    $('#storeSave').addEventListener('click', function () {
      var picked = panel.querySelector('[data-mode].is-on');
      var mode = picked ? picked.getAttribute('data-mode') : 'auto';
      var out = $('#storeOut'); out.hidden = false; out.textContent = 'Testing\u2026';
      ReelStore.configure({
        mode: mode,
        git: {
          owner: ($('#stOwner') || {}).value || '', repo: ($('#stRepo') || {}).value || '',
          branch: ($('#stBranch') || {}).value || 'main', path: ($('#stPath') || {}).value || 'moments.json',
          token: ($('#stToken') || {}).value || ''
        },
        api: { url: ($('#stUrl') || {}).value || '/api/moments', token: ($('#stApiToken') || {}).value || '' }
      });
      ReelStore.test().then(function (rep) {
        out.textContent = (rep.ok ? '\u2713 ' : '\u2717 ') + rep.detail;
        if (rep.ok) {
          pullShelf(false).then(function () { syncState.mode = ReelStore.status().mode; paintSync(); });
          if (rep.mode !== 'local') syncUp('first shelf from here');
        }
      });
    });
  }


  /* ── changing a moment that is already on the shelf ─────────────────────
     A moment opens with the keeper's own words put back in the lab, the same
     analysis running over them, and Confirm & Archive becomes Save changes.
     It keeps its id, so the shelf — and the backend — update in place instead
     of gaining a twin. */
  function startEdit(id) {
    if (!needKeeper('Changing a moment that is already shelved is the keeper\u2019s.')) return;
    var e = state.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    state.editing = id;
    state.draft = e.raw;
    state.titleIdx = 0;
    state.summary = e.summary || '';
    state.summaryTouched = true;                 /* his own words for it stay put */
    state.primary = (e.primary && e.primary.id) || state.primary;
    state.cross = (e.crossLinks || []).map(function (c) { return c.id; });
    state.wishChecked = {};
    (e.wish && e.wish.items || []).forEach(function (i) { state.wishChecked[i.text] = true; });
    state.lastAnalyzed = '';                     /* so the panel reads it again */
    saveDraft();
    var d = $('#draft');
    if (d) d.value = e.raw;
    go('lab');
    paintEditFlag();
    later(120, function () {
      var t = $('#draft');
      if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      runAnalyze(true);
      updateCounter();
    });
    toast('Opened for changing \u2014 <b>' + esc(e.title) + '</b>. Save changes when it reads right.', 4200);
  }
  function paintEditFlag() {
    var flag = $('#editFlag');
    if (!flag) return;
    var ed = state.editing ? state.entries.filter(function (x) { return x.id === state.editing; })[0] : null;
    flag.hidden = !ed;
    flag.innerHTML = ed ? 'changing <b>' + esc(ed.title) + '</b> \u2014 first written ' + shortDate(ed.createdAt || ed.when) : '';
  }
  function cancelEdit() {
    state.editing = null;
    paintEditFlag();
    catchUpAfterEdit();
    state.draft = '';
    saveDraft();
    var d = $('#draft');
    if (d) d.value = '';
    updateCounter();
    resetPanel();
    go('moment');
    toast('Left as it was. Nothing changed.', 2400);
  }

  /* is the pen allowed? if not, the sheet opens with a reason */
  function needKeeper(reason) {
    if (auth.isAdmin()) return true;
    openAdmin(reason);
    return false;
  }

  /* ══════════════════════════════ ROUTER ══════════════════════════════ */
  var SCREENS = {
    cover: { el: '#screenCover', back: null },
    foyer: { el: '#screenFoyer', back: 'the cover' },
    lab: { el: '#screenLab', back: 'the doors' },
    shelf: { el: '#screenShelf', back: 'the doors' },
    moment: { el: '#screenMoment', back: 'the shelves' },
    desk: { el: '#screenDesk', back: 'the shelves' }
  };
  function go(name, opts) {
    opts = opts || {};
    if (state.screen === name && !opts.force) return;
    clearTimers();
    if (name !== 'moment') {
      clearBO();
      var bo = document.getElementById('bookOpen');
      if (bo) bo.classList.remove('play', 'flip');
    }
    var prev = state.screen;
    state.screen = name;
    Object.keys(SCREENS).forEach(function (k) {
      var el = $(SCREENS[k].el);
      if (!el) return;
      el.classList.toggle('is-active', k === name);
      /* every screen may scroll if its contents need the room */
      el.classList.remove('no-scroll');
    });
    /* the screen being left drifts the other way while it fades */
    if (prev && prev !== name && SCREENS[prev]) {
      var prevEl = $(SCREENS[prev].el);
      if (prevEl) {
        prevEl.classList.add('leaving');
        later(900, function () { prevEl.classList.remove('leaving'); });
      }
    }
    var backConfig = SCREENS[name].back;
    var backBtn = $('#backBtn');
    if (backConfig) {
      $('#backLabel').textContent = backConfig;
      backBtn.classList.add('show');
    } else {
      backBtn.classList.remove('show');
    }
    backBtn.classList.toggle('on-scene', name === 'moment');
    backBtn.classList.toggle('on-paper', name === 'foyer');
    if (name !== 'moment') stopWeather();

    if (name === 'cover') closeCover();
    paintClock();
    updateRotateHint();
    if (name === 'shelf') renderLibrary();
    if (name === 'lab') $(SCREENS.lab.el).scrollTop = 0;
    if (name === 'foyer' && prev === 'cover') $(SCREENS.foyer.el).scrollTop = 0;
    if (opts.focus) later(240, function () { var el = $(opts.focus); if (el) el.focus(); });
  }
  function back() {
    if ($('#exit').classList.contains('open')) { closeExit(); return; }
    if (state.screen === 'moment') { closeMoment(); return; }
    if (state.screen === 'lab' || state.screen === 'shelf') { go('foyer'); return; }
    if (state.screen === 'foyer') { go('cover'); return; }
  }

  /* ─────────────────────────────────────────────── fitting, on any screen
     Everything that has a size worth scaling (the books on the shelves, the
     gaps between them, the moment page's rhythm) hangs off --fit, so a phone,
     a tablet and a desktop each get a layout that belongs to them rather than
     one design squeezed. Recomputed on resize and on rotation. */
  function computeFit() {
    var w = window.innerWidth, h = window.innerHeight;
    var portrait = h >= w;
    var short = !portrait && h <= 560;              /* a phone on its side */
    var byw = w / 1200;                              /* wide screens breathe more */
    var byh = h / 900;
    var k = Math.min(1.18, Math.max(0.62, Math.min(byw, byh) + 0.12));
    if (portrait && w <= 480) k = Math.min(k, 0.82); /* a narrow column: keep books modest */
    if (short) k = Math.min(k, 0.78);                /* sideways phone: keep it compact */
    return { k: +k.toFixed(3), portrait: portrait, short: short, w: w, h: h };
  }
  function applyFit() {
    state.fit = computeFit();
    document.documentElement.style.setProperty('--fit', String(state.fit.k));
    /* the search box says exactly as much as the screen can show */
    var search = $('#search');
    if (search) search.placeholder = state.fit.short ? 'Search the shelves…'
      : (window.innerWidth < 520 ? 'Search the shelves — feelings, items…'
        : 'Search the shelves — feelings, people, items, places…');
    document.documentElement.classList.toggle('fit-short', state.fit.short);
    document.documentElement.classList.toggle('fit-portrait', state.fit.portrait);
    if (state.screen === 'shelf') renderLibrary();
    $('#sceneCanvas') && weather.resize && weather.resize();
    updateRotateHint();
  }
  var fitTimer = null;
  function onViewportChange() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(applyFit, 140);
  }

  /* ────────────────────────────────────── the invitation to turn the page
     Shown once, on a phone held upright, when its owner has reached the shelf
     (where landscape actually pays off). It never blocks the screen: it is a
     card at the foot of the page that slides away on its own the moment the
     device turns, and stays away once dismissed. */
  var KEY_ROTATE = 'reel.rotate.v1';
  function isPhone() {
    var coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    return coarse || Math.min(window.innerWidth, window.innerHeight) <= 480;
  }
  function updateRotateHint() {
    var el = $('#rotateHint');
    if (!el) return;
    var dw = document.documentElement;
    var portrait = dw.classList.contains('fit-portrait');
    var wanted = isPhone() && portrait && !state.reduced &&
                 (state.screen === 'shelf' || state.screen === 'moment') &&
                 store.getItem(KEY_ROTATE) !== '1';
    el.classList.toggle('show', wanted);
    /* while the card sits at the foot of the page, the page keeps room for it */
    document.documentElement.classList.toggle('rotate-offered', wanted);
  }
  function dismissRotate() {
    try { store.setItem(KEY_ROTATE, '1'); } catch (e) {}
    var el = $('#rotateHint');
    if (el) el.classList.remove('show');
  }


  /* ═══════════════════════════════ THE PUBLISHED SHELF ══════════════════
     On GitHub the diary is a file. Whatever the keeper commits as
     moments.json sits beside it, and every visitor's page reads it — so a
     moment written once is seen by everyone, without a server anywhere. */
  var published = { count: 0, at: null };
  function loadPublished() {
    if (ReelStore.status().mode !== 'local') return;   /* a backend outranks a static file */
    if (typeof fetch !== 'function' || !/^https?:$/.test(window.location.protocol)) return;
    fetch('moments.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('no published shelf');
      return r.json();
    }).then(function (doc) {
      var list = (doc && (doc.entries || doc.moments)) || [];
      if (!list.length) return;
      var known = {};
      state.entries.forEach(function (e) { known[e.id] = 1; });
      var added = list.filter(function (e) { return e && e.id && !known[e.id]; });
      if (!added.length) { published = { count: list.length, at: doc.exportedAt || null }; return; }
      added.forEach(function (e) { e.published = true; });
      state.entries = state.entries.concat(added).sort(function (a, b) {
        return String(b.when || '').localeCompare(String(a.when || ''));
      });
      published = { count: list.length, at: doc.exportedAt || null };
      if (state.screen === 'shelf') renderLibrary();
      toast('The published shelf arrived \u2014 ' + added.length + ' moment' + (added.length === 1 ? '' : 's') +
            ' from moments.json.', 3800);
    })['catch'](function () { /* no published shelf yet: nothing to say */ });
  }
  /* ══════════════════════════════ COVER ══════════════════════════════ */
  function coverStats() {
    var n = state.entries.length;
    var words = state.entries.reduce(function (a, e) { return a + (e.words || 0); }, 0);
    var wish = state.entries.filter(function (e) { return e.wish && e.wish.detected; }).length;
    var first = state.entries[state.entries.length - 1], last = state.entries[0];
    var span = (first && last) ? shortDate(first.createdAt) + ' — ' + shortDate(last.createdAt) : '—';
    return { n: n, words: words, wish: wish, span: span, html: n + ' moments · ' + words.toLocaleString() + ' words' };
  }
  function openCover() {
    var screen = $('#screenCover');
    /* an impatient second click skips the rest of the opening */
    if (screen.classList.contains('opening')) { go('foyer'); return; }
    var stats = coverStats();
    $('#insideStats').textContent = stats.html;
    /* put the hinge — the centre line of the opened diary — on the centre of
       the screen, and shrink the book just enough that both pages fit */
    var book = $('#book');
    var r = book.getBoundingClientRect();
    var W = r.width || 0, H = r.height || 0;
    if (W && H) {
      var fit = (window.innerWidth * 0.96) / (2 * W);
      var scale = Math.max(0.78, Math.min(1.05, fit));
      var cx = r.left + W / 2;
      var cy = r.top + H / 2;
      screen.style.setProperty('--book-scale', scale.toFixed(4));
      screen.style.setProperty('--book-dx', (window.innerWidth / 2 - cx + (W * scale) / 2).toFixed(1) + 'px');
      screen.style.setProperty('--book-dy', (window.innerHeight / 2 - cy).toFixed(1) + 'px');
    }
    screen.classList.add('opening');
    try { store.setItem(KEY_OPENED, '1'); } catch (e) {}
    /* cover turns → first pages flick → the page takes the screen → the squares */
    later(state.reduced ? 60 : 1880, function () { go('foyer'); });
  }
  /* coming back to the cover: the diary shuts itself again */
  function closeCover() {
    var screen = $('#screenCover');
    if (!screen) return;
    screen.classList.add('closing');
    screen.classList.remove('opening');
    laterOnce(460, function () { screen.classList.remove('closing'); });
  }

  /* ══════════════════════════════ WEATHER ══════════════════════════════ */
  var weather = (function () {
    var canvas = $('#sceneCanvas');
    var ctx = canvas ? canvas.getContext('2d') : null;
    var parts = [], mode = 'dust', accent = '#e3b681', raf = null, w = 0, h = 0, dpr = 1, running = false;

    function resize() {
      if (!canvas) return;
      var rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width || window.innerWidth;
      h = rect.height || window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function uniq(hi, lo) { return lo + Math.random() * (hi - lo); }
    function make() {
      var p = { x: Math.random() * w, y: Math.random() * h, a: Math.random() * Math.PI * 2 };
      if (mode === 'rain') { p.len = uniq(14, 34); p.v = uniq(520, 900); p.x0 = uniq(-40, 40); p.o = uniq(.10, .26); }
      else if (mode === 'star') { p.r = uniq(.6, 1.5); p.t = Math.random() * 6.28; p.o = uniq(.2, .7); p.v = uniq(1, 5); }
      else if (mode === 'snow') { p.r = uniq(1, 2.6); p.v = uniq(10, 34); p.s = uniq(.5, 1.6); p.o = uniq(.25, .6); }
      else if (mode === 'mote' || mode === 'ember') { p.r = uniq(.8, 2.2); p.v = -uniq(10, 34); p.o = uniq(.2, .55); p.s = uniq(.4, 1.2); }
      else if (mode === 'petal') { p.r = uniq(2, 4.4); p.v = uniq(16, 40); p.s = uniq(.6, 1.8); p.o = uniq(.22, .5); p.rot = Math.random() * 6.28; p.vr = uniq(-.8, .8); }
      else if (mode === 'bokeh') { p.r = uniq(6, 26); p.v = -uniq(2, 12); p.o = uniq(.03, .1); p.s = uniq(.2, .7); }
      else if (mode === 'smoke' || mode === 'steam') { p.r = uniq(8, 24); p.v = -uniq(6, 20); p.o = uniq(.02, .07); p.s = uniq(.4, 1.4); }
      else { p.r = uniq(.8, 2); p.v = uniq(6, 22); p.o = uniq(.08, .3); p.s = uniq(.2, .8); }
      return p;
    }
    function seed() {
      var n = ({ rain: 150, star: 110, snow: 130, bokeh: 26, smoke: 34, steam: 30, petal: 42 })[mode] || 78;
      parts = [];
      for (var i = 0; i < n; i++) parts.push(make());
    }
    function step(p, t) {
      if (mode === 'rain') {
        p.y += p.v / 60; p.x += p.x0 / 60;
        if (p.y - p.len > h) { p.y = -uniq(0, 40); p.x = Math.random() * w; }
      } else if (mode === 'star') {
        p.t += .02;
        if (p.o < .8 && Math.random() < .002) p.o = uniq(.3, .8);
      } else if (mode === 'snow' || mode === 'petal') {
        p.y += p.v / 60; p.a += .01; p.x += Math.sin(p.a) * p.s;
        if (mode === 'petal') p.rot += p.vr / 30;
        if (p.y - 6 > h) { p.y = -8; p.x = Math.random() * w; }
      } else if (mode === 'mote' || mode === 'ember') {
        p.y += p.v / 60; p.x += Math.sin(p.a += .012) * p.s;
        if (p.y < -8) { p.y = h + 8; p.x = Math.random() * w; }
      } else if (mode === 'bokeh' || mode === 'smoke' || mode === 'steam') {
        p.y += p.v / 60; p.x += Math.sin(p.a += .006) * p.s;
        if (p.y + p.r < 0) { p.y = h + p.r; p.x = Math.random() * w; }
      } else {
        p.y += p.v / 60; p.x += Math.sin(p.a += .01) * p.s;
        if (p.y - 4 > h) { p.y = -4; p.x = Math.random() * w; }
      }
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      var soft = (mode === 'bokeh' || mode === 'smoke' || mode === 'steam' || mode === 'ember' || mode === 'mote');
      ctx.globalCompositeOperation = soft ? 'lighter' : 'source-over';
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        step(p);
        if (mode === 'rain') {
          ctx.strokeStyle = rgba(accent, p.o);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.x0 * .05, p.y - p.len);
          ctx.stroke();
        } else if (mode === 'star') {
          ctx.fillStyle = rgba(accent, p.o * (0.6 + 0.4 * Math.sin(p.t)));
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill();
        } else if (mode === 'petal') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = rgba(accent, p.o);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r, p.r * .55, 0, 0, 6.29);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = rgba(accent, p.o);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    }
    return {
      start: function (modeName, accentHex) {
        if (!ctx) return;
        mode = modeName || 'dust';
        accent = accentHex || '#e3b681';
        resize();
        if (state.reduced) { seed(); ctx.clearRect(0, 0, w, h); parts.forEach(function (p) { p.y = Math.random() * h; }); return; }
        seed();
        if (!running) { running = true; raf = requestAnimationFrame(draw); }
      },
      stop: function () {
        if (raf) cancelAnimationFrame(raf);
        raf = null; running = false;
        if (ctx) ctx.clearRect(0, 0, w, h);
      },
      resize: function () { if (running) resize(); }
    };
  })();
  function stopWeather() { weather.stop(); }
  window.addEventListener('resize', function () { weather.resize(); });

  /* ══════════════════════════════ ANALYSIS ══════════════════════════════ */
  var SCAN_STEPS = [
    'reading the tone of it…',
    'listening for what sits under the words…',
    'checking the body and the mind lines…',
    'choosing the shelf this belongs to…'
  ];
  function setLamp(text, live) {
    $('#lampText').textContent = text;
    $('#lamp').classList.toggle('live', !!live);
  }
  function scanningMarkup() {
    return '<div class="scanning">' + SCAN_STEPS.map(function (s, i) {
      return '<div class="scan-line pending" data-step="' + i + '"><span class="tick">◆</span><span>' + s + '</span></div>';
    }).join('') + '<div class="scan-bar"><i></i></div></div>';
  }
  var debounce = null;
  function clearOverrides() {
    state.primary = null; state.cross = []; state.titleIdx = 0;
    state.summaryTouched = false; state.summary = ''; state.overridesFor = null;
  }
  function queueAnalyze(delay) {
    clearTimeout(debounce);
    if (wordsOf(state.draft) < 1) { clearOverrides(); resetPanel(); return; }
    debounce = setTimeout(runAnalyze, delay == null ? 820 : delay);
  }
  function runAnalyze(force) {
    var text = state.draft.trim();
    if (wordsOf(text) < 1) { resetPanel(); return; }
    if (!force && text === state.lastAnalyzed && state.a) { renderPanel(state.a, true); return; }
    if (state.overridesFor !== text) clearOverrides();
    state.reading = true;
    var a = Engine.analyze(text, { style: state.style, seed: state.seed });
    state.a = a;
    state.lastAnalyzed = text;
    if (!state.primary || !a.shelves.some(function (s) { return s.id === state.primary; })) state.primary = a.primary.id;
    if (!state.cross.length) state.cross = a.crossLinks.map(function (c) { return c.id; });
    state.cross = state.cross.filter(function (id) { return id !== state.primary; }).slice(0, 2);
    if (!state.summaryTouched) state.summary = a.logline;
    state.wishChecked = {};
    setLamp('reading you…', true);
    $('#modeLabel').textContent = 'reading';
    $('#panelEmpty').style.display = 'none';
    $('#panelLive').style.display = '';
    $('#panelLive').innerHTML = scanningMarkup();
    var step = 0;
    var stepper = setInterval(function () {
      var el = $('.scan-line[data-step="' + step + '"]');
      if (el) { el.classList.remove('pending'); el.querySelector('.tick').textContent = '✔'; }
      step++;
      if (step >= SCAN_STEPS.length) clearInterval(stepper);
    }, 95);
    later(state.reduced ? 40 : 400, function () {
      clearInterval(stepper);
      state.reading = false;
      renderPanel(a);
    });
  }
  function resetPanel() {
    state.a = null; state.lastAnalyzed = '';
    $('#panelEmpty').style.display = '';
    $('#panelLive').style.display = 'none';
    $('#panelLive').innerHTML = '';
    $('#confLabel').textContent = '';
    $('#modeLabel').textContent = 'listening';
    setLamp('waiting for your words', false);
  }

  /* --------------------------------------------------------------- render */
  function reveal(root, base) {
    $$('.reveal', root).forEach(function (el, i) {
      later((base || 0) + i * 38, function () { el.classList.add('in'); });
    });
  }

  function renderPanel(a, soft) {
    setLamp('read · ' + a.confidence + '% sure', false);
    $('#modeLabel').textContent = a.wish.detected ? 'wish detected' : (a.phase.arcWord + ' · ' + a.phase.moodWord);
    $('#confLabel').textContent = '· ' + a.confidence + '% read';
    var P = state.primary || a.primary.id;
    var cross = state.cross.filter(function (id) { return id !== P; });
    var html = '';

    /* scene of this entry */
    html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">The atmosphere</div>' +
      '<div class="sec-note">what this page will look like when opened</div></div>' +
      '<div class="scene-preview" style="background:' + sceneGradient(a.scene) + '">' +
      '<span class="scene-chip" style="--sc-accent:' + a.scene.accent + '"><i></i>' + esc(a.scene.label) + '</span>' +
      '<div class="scene-preview-line">' + esc(a.scene.line) + '</div>' +
      (a.scene.where ? '<div class="scene-preview-where">' + esc(a.scene.where) + '</div>' : '') +
      '</div></div>';

    /* emotions */
    html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">What is here</div>' +
      '<div class="sec-note">' + a.emotions.top.length + ' signal' + (a.emotions.top.length === 1 ? '' : 's') + ' · ' + esc(a.phase.label) + '</div></div>';
    html += '<div class="emo">' + (a.emotions.top.length ? a.emotions.top.map(function (e) {
      return '<div class="emo-row"><div class="emo-name">' + esc(e.label) + '</div>' +
        '<div class="emo-bar"><i data-w="' + e.pct + '" style="background:' + emotionColor(e) + '"></i></div>' +
        '<div class="emo-val">' + e.pct + '%</div></div>';
    }).join('') : '<div class="kv"><dd>Nothing loud enough to name yet — this one is quiet at the edges.</dd></div>') + '</div></div>';

    /* body + mind */
    html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">Body &amp; mind</div><div class="sec-note">' +
      (a.energy > 0.62 ? 'carrying energy' : a.energy < 0.42 ? 'running low' : 'holding steady') + ' · clarity ' + Math.round(a.clarity * 100) + '%</div></div>';
    html += '<dl class="kv">';
    html += '<dt>Body</dt><dd>' + (a.phys.length ? a.phys.map(function (p) {
      var echo = p.terms.filter(function (t) { return t.toLowerCase() !== p.label.toLowerCase(); }).slice(0, 3);
      return esc(p.label) + (echo.length ? ' <em>(' + esc(echo.join(', ')) + ')</em>' : '');
    }).join(' · ') : '<span style="color:var(--ink-4)">nothing physical gets a mention here — the body is not the story today</span>') + '</dd>';
    html += '<dt>Mind</dt><dd>' + (a.mind.length ? a.mind.map(function (m) { return esc(m.label); }).join(' · ') : '<span style="color:var(--ink-4)">no strong mind-state signal</span>') + '</dd>';
    html += '<dt>Themes</dt><dd>' + (a.themes.length ? a.themes.slice(0, 5).map(function (t) { return '<span class="tag muted">' + esc(t.label) + '</span>'; }).join(' ') : '<span style="color:var(--ink-4)">—</span>') + '</dd>';
    if (a.entities.people.length) html += '<dt>People</dt><dd>' + a.entities.people.slice(0, 4).map(esc).join(' · ') + '</dd>';
    if (a.entities.place) html += '<dt>Where</dt><dd>' + esc(a.entities.place) + (a.entities.time ? ' · ' + esc(a.entities.time) : '') + '</dd>';
    html += '</dl></div>';

    /* shelves */
    var others = a.shelves.filter(function (s) { return s.id !== P; });
    var topOthers = others.slice(0, 3);
    var rest = a.shelves.filter(function (s) { return s.id !== P && topOthers.indexOf(s) < 0; });
    html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">Life chapter</div>' +
      '<div class="sec-note">one primary + up to two cross-links</div></div>';
    html += '<div class="shelves" id="shelfPick">';
    html += shelfCard(a.shelves.filter(function (s) { return s.id === P; })[0] || a.primary, true, false);
    html += topOthers.map(function (s) { return shelfCard(s, false, cross.indexOf(s.id) >= 0); }).join('');
    html += '</div>';
    html += '<div id="moreShelves" style="display:none"><div class="shelves" style="margin-top:10px">' +
      rest.map(function (s) { return shelfCard(s, false, cross.indexOf(s.id) >= 0); }).join('') + '</div></div>';
    html += '<div class="suggest"><button class="chip-mini" id="toggleShelves">show all ' + FOLDERS.length + ' shelves</button>' +
      '<span class="sec-note" style="align-self:center">· ' + esc(reasonLine(P, a)) + '</span></div>';
    html += '</div>';

    /* titles */
    html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">' + a.titles.length + ' title option' + (a.titles.length === 1 ? '' : 's') + '</div>' +
      '<div class="sec-note"><button class="chip-mini" id="shuffleTitles">↻ other angles</button></div></div>';
    html += '<div class="titles" id="titlePick">' + a.titles.map(function (t, i) {
      return '<button class="title-card' + (i === Math.min(state.titleIdx, a.titles.length - 1) ? ' chosen' : '') + '" data-ti="' + i + '">' +
        '<span class="title-text">' + esc(t.text) + '</span>' +
        '<span class="title-style">' + esc(t.style || 'story') + '</span></button>';
    }).join('') + '</div></div>';

    /* summary */
    html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">Cinematic summary</div>' +
      '<div class="sec-note"><button class="chip-mini" id="reSummary">↻ again</button></div></div>' +
      '<textarea id="summaryBox" spellcheck="false" rows="3">' + esc(state.summary || a.logline) + '</textarea>' +
      '<div class="sec-note" style="margin-top:8px">Saved with the moment as the feeling of it — edit if I got it wrong.</div></div>';

    /* wish */
    if (a.wish.detected) {
      html += '<div class="sec reveal"><div class="wish"><div class="wish-head"><div class="sec-title">To acquire — clean list</div>' +
        '<div class="wish-amounts">' + (a.wish.amounts && a.wish.amounts.length ? 'budget mentioned: ' + a.wish.amounts.join(' · ') : 'this goes in Wishes &amp; Tangible Dreams') + '</div></div>';
      html += '<ul class="wish-list">' + a.wish.items.map(function (it, i) {
        return '<li><button class="wish-check' + (state.wishChecked[i] ? ' on' : '') + '" data-wi="' + i + '">✓</button>' +
          '<span>' + esc(it.text) + '</span><span class="wish-kind">' + esc(it.kind) + '</span></li>';
      }).join('') + '</ul>';
      if (a.highlight) html += '<div class="wish-why"><span>why it is here</span><b>“' + esc(a.highlight) + '”</b></div>';
      html += '</div></div>';
    } else if (a.highlight) {
      html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">The line to remember</div></div>' +
        '<div class="paper-highlight">“' + esc(a.highlight) + '”</div></div>';
    }

    /* refine + confirm */
    html += '<div class="sec reveal"><div class="sec-head"><div class="sec-title">Refine with me</div>' +
      '<div class="sec-note">say what you want changed</div></div>' +
      '<div class="refine"><input id="refineInput" placeholder="try: make it more poetic · shorter · put it in Career Crossroads">' +
      '<button class="btn" id="refineGo">Refine</button></div>' +
      '<div class="suggest">' + ['more cinematic', 'more poetic', 'plainer', 'shorter', 'warmer', 'wry'].map(function (s) {
        return '<button class="chip-mini refine-quick">' + esc(s) + '</button>';
      }).join('') + '</div></div>';

    html += '<div class="sec reveal"><div class="action-row">' +
      '<button class="confirm" id="confirmBtn">' + (state.editing ? 'Save changes' : 'Confirm &amp; Archive') + '</button>' +
      (state.editing ? '<button class="btn ghost" id="cancelEditBtn">leave it as it was</button>' : '') +
      '<div class="hint" id="keeperHint">' + keeperHintHtml() + '</div>' +
      '</div></div>';

    var live = $('#panelLive');
    live.innerHTML = html;
    $('#panelEmpty').style.display = 'none';
    live.style.display = '';
    later(50, function () {
      $$('.emo-bar i', live).forEach(function (b) { b.style.width = b.getAttribute('data-w') + '%'; });
      $$('.mini-bar i', live).forEach(function (b) { b.style.width = b.getAttribute('data-w') + '%'; });
    });
    if (!soft) reveal(live, 20); else $$('.reveal', live).forEach(function (el) { el.classList.add('in'); });
    wirePanel(a);
    if (!soft) autoGrowSummary();
  }

  function shelfCard(s, isPrimary, isCross) {
    if (!s) return '';
    var pct = Math.max(6, Math.min(100, Math.round((s.score || 0) * 12)));
    return '<div class="shelf-card' + (isPrimary ? ' primary chosen' : (isCross ? ' cross chosen' : '')) + '" data-shelf="' + s.id + '">' +
      '<div class="shelf-name">' + esc(s.name) + '</div>' +
      '<div class="shelf-why">' + esc(s.blurb) + '</div>' +
      '<div class="shelf-meter"><b>fit</b><div class="mini-bar"><i data-w="' + pct + '"></i></div>' +
      '<button class="chip-mini" data-link="' + s.id + '">' + (isCross ? 'unlink' : 'cross-link') + '</button></div></div>';
  }
  function reasonLine(id, a) {
    var s = a.shelves.filter(function (x) { return x.id === id; })[0];
    if (!s) return '';
    if (id === a.primary.id) return a.reason;
    return 'also reads as ' + s.name.toLowerCase();
  }
  function autoGrowSummary() {
    var box = $('#summaryBox');
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = Math.max(66, box.scrollHeight) + 'px';
  }

  function wirePanel(a) {
    var live = $('#panelLive');
    $$('.shelf-card', live).forEach(function (card) {
      card.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-link]')) return;
        state.primary = card.getAttribute('data-shelf');
        state.overridesFor = state.draft.trim();
        state.cross = state.cross.filter(function (id) { return id !== state.primary; });
        renderPanel(a, true);
        toast('Primary folder → <b>' + esc(FOLDER[state.primary].name) + '</b>', 2200);
      });
    });
    $$('[data-link]', live).forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = btn.getAttribute('data-link');
        if (id === state.primary) { toast('That is already the primary folder.', 2000); return; }
        state.overridesFor = state.draft.trim();
        var i = state.cross.indexOf(id);
        if (i >= 0) state.cross.splice(i, 1);
        else {
          if (state.cross.length >= 2) { toast('Three folders is the limit — unlink one first.', 2400); return; }
          state.cross.push(id);
        }
        renderPanel(a, true);
      });
    });
    var toggle = $('#toggleShelves', live);
    if (toggle) toggle.addEventListener('click', function () {
      var more = $('#moreShelves');
      var open = more.style.display !== 'none';
      more.style.display = open ? 'none' : '';
      toggle.textContent = open ? 'show all ' + FOLDERS.length + ' shelves' : 'hide the rest';
      if (!open) later(40, function () { $$('.mini-bar i', more).forEach(function (b) { b.style.width = b.getAttribute('data-w') + '%'; }); });
    });
    $$('#titlePick .title-card', live).forEach(function (card) {
      card.addEventListener('click', function () {
        state.titleIdx = parseInt(card.getAttribute('data-ti'), 10) || 0;
        $$('#titlePick .title-card', live).forEach(function (c) { c.classList.remove('chosen'); });
        card.classList.add('chosen');
      });
    });
    $('#shuffleTitles').addEventListener('click', function () {
      state.seed += 1; state.style = null;
      var repl = Engine.analyze(state.draft.trim(), { seed: state.seed });
      state.a = repl;
      if (!state.summaryTouched) state.summary = repl.logline;
      state.titleIdx = 0;
      renderPanel(repl, true);
      toast('Three new angles, from the same story.', 2200);
    });
    $('#reSummary').addEventListener('click', function () {
      state.seed += 1;
      var repl = Engine.analyze(state.draft.trim(), { seed: state.seed, style: state.style });
      state.a = repl;
      state.summary = repl.logline; state.summaryTouched = false;
      renderPanel(repl, true);
    });
    var box = $('#summaryBox');
    if (box) box.addEventListener('input', function () { state.summary = box.value; state.summaryTouched = true; autoGrowSummary(); });
    $$('.wish-check', live).forEach(function (b) {
      b.addEventListener('click', function () {
        var i = b.getAttribute('data-wi');
        state.wishChecked[i] = !state.wishChecked[i];
        b.classList.toggle('on', !!state.wishChecked[i]);
      });
    });
    $('#refineGo').addEventListener('click', submitRefine);
    $('#refineInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitRefine(); });
    $$('.refine-quick', live).forEach(function (b) { b.addEventListener('click', function () { refine(b.textContent); }); });
    $('#confirmBtn').addEventListener('click', confirmArchive);
    var pv = $('#previewBtn');
    if (pv) pv.addEventListener('click', function () {
      if (!state.a) return toast('Nothing to preview yet \u2014 write a line first.', 2600);
      var entry = buildEntry(state.a, {
        titleIdx: state.titleIdx, summary: state.summary, primary: state.primary,
        cross: state.cross, wishChecked: state.wishChecked, published: true
      });
      var typed = $('#labTitle') && $('#labTitle').value.trim();
      if (typed) entry.title = typed.slice(0, 200);
      openMoment(null, null, entry);
    });
    if ($('#cancelEditBtn')) $('#cancelEditBtn').addEventListener('click', cancelEdit);
  }

  function submitRefine() {
    var v = $('#refineInput').value.trim();
    if (!v) return;
    refine(v);
    $('#refineInput').value = '';
  }
  function matchFolder(text) {
    var q = text.toLowerCase();
    var hit = null;
    FOLDERS.forEach(function (f) {
      var bits = f.name.toLowerCase().split(/[^a-z]+/).filter(function (b) { return b.length > 3; });
      if (f.name.toLowerCase().indexOf(q) >= 0 || bits.some(function (b) { return q.indexOf(b) >= 0; })) hit = f;
    });
    var syn = {
      wishes: ['wish', 'wishlist', 'shopping', 'buy', 'things i want', 'tangible'],
      heart: ['heartbreak', 'breakup', 'grief', 'healing', 'sad'],
      love: ['people', 'love', 'family', 'friends', 'relationship'],
      career: ['work', 'job', 'office', 'career'],
      quiet: ['dream', 'hopes', 'future', 'plans'],
      daily: ['grind', 'tired', 'stress', 'struggle', 'burnout'],
      body: ['health', 'body', 'sleep', 'gym'],
      nest: ['money', 'home', 'rent', 'bills', 'savings'],
      self: ['self', 'growth', 'me', 'becoming'],
      joy: ['happy', 'joy', 'good day']
    };
    if (hit) return hit.id;
    for (var id in syn) { if (syn[id].some(function (k) { return q.indexOf(k) >= 0; })) return id; }
    return null;
  }
  function refine(request) {
    var text = state.draft.trim();
    if (!text) return;
    var info = Engine.refinePrompt(text, request);
    var folder = matchFolder(request);
    if (info.style) state.style = info.style;
    state.seed += info.seedBump || 1;
    var a = Engine.analyze(text, { style: state.style, seed: state.seed });
    state.a = a;
    state.titleIdx = 0;
    if (!state.summaryTouched) state.summary = a.logline;
    state.overridesFor = text;
    if (folder && FOLDER[folder]) {
      var old = state.primary;
      state.primary = folder;
      if (old && old !== folder && state.cross.indexOf(old) < 0 && state.cross.length < 2) state.cross.push(old);
      state.cross = state.cross.filter(function (id) { return id !== folder; }).slice(0, 2);
      toast('Moved to <b>' + esc(FOLDER[folder].name) + '</b>' + (info.say ? ' · rewritten ' + esc(info.say) : ''), 3200);
    } else {
      toast('Rewritten' + (info.say ? ' — ' + esc(info.say) : '') + ', and the folders re-scored.', 3200);
    }
    renderPanel(a);
  }

  /* -------------------------------------------------------------- archiving */
  function privateAsked() {
    var sw = $('#labPrivate');
    return !!(sw && sw.checked);
  }
  function buildEntry(a, opt) {
    var titles = a.titles.map(function (t) { return { text: t.text, style: t.style }; });
    var ti = Math.max(0, Math.min(opt.titleIdx || 0, titles.length - 1));
    var P = FOLDER[opt.primary || a.primary.id] || FOLDER[a.primary.id];
    var crossIds = (opt.cross || []).filter(function (id) { return id !== P.id && FOLDER[id]; }).slice(0, 2);
    return {
      id: opt.id || uid(),
      sample: !!opt.sample,
      published: opt.published === undefined ? true : !!opt.published,
      auto: !!opt.auto,
      publishedAt: opt.published === false ? null : new Date().toISOString(),
      deletedAt: null,
      createdAt: opt.when || new Date().toISOString(),
      title: titles[ti].text,
      titleStyle: titles[ti].style,
      altTitles: titles.filter(function (_, i) { return i !== ti; }).map(function (t) { return t.text; }),
      raw: a.raw,
      summary: (opt.summary != null && opt.summary !== '') ? opt.summary : a.logline,
      logline: a.logline,
      highlight: a.highlight,
      emotions: a.emotions.top.map(function (e) { return { id: e.id, label: e.label, pct: e.pct, color: e.color }; }),
      allEmotions: a.emotions.ranked.slice(0, 6).map(function (e) { return { id: e.id, label: e.label, score: e.score }; }),
      physical: a.phys.map(function (p) { return { id: p.id, label: p.label, terms: p.terms }; }),
      mental: a.mind.map(function (m) { return { id: m.id, label: m.label }; }),
      themes: a.themes.map(function (t) { return { id: t.id, label: t.label }; }),
      entities: { place: a.entities.place, time: a.entities.time, people: a.entities.people, props: a.entities.props },
      primary: { id: P.id, name: P.name },
      crossLinks: crossIds.map(function (id) { return { id: id, name: FOLDER[id].name }; }),
      wish: a.wish.detected ? {
        detected: true, amounts: a.wish.amounts || [],
        items: a.wish.items.map(function (it, i) { return { text: it.text, kind: it.kind, checked: !!(opt.wishChecked && opt.wishChecked[i]) }; })
      } : { detected: false, items: [] },
      scene: a.scene,
      phase: a.phase,
      confidence: a.confidence,
      words: a.words,
      energy: a.energy,
      clarity: a.clarity
    };
  }

  function confirmArchive() {
    if (!needKeeper('Reading is open to everyone. Keeping a new moment is Yash’s — sign in and it will be shelved.')) return;
    var text = state.draft.trim();
    if (!text) { toast('Give me something to keep first — a line, a list, anything.', 3000); return; }
    /* what is in the box right now is what gets kept: if the keeper has typed
       on since the panel last read him, read him again before keeping it */
    var a = state.a;
    if (!a || a.raw !== text) {
      a = Engine.analyze(text, { style: state.style, seed: state.seed });
      state.a = a;
      state.lastAnalyzed = text;
    }
    var entry = buildEntry(a, {
      titleIdx: state.titleIdx, summary: state.summary, primary: state.primary,
      cross: state.cross, wishChecked: state.wishChecked,
      published: !privateAsked(), auto: false
    });
    var typed = $('#labTitle') && $('#labTitle').value.trim();
    if (typed) entry.title = typed.slice(0, 200);
    if (state.editing) {
      var was = state.entries.filter(function (x) { return x.id === state.editing; })[0] ||
                state.trash.filter(function (x) { return x.id === state.editing; })[0];
      if (was) entry.published = was.deletedAt ? was.published : entry.published;
    }
    entry.pending = syncState.mode !== 'local';
    var wasEditing = state.editing;
    if (wasEditing) {
      /* the same moment, re-read: same id, same moment in time, new words */
      var at = state.entries.findIndex(function (x) { return x.id === wasEditing; });
      if (at >= 0) {
        entry.id = wasEditing;
        entry.createdAt = state.entries[at].createdAt || state.entries[at].when;
        entry.when = state.entries[at].when || entry.createdAt;
        entry.changedAt = new Date().toISOString();
        state.entries[at] = entry;
      } else {
        state.entries.unshift(entry);
      }
      state.editing = null;
    } else {
      state.entries.unshift(entry);
    }
    paintEditFlag();
    catchUpAfterEdit();
    saveEntries(wasEditing ? 'moment changed' : 'new moment');
    var btn = $('#confirmBtn');
    if (btn) { btn.classList.add('flash'); btn.disabled = true; }
    var dissolved = $('#dissolve');
    dissolved.classList.add('go');
    later(1050, function () { dissolved.classList.remove('go'); });
    var crossTxt = entry.crossLinks.length ? ' · cross-linked to ' + entry.crossLinks.map(function (c) { return esc(c.name); }).join(' &amp; ') : '';
    toast(wasEditing
      ? 'Changed, and the shelf knows. <b>' + esc(entry.title) + '</b> is up to date.'
      : 'Kept in <b>' + esc(entry.primary.name) + '</b>' + crossTxt + ' · ' + entry.words + ' words.', 4200);
    later(700, function () {
      state.draft = ''; saveDraft();
      $('#draft').value = '';
      if ($('#labTitle')) $('#labTitle').value = '';
      if ($('#labPrivate')) $('#labPrivate').checked = false;
      state.autosave = { at: state.autosave.at, busy: false, id: null, text: '', err: null };
      paintSaveLight(true);
      updateCounter(); clearOverrides(); resetPanel(); renderRecent();
      toast('It is safe. Tell me another.', 2400);
    });
  }

  /* ------------------------------------------------------------- lab bits */
  function updateCounter() {
    var w = wordsOf(state.draft);
    $('#counter').textContent = w + ' word' + (w === 1 ? '' : 's') + ' · ' + Math.max(1, Math.round(w / 200)) + ' min read';
  }
  function renderRecent() {
    var row = $('#recentRow'), foot = $('#recentFoot');
    var recent = state.entries.slice(0, 3);
    if (!recent.length) { foot.style.display = 'none'; return; }
    foot.style.display = '';
    row.innerHTML = '<b>Recently kept</b>' + recent.map(function (e) {
      return '<button class="chip-mini" data-open="' + e.id + '">' + esc(e.title) + '</button>';
    }).join('');
    $$('[data-open]', row).forEach(function (b) {
      b.addEventListener('click', function () { openMoment(b.getAttribute('data-open'), null); });
    });
  }

  /* ══════════════════════════ LIBRARY (spines) ══════════════════════════ */
  function filteredEntries() {
    var q = state.query.toLowerCase();
    return state.entries.filter(function (e) {
      if (!q) return true;
      var hay = [e.title, e.raw, e.summary, e.highlight,
        (e.themes || []).map(function (t) { return t.label; }).join(' '),
        (e.wish && e.wish.items || []).map(function (i) { return i.text; }).join(' '),
        (e.entities && e.entities.people || []).join(' '),
        (e.scene && e.scene.label || '')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }
  /* ══════════════════════════════ KEEPING AS YOU GO ═══════════════════════
     A draft is written to the shelf as you type, quietly, so a closed lid or
     a flat battery cannot eat the words. It is private: the server only hands
     a draft to the keeper who wrote it. */
  var KEEP_LOCAL_MS = 1000;            /* the words, into this browser, every second */
  var AUTOSAVE_MS = 6000;              /* a draft, to the backend, while it is written */
  var autosaveTimer = null;
  var keepLocalTimer = null;
  var forked = false;                  /* the backend refused: this browser is the only copy */
  function paintSaveLight(ok, why) {
    var el = $('#saveLight');
    if (!el) return;
    var a = state.autosave;
    el.classList.toggle('is-busy', !!a.busy);
    el.classList.toggle('is-err', ok === false);
    el.classList.toggle('is-live', !!a.at && !a.err && state.autosave.id);
    if (a.busy) { el.textContent = 'keeping this as you write\u2026'; return; }
    if (ok === false) { el.textContent = why || 'not saved yet'; return; }
    if (a.err) { el.textContent = 'kept in this browser only \u2014 ' + a.err; return; }
    if (a.at) { el.textContent = 'draft kept \u00b7 ' + hhmm(new Date(a.at)); return; }
    el.textContent = 'nothing written yet';
  }
  /* the keeper pressed something on this moment: whatever the writing lab had
     queued for it is dropped, and the lab stops thinking of it as its draft */
  function releaseAutosave(id) {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    if (!id || state.autosave.id === id) {
      state.autosave.id = null;
      state.autosave.text = '';
    }
  }

  function autosaveNow(force) {
    if (!auth.isAdmin()) return;
    if (forked && !force) return;                     /* already told: this browser is the copy */
    var text = state.draft.trim();
    if (wordsOf(text) < 3) return;
    if (state.editing) return;                        /* an edit is a deliberate save */
    /* a draft that has been published, or thrown away, belongs to the desk now:
       keeping it as a private draft again would undo the keeper's own press */
    if (state.autosave.id) {
      var kept = state.entries.filter(function (e) { return e.id === state.autosave.id; })[0];
      if (!kept || kept.published !== false) { releaseAutosave(state.autosave.id); return; }
    }
    if (text === state.autosave.text && state.autosave.id) return;
    var a = state.a;
    if (!a || a.raw !== text) return;                 /* let the reading settle first */
    var existing = state.autosave.id
      ? state.entries.filter(function (e) { return e.id === state.autosave.id; })[0]
      : null;
    var entry = buildEntry(a, {
      id: existing ? existing.id : undefined,
      titleIdx: state.titleIdx, summary: state.summary, primary: state.primary,
      cross: state.cross, wishChecked: state.wishChecked,
      published: false, auto: true
    });
    if (existing) { entry.createdAt = existing.createdAt; entry.changedAt = new Date().toISOString(); }
    state.autosave.busy = true; paintSaveLight();
    if (existing) {
      var at = state.entries.findIndex(function (e) { return e.id === entry.id; });
      state.entries[at] = entry;
    } else {
      state.entries.unshift(entry);
    }
    state.autosave.id = entry.id;
    state.autosave.text = text;
    syncUp('draft kept while writing');
    later(400, function () {
      state.autosave.busy = false;
      state.autosave.at = new Date().toISOString();
      state.autosave.err = forked ? 'the backend did not take it' : null;
      paintSaveLight();
      if (state.screen === 'desk') renderDesk();
    });
  }
  function armAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () { autosaveNow(); }, AUTOSAVE_MS);
    armKeepLocal();
  }
  /* keeping the words costs nothing and loses nothing: every second, whatever
     is in the box goes into this browser's own storage, so a reload, a crash or
     a flat battery cannot eat a sentence */
  function armKeepLocal() {
    if (keepLocalTimer) clearTimeout(keepLocalTimer);
    keepLocalTimer = setTimeout(function () {
      if (state.draft !== state.keptText) {
        state.keptText = state.draft;
        saveDraft();
        if (!state.autosave.at) paintSaveLight();
      }
      armKeepLocal();
    }, KEEP_LOCAL_MS);
  }
  function stopKeepingLocal() { if (keepLocalTimer) { clearTimeout(keepLocalTimer); keepLocalTimer = null; } }

  /* ══════════════════════════════ LIBRARY (spines) ═══════════════════════ */

  /* ══════════════════════════════ THE KEEPER'S DESK ═══════════════════════
     One screen for the author: what is a draft, what is out in the world,
     what was thrown away, and how to put any of it back. */
  function deskRow(e, kind) {
    var when = fmtDate(e.createdAt, true);
    var words = e.words || wordsOf(e.raw);
    var actions = '';
    if (kind === 'draft') {
      actions = '<button class="btn tiny" data-publish="' + esc(e.id) + '">publish</button>' +
        '<button class="btn tiny ghost" data-open="' + esc(e.id) + '">read</button>' +
        '<button class="btn tiny ghost" data-trash="' + esc(e.id) + '">throw away</button>';
    } else if (kind === 'published') {
      actions = '<button class="btn tiny ghost" data-open="' + esc(e.id) + '">read</button>' +
        '<button class="btn tiny ghost" data-unpublish="' + esc(e.id) + '">make private</button>' +
        '<button class="btn tiny ghost" data-trash="' + esc(e.id) + '">throw away</button>';
    } else {
      actions = '<button class="btn tiny" data-restore="' + esc(e.id) + '">put it back</button>' +
        '<button class="btn tiny ghost" data-burn="' + esc(e.id) + '">delete for good</button>';
    }
    return '<div class="desk-row' + (kind === 'trash' ? ' is-gone' : '') + '">' +
      '<div class="desk-main"><b>' + esc(e.title) + '</b>' +
      '<span class="desk-meta">' + when + ' \u00b7 ' + words + ' words' +
      (e.auto ? ' \u00b7 <i>kept as you wrote</i>' : '') +
      (kind === 'trash' ? ' \u00b7 thrown away ' + fmtDate(e.deletedAt) : '') + '</span>' +
      '<span class="desk-line">' + esc(String(e.summary || e.logline || '').slice(0, 150)) + '</span></div>' +
      '<div class="desk-actions">' + actions + '</div></div>';
  }
  function renderDesk() {
    var room = $('#deskRoom');
    if (!room) return;
    var drafts = state.entries.filter(function (e) { return e.published === false; });
    var live = state.entries.filter(function (e) { return e.published !== false; });
    var tabs = [['drafts', 'Drafts', drafts.length], ['published', 'On the shelf', live.length], ['trash', 'Thrown away', state.trash.length]];
    $('#deskTabs').innerHTML = tabs.map(function (t) {
      return '<button class="desk-tab' + (state.desk === t[0] ? ' is-on' : '') + '" data-desk="' + t[0] + '">' +
        esc(t[1]) + ' <span>' + t[2] + '</span></button>';
    }).join('');
    var list = state.desk === 'drafts' ? drafts : state.desk === 'published' ? live : state.trash;
    var kind = state.desk === 'drafts' ? 'draft' : state.desk === 'published' ? 'published' : 'trash';
    room.innerHTML = list.length
      ? list.map(function (e) { return deskRow(e, kind); }).join('')
      : '<div class="desk-empty">' + (state.desk === 'trash'
        ? 'Nothing thrown away. A deleted moment waits here, never in the bin.'
        : state.desk === 'drafts'
          ? 'No drafts. Anything you write is kept as a draft while you type, and stays private until you publish it.'
          : 'Nothing published yet. Write in the lab, then press Confirm &amp; Archive.') + '</div>';

    var st = ReelStore.status();
    var snap = ReelStore.snapshots();
    $('#deskFoot').innerHTML =
      '<div class="foot-card"><div class="foot-title">Where it is kept</div>' +
      '<p>' + esc(st.detail || 'this browser') + (st.mode === 'local'
        ? ' \u2014 the words live in this browser only, so use Export before clearing site data.'
        : ' \u2014 every save goes there, and every other open page follows within twenty seconds.') + '</p>' +
      '<p class="foot-note">' + (syncState.mode === 'git' && !ReelStore.status().gitPrivate
        ? 'This repository is treated as public: drafts and the trash stay in this browser until you publish, and only published moments are committed.'
        : 'Drafts and the trash are held back from visitors; only published moments are ever handed out.') + '</p>' +
      '</div>' +
      '<div class="foot-card"><div class="foot-title">Yesterday, kept</div>' +
      (snap.length
        ? '<ul class="snap-list">' + snap.slice(0, 6).map(function (s) {
            return '<li><button class="btn tiny ghost" data-snap="' + esc(s.name) + '">put back</button>' +
              '<span>' + esc(s.name.replace(/^moments-/, '').replace(/\.json$/, '')) + '</span></li>';
          }).join('') + '</ul><p class="foot-note">A snapshot is written before every save. Restoring one is itself reversible.</p>'
        : '<p>A snapshot is written before every save on a server with a disk. On a static host there is nothing to snapshot.</p>') +
      '</div>' +
      '<div class="foot-card"><div class="foot-title">The door</div>' +
      '<p>' + (ReelSession.server()
        ? 'Signed in through the site: the session is a cookie this page cannot read, and it ends by itself.'
        : 'No backend here, so the lock in this browser is what stands in the way. It is a courtesy lock, not a vault.') + '</p>' +
      '<p class="foot-note">' + esc(auth.state().mail || '') + ' is the address a lost key is answered from.</p></div>';

    $$('[data-desk]', $('#deskTabs')).forEach(function (b) {
      b.addEventListener('click', function () { state.desk = b.getAttribute('data-desk'); renderDesk(); });
    });
    $$('[data-open]', room).forEach(function (b) {
      b.addEventListener('click', function () { openMoment(b.getAttribute('data-open'), null); });
    });
    $$('[data-publish]', room).forEach(function (b) {
      b.addEventListener('click', function () { setPublished(b.getAttribute('data-publish'), true); });
    });
    $$('[data-unpublish]', room).forEach(function (b) {
      b.addEventListener('click', function () { setPublished(b.getAttribute('data-unpublish'), false); });
    });
    $$('[data-trash]', room).forEach(function (b) {
      b.addEventListener('click', function () { trashMoment(b.getAttribute('data-trash')); });
    });
    $$('[data-restore]', room).forEach(function (b) {
      b.addEventListener('click', function () { restoreMoment(b.getAttribute('data-restore')); });
    });
    $$('[data-burn]', room).forEach(function (b) {
      b.addEventListener('click', function () { burnMoment(b.getAttribute('data-burn')); });
    });
    $$('[data-snap]', $('#deskFoot')).forEach(function (b) {
      b.addEventListener('click', function () { restoreSnapshot(b.getAttribute('data-snap')); });
    });
  }
  function setPublished(id, want) {
    if (!needKeeper('Publishing is the keeper\u2019s.')) return;
    var e = state.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    releaseAutosave(id);           /* the writing lab must not undo this a breath later */
    e.published = !!want;
    e.publishedAt = want ? new Date().toISOString() : null;
    e.changedAt = new Date().toISOString();
    saveEntries();
    renderDesk();
    if (state.viewing === id) openMoment(id, 'fade');
    toast(want
      ? '<b>' + esc(e.title) + '</b> is on the shelf \u2014 every open page will grow it in a moment.'
      : '<b>' + esc(e.title) + '</b> is private again. Visitors will not see it.', 4200);
  }
  function trashMoment(id) {
    if (!needKeeper('Throwing a moment away is the keeper\u2019s.')) return;
    releaseAutosave(id);
    var found = null;
    state.entries = state.entries.filter(function (e) {
      if (e.id === id) { found = e; return false; }
      return true;
    });
    if (!found) return;
    found.deletedAt = new Date().toISOString();
    state.trash.unshift(found);
    saveEntries();
    if (state.screen === 'desk') renderDesk();
    if (state.viewing === id) { state.viewing = null; closeMoment(); }
    if (state.screen === 'shelf') renderLibrary();
    toast('<b>' + esc(found.title) + '</b> is out of the room, waiting in <b>Thrown away</b>.', 4200);
  }
  function restoreMoment(id) {
    if (!needKeeper('Putting a moment back is the keeper\u2019s.')) return;
    releaseAutosave(id);
    var found = null;
    state.trash = state.trash.filter(function (e) {
      if (e.id === id) { found = e; return false; }
      return true;
    });
    if (!found) return;
    found.deletedAt = null;
    state.entries.unshift(found);
    saveEntries();
    renderDesk();
    toast('<b>' + esc(found.title) + '</b> is back' + (found.published === false ? ' \u2014 still a draft, still private.' : ' on the shelf.'), 4200);
  }
  function burnMoment(id) {
    if (!needKeeper('Deleting for good is the keeper\u2019s.')) return;
    var e = state.trash.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    if (window.confirm('Delete \u201c' + e.title + '\u201d for good? The snapshot written before your last save still holds a copy, but this device will not.')) {
      state.trash = state.trash.filter(function (x) { return x.id !== id; });
      saveEntries();
      renderDesk();
      toast('Gone for good.', 2600);
    }
  }
  function restoreSnapshot(name) {
    if (!needKeeper('Restoring is the keeper\u2019s.')) return;
    if (!window.confirm('Put the shelf back to ' + name + '? What is here now gets snapshotted first, so this is reversible.')) return;
    if (typeof fetch !== 'function') return toast('Restoring needs a running site to ask.', 3600);
    fetch(ReelSession.api('/api/moments/restore'), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Reel': '1' },
      body: JSON.stringify({ name: name })
    }).then(function (r) { return r.json().then(function (b) { return { status: r.status, b: b }; }); })
      .then(function (res) {
        if (res.status !== 200) return toast('That snapshot could not be put back: ' + esc(res.b.detail || res.b.error || 'unknown'), 5000);
        return pullShelf(true).then(function () { renderDesk(); toast('Put back. ' + res.b.count + ' moments.', 3600); });
      })['catch'](function () { toast('The site did not answer, so nothing was restored.', 4200); });
  }
  function openDesk() {
    if (!auth.isAdmin()) return openAdmin('The desk is the keeper\u2019s. Sign in and it opens.');
    go('desk');
    renderDesk();
  }

  /* ══════════════════════════════ LIBRARY (spines) ═══════════════════════ */
  function spineHtml(e, idx) {

    var sc = e.scene || SCENES.paper;
    var h = hash(e.id);
    var fit = (state.fit && state.fit.k) || 1;
    var height = Math.round((150 + (h % 46)) * (0.9 + fit * 0.1));
    var width = Math.round((42 + ((h >> 3) % 15)) * (0.92 + fit * 0.08));
    var rot = (((h >> 6) % 13) - 6) / 10;
    var want = e.wish && e.wish.detected;
    return '<button class="spine" data-id="' + esc(e.id) + '" title="' + esc(e.title) + ' — ' + esc(fmtDate(e.createdAt)) + '"' +
      ' style="--sp-top:' + sc.stops[0] + ';--sp-bot:' + (sc.stops[sc.stops.length - 1]) + ';--sp-ink:' + sc.ink + ';--sp-accent:' + sc.accent +
      ';--sp-h:' + height + 'px;--sp-w:' + width + 'px;--sp-r:' + rot + 'deg;animation-delay:' + Math.min(idx * 22, 420) + 'ms">' +
      '<span class="spine-accent"></span>' +
      (want ? '<span class="spine-wish">✦</span>' : '') +
      '<span class="spine-title">' + esc(e.title) + '</span>' +
      '<span class="spine-foot">' + shortDate(e.createdAt) + '</span></button>';
  }
  function renderLibrary() {
    paintSync();
    paintClock();
    var origin = $('#shelfOrigin');
    if (origin) {
      origin.hidden = !published.count;
      origin.textContent = published.count
        ? '\u00b7 ' + published.count + ' published' + (published.at ? ' \u00b7 ' + shortDate(published.at) : '')
        : '';
    }
    /* tabs */
    var counts = {};
    state.entries.forEach(function (e) {
      if (e.primary) counts[e.primary.id] = (counts[e.primary.id] || 0) + 1;
    });
    var tabs = '<button class="lib-tab' + (state.shelf === 'all' ? ' on' : '') + '" data-shelf="all">All moments · ' + state.entries.length + '</button>';
    FOLDERS.forEach(function (f) {
      if (!counts[f.id]) return;
      tabs += '<button class="lib-tab' + (state.shelf === f.id ? ' on' : '') + '" data-shelf="' + f.id + '">' + esc(f.name) + ' · ' + counts[f.id] + '</button>';
    });
    var tabBox = $('#libTabs');
    tabBox.innerHTML = tabs;
    $$('.lib-tab', tabBox).forEach(function (b) {
      b.addEventListener('click', function () {
        state.shelf = b.getAttribute('data-shelf');
        renderLibrary();
      });
    });

    var list = filteredEntries();
    if (state.query) list = list;
    else if (state.shelf !== 'all') list = list.filter(function (e) { return e.primary && e.primary.id === state.shelf; });

    var room = $('#shelfRoom');
    if (!list.length) {
      room.innerHTML = '<div class="empty-state"><h3>' + (state.query ? 'Nothing on these shelves matches.' : 'This shelf is still empty.') + '</h3>' +
        '<p>' + (state.entries.length ? 'Try another shelf, or clear the search.' : 'Write something in the lab and confirm it — it will stand here as a spine.') + '</p></div>';
      return;
    }

    var groups;
    if (state.query || state.shelf !== 'all') {
      groups = [{ id: state.shelf === 'all' ? 'search' : state.shelf, name: state.shelf === 'all' ? 'Search results' : FOLDER[state.shelf].name, blurb: state.query ? '“' + state.query + '”' : FOLDER[state.shelf].blurb, items: list }];
    } else {
      groups = FOLDERS.map(function (f) {
        return { id: f.id, name: f.name, blurb: f.blurb, items: list.filter(function (e) { return e.primary && e.primary.id === f.id; }) };
      }).filter(function (g) { return g.items.length; });
    }

    var idx = 0;
    room.innerHTML = groups.map(function (g) {
      return '<section class="lib-shelf">' +
        '<div class="spines">' + g.items.map(function (e) { return spineHtml(e, idx++); }).join('') + '</div>' +
        '<div class="shelf-board"></div>' +
        '<div class="shelf-plate"><span><b>' + esc(g.name) + '</b> · ' + g.items.length + ' moment' + (g.items.length === 1 ? '' : 's') + '</span>' +
        '<span class="shelf-blurb">' + esc(g.blurb) + '</span></div>' +
        '</section>';
    }).join('');

    $$('.spine', room).forEach(function (sp) {
      sp.addEventListener('click', function (ev) {
        var rect = sp.getBoundingClientRect();
        openMoment(sp.getAttribute('data-id'), { rect: rect, scene: null });
        ev.stopPropagation();
      });
    });
    var sub = $('#shelfSub');
    if (sub) sub.textContent = 'the moments of ' + OWNER;
  }

  /* ══════════════════════════ MOMENT (opened page) ══════════════════════════ */
  /* every atmosphere stands somewhere: a window, a skyline, a horizon, an arch */
  var SCENE_PLACE = {
    night: 'window', rain: 'window', dawn: 'window', snow: 'window',
    city: 'skyline', sea: 'horizon', temple: 'arch', kitchen: 'counter',
    gold: 'glow', ember: 'glow', heart: 'glow', rose: 'glow', moss: 'glow', paper: 'glow'
  };
  function paintScene(sc) {
    var screen = $('#screenMoment');
    screen.style.setProperty('--sc-grad', sceneGradient(sc));
    screen.style.setProperty('--sc-ink', sc.ink);
    screen.style.setProperty('--sc-accent', sc.accent);
    screen.style.setProperty('--sc-1', sc.stops[0]);
    var shape = $('#sceneShape');
    if (shape) {
      var place = SCENE_PLACE[sc.key] || 'glow';
      shape.className = 'scene-silhouette ss-' + place;
    }
    /* moving straight from one moment to the next: let the room change slowly
       instead of snapping to a new colour */
    var layer = $('#sceneLayer');
    if (layer && screen.classList.contains('is-active') && !state.reduced) {
      layer.style.opacity = '0.3';
      requestAnimationFrame(function () { requestAnimationFrame(function () { layer.style.opacity = ''; }); });
    } else if (layer) {
      layer.style.opacity = '';
    }
  }
  function typeInto(el, text, speed) {
    if (!el) return;
    if (state.reduced) { el.textContent = text; return; }
    el.classList.add('typing');
    var i = 0, step = Math.max(2, Math.round(text.length / 62));
    el.textContent = '';
    var t = setInterval(function () {
      i += step;
      el.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(t); el.classList.remove('typing'); }
    }, speed || 15);
  }
  function momentHtml(e, prev, next) {
    var sc = e.scene || SCENES.paper;
    var titleWords = e.title.split(' ');
    var draftRibbon = (auth.isAdmin() && e.published === false)
      ? '<div class="draft-ribbon">a draft \u2014 nobody but you can read this</div>'
      : (state.previewing ? '<div class="draft-ribbon is-preview">a preview \u2014 not kept yet</div>' : '');
    var titleHtml = titleWords.map(function (w, i) {
      return '<span style="animation-delay:' + (0.05 * i + 0.1) + 's">' + esc(w) + '</span>';
    }).join(' ');
    var emotionTags = (e.emotions || []).map(function (em) {
      return '<span class="tag" style="color:' + emotionColor(em) + ';border-color:rgba(255,255,255,.16)">' + esc(em.label) + ' · ' + em.pct + '%</span>';
    }).join('');
    var stateTags = []
      .concat((e.mental || []).map(function (m) { return 'mind: ' + m.label.toLowerCase(); }))
      .concat((e.physical || []).map(function (p) { return 'body: ' + p.label.toLowerCase(); }))
      .concat((e.themes || []).slice(0, 4).map(function (t) { return t.label.toLowerCase(); }))
      .map(function (t) { return '<span class="tag muted">' + esc(t) + '</span>'; }).join('');
    var wishHtml = '';
    if (e.wish && e.wish.detected && e.wish.items.length) {
      wishHtml = '<div class="paper-block" style="animation-delay:.5s"><div class="paper-line">to acquire</div>' +
        '<div class="paper-wish"><ul>' + e.wish.items.map(function (it) {
          return '<li>' + esc(it.text) + (it.checked ? ' <span style="color:' + sc.accent + '">✓</span>' : '') + '</li>';
        }).join('') + '</ul>' +
        (e.wish.amounts && e.wish.amounts.length ? '<div class="wish-amounts" style="margin-top:10px">budget mentioned: ' + esc(e.wish.amounts.join(' · ')) + '</div>' : '') +
        '</div></div>';
    }
    var people = (e.entities && e.entities.people || []).slice(0, 4);
    return draftRibbon +
      '<div class="moment-top">' +
        '<div>' +
          '<span class="scene-chip"><i></i>' + esc(sc.label) + '</span>' +
          '<div class="scene-line">' + esc(sc.line) + (sc.where ? ' · ' + esc(sc.where) : '') + '</div>' +
          '<div class="moment-meta" style="margin-top:12px">' + fmtDate(e.createdAt, true) + ' · ' + (e.words || wordsOf(e.raw)) + ' words · read at ' + e.confidence + '%</div>' +
        '</div>' +
        '<div class="moment-actions">' +
          '<button class="btn ghost" id="replayBtn">↻ replay</button>' +
          '<button class="btn ghost" id="copyBtn">copy</button>' +
          '<button class="btn ghost" id="editBtn">edit</button>' +
          (auth.isAdmin() ? (e.published === false
            ? '<button class="btn ghost" id="publishBtn">publish</button>'
            : '<button class="btn ghost" id="unpublishBtn">make private</button>') : '') +
          '<button class="btn ghost" id="deleteBtn">' + (auth.isAdmin() ? 'throw away' : 'delete') + '</button>' +
        '</div>' +
      '</div>' +
      '<h2 class="paper-title">' + titleHtml + '</h2>' +
      '<div class="paper-rule"></div>' +
      '<p class="paper-logline paper-block" style="animation-delay:.30s"><span class="type" id="loglineType"></span></p>' +
      '<div class="paper-block" style="animation-delay:.44s"><div class="paper-line">on the shelf</div>' +
        '<div class="paper-tags"><span class="tag" style="border-color:' + sc.accent + ';color:' + sc.accent + '">' + esc(e.primary ? e.primary.name : '—') + '</span>' +
        (e.crossLinks || []).map(function (c) { return '<span class="tag muted">' + esc(c.name) + '</span>'; }).join('') +
        '<span class="tag muted">' + esc(e.phase ? e.phase.label : '') + '</span></div></div>' +
      '<div class="paper-block" style="animation-delay:.5s"><div class="paper-line">what it held</div>' +
        '<div class="paper-tags">' + (emotionTags || '<span class="tag muted">quiet</span>') + stateTags +
        (people.length ? '<span class="tag muted">' + esc(people.join(', ')) + '</span>' : '') + '</div></div>' +
      wishHtml +
      (e.highlight && !(e.wish && e.wish.detected) ? '<div class="paper-block" style="animation-delay:.58s"><div class="paper-line">the line to remember</div><div class="paper-highlight">“' + esc(e.highlight) + '”</div></div>' : '') +
      (e.altTitles && e.altTitles.length ? '<div class="paper-block" style="animation-delay:.64s"><div class="paper-line">other titles it could have worn</div><div class="paper-tags">' +
        e.altTitles.map(function (t) { return '<span class="tag muted">' + esc(t) + '</span>'; }).join('') + '</div></div>' : '') +
      '<div class="paper-block" style="animation-delay:.7s"><div class="paper-line">raw, exactly as he wrote it</div>' +
        '<div class="paper-body">' + esc(e.raw) + '</div></div>' +
      '<div class="moment-foot">' +
        (prev ? '<button class="btn ghost" id="prevBtn">← earlier · ' + esc(prev.title) + '</button>' : '<span></span>') +
        (next ? '<button class="btn ghost" id="nextBtn">' + esc(next.title) + ' · later →</button>' : '<span></span>') +
      '</div>';
  }

  function openMoment(id, from, preview) {
    var e = preview || state.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var order = preview ? [] : state.entries.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var i = preview ? -1 : order.findIndex(function (x) { return x.id === id; });
    var prev = i >= 0 ? order[i - 1] : null, next = i >= 0 ? order[i + 1] : null;
    state.previewing = !!preview;
    state.viewing = preview ? null : id;
    state.returnTo = state.screen === 'lab' ? 'lab' : 'shelf';

    var sc = e.scene || SCENES.paper;
    paintScene(sc);
    $('#momentInner').innerHTML = momentHtml(e, prev, next);
    var scroll = $('#momentScroll');
    if (scroll) scroll.scrollTop = 0;

    var rect = onScreenRect(from && from.rect);
    if (!state.reduced && rect) {
      playBookOpen(e, sc, rect);
    } else {
      go('moment');
      later(120, function () { typeInto($('#loglineType'), e.summary || e.logline, 14); });
      weather.start(sc.particles, sc.accent);
    }
    wireMoment(e, prev, next);

    var backLabel = $('#backLabel');
    if (backLabel) backLabel.textContent = 'the shelves';
  }

  function wireMoment(e, prev, next) {
    var inner = $('#momentInner');
    var paint = function () { /* scene already painted */ };
    $$('.ephemeral', inner).forEach(function () { });
    if ($('#prevBtn')) $('#prevBtn').addEventListener('click', function () { openMoment(prev.id, null); });
    if ($('#nextBtn')) $('#nextBtn').addEventListener('click', function () { openMoment(next.id, null); });
    if ($('#replayBtn')) $('#replayBtn').addEventListener('click', function () { openMoment(e.id, null); });
    if ($('#copyBtn')) $('#copyBtn').addEventListener('click', function () {
      var txt = e.title + '\n' + fmtDate(e.createdAt, true) + '\n\n' + (e.summary || '') + '\n\n' + e.raw +
        '\n\n— ' + OWNER + ' · ' + (e.primary ? e.primary.name : '') +
        ((e.crossLinks || []).length ? ' (+ ' + e.crossLinks.map(function (c) { return c.name; }).join(', ') + ')' : '');
      copyText(txt).then(function () { toast('Copied — it will paste anywhere.', 2400); });
    });
    var previewing = state.previewing;
    if (previewing) {
      $$('.moment-actions .btn', inner).forEach(function (b) {
        if (b.id !== 'replayBtn' && b.id !== 'copyBtn') b.hidden = true;
      });
      return;
    }
    if ($('#editBtn')) $('#editBtn').addEventListener('click', function () { startEdit(e.id); });
    if ($('#publishBtn')) $('#publishBtn').addEventListener('click', function () { setPublished(e.id, true); });
    if ($('#unpublishBtn')) $('#unpublishBtn').addEventListener('click', function () { setPublished(e.id, false); });
    if ($('#deleteBtn')) $('#deleteBtn').addEventListener('click', function () {
      if (!needKeeper('Only the keeper may remove a moment from the shelf.')) return;
      /* a moment is thrown away, not destroyed: it waits in the desk and can
         be put back. Deleting it for good is a second, deliberate press. */
      if (!window.confirm('Throw this moment away? It waits in the keeper\u2019s desk, and can be put back.')) return;
      trashMoment(e.id);
      later(220, renderLibrary);
    });
  }

  function closeMoment() {
    state.previewing = false;
    var target = state.returnTo || 'shelf';
    go(target);
  }

  /* the flight starts from the spine — but never from off the edge of the
     screen, which used to grow a book out of the viewport frame */
  function onScreenRect(r) {
    if (!r || !r.width || !r.height) return null;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (r.bottom < 24 || r.top > vh - 24) return null;      /* scrolled away: just crossfade */
    var top = Math.min(Math.max(r.top, 14), vh - 60);
    var left = Math.min(Math.max(r.left, 12), Math.max(12, vw - r.width - 12));
    return { left: left, top: top, width: r.width, height: Math.min(r.height, vh - top - 14) };
  }

  /* book-opening animation: the spine slides out, grows into a book, and opens */
  function playBookOpen(e, sc, rect) {
    clearBO();
    var overlay = $('#bookOpen');
    var book = $('#boBook');
    var front = $('#boFront');
    var inside = $('#boInside');
    var title = $('#boTitle');

    var targetW = Math.min(360, Math.max(240, window.innerWidth * 0.42));
    var targetH = targetW * 1.42;
    var cx = (window.innerWidth - targetW) / 2;
    var cy = (window.innerHeight - targetH) / 2;

    overlay.classList.remove('flip');
    overlay.style.setProperty('--bo-top', sc.stops[0]);
    overlay.style.setProperty('--bo-bot', sc.stops[sc.stops.length - 1]);
    overlay.style.setProperty('--bo-ink', sc.ink);
    overlay.style.setProperty('--bo-grad', sceneGradient(sc));
    inside.style.background = sceneGradient(sc);
    title.textContent = e.title;
    var sub = $('#boSub');
    if (sub) sub.textContent = sc.label + ' · ' + fmtDate(e.createdAt);
    book.style.transition = 'none';
    book.style.width = rect.width + 'px';
    book.style.height = rect.height + 'px';
    book.style.setProperty('--bo-x', rect.left + 'px');
    book.style.setProperty('--bo-y', rect.top + 'px');
    overlay.classList.add('play');
    // force a frame so the start state is committed before the flight
    void book.offsetWidth;

    book.style.transition = '';
    book.style.width = targetW + 'px';
    book.style.height = targetH + 'px';
    book.style.setProperty('--bo-x', cx + 'px');
    book.style.setProperty('--bo-y', cy + 'px');

    // the page opens beneath it
    laterBO(280, function () {
      go('moment');
      weather.start(sc.particles, sc.accent);
      laterBO(90, function () { typeInto($('#loglineType'), e.summary || e.logline, 14); });
    });
    laterBO(300, function () {
      overlay.classList.add('flip');
      var spill = document.createElement('div');
      spill.className = 'spill go';
      spill.style.setProperty('--sp-color', rgba(sc.accent, 0.42));
      document.body.appendChild(spill);
      laterBO(1100, function () { spill.remove(); });
    });

    /* the cover dissolves into the room once it has actually turned — never on
       a guessed timer, so a slow frame can't swallow the ending */
    var settled = false;
    function dissolve() {
      if (settled) return;
      settled = true;
      front.removeEventListener('transitionend', onTurn);
      /* a short beat with the opened book in view, then it melts into the page */
      laterBO(140, function () { overlay.classList.add('done'); });
      laterBO(1400, function () { overlay.classList.remove('play', 'flip', 'done'); });
    }
    function onTurn(ev) { if (ev.target === front && ev.propertyName === 'transform') dissolve(); }
    front.addEventListener('transitionend', onTurn);
    laterBO(2600, dissolve);
  }

  /* ------------------------------------------------------------ clipboard */
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).catch(function () { fallbackCopy(t); });
    fallbackCopy(t); return Promise.resolve();
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      later(1200, function () { URL.revokeObjectURL(url); });
      toast('Exported <b>' + esc(name) + '</b>', 2600);
    } catch (e) {
      copyText(text).then(function () { toast('Download blocked here — the archive is on your clipboard instead.', 4200); });
    }
  }

  /* --------------------------------------------------------------- credits */
  function buildCredits() {
    var n = state.entries.length;
    var words = state.entries.reduce(function (a, e) { return a + (e.words || 0); }, 0);
    var used = {};
    state.entries.forEach(function (e) { if (e.primary) used[e.primary.id] = (used[e.primary.id] || 0) + 1; });
    var shelfLines = FOLDERS.filter(function (f) { return used[f.id]; })
      .map(function (f) { return '<p class="credit"><small>shelf</small><b>' + esc(f.name) + '</b>' + used[f.id] + ' moment' + (used[f.id] === 1 ? '' : 's') + '</p>'; })
      .join('');
    var tally = {};
    state.entries.forEach(function (e) { (e.emotions || []).forEach(function (em) { tally[em.id] = (tally[em.id] || 0) + 1; }); });
    var topEmotions = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, 6);
    var dots = topEmotions.map(function (id) {
      return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 4px;background:var(--e-' + id + ', #8d8377)"></span>';
    }).join('');
    var feelings = topEmotions.length
      ? '<p class="credit"><small>the feelings kept here</small><b>' + topEmotions.map(function (id) {
        return id.charAt(0).toUpperCase() + id.slice(1);
      }).join(' · ') + '</b><span style="letter-spacing:.2em">' + dots + '</span></p>'
      : '';
    var sceneTally = {};
    state.entries.forEach(function (e) { if (e.scene) sceneTally[e.scene.label] = (sceneTally[e.scene.label] || 0) + 1; });
    var scenes = Object.keys(sceneTally).sort(function (a, b) { return sceneTally[b] - sceneTally[a]; }).slice(0, 3);
    var sceneLine = scenes.length
      ? '<p class="credit"><small>the atmospheres he lived in</small><b>' + scenes.map(function (s) {
        return s + ' (' + sceneTally[s] + ')';
      }).join(' · ') + '</b></p>' : '';
    var first = state.entries[state.entries.length - 1], last = state.entries[0];
    var wishCount = state.entries.filter(function (e) { return e.wish && e.wish.detected; }).length;
    return '<h2>Reel</h2>' +
      '<p class="credit"><small>you have been visiting the life of</small><b>' + OWNER + '</b> handle it gently</p>' +
      '<p class="credit"><small>kept here</small><b>' + n + ' moment' + (n === 1 ? '' : 's') + ' · ' + words.toLocaleString() + ' words</b>' +
      (first && last ? fmtDate(first.createdAt) + ' — ' + fmtDate(last.createdAt) : 'the page is still blank') + '</p>' +
      '<p class="credit"><small>wishes written down</small><b>' + wishCount + ' tangible list' + (wishCount === 1 ? '' : 's') + '</b> dreams with prices on them</p>' +
      sceneLine +
      (shelfLines || '') + feelings +
      '<p class="credit"><small>the last word</small><b>Nothing here is judged.</b> Only kept, so it can be found again.</p>' +
      '<p class="credit" style="margin-top:46px"><small>· fin ·</small></p>';
  }
  var exitHeld = false;
  function openExit() {
    $('#creditRoll').innerHTML = buildCredits();
    var roll = $('#creditRoll');
    roll.style.animation = 'none';
    void roll.offsetWidth;
    roll.style.animation = '';
    $('#exit').classList.remove('held');
    exitHeld = false;
    $('#exit').classList.add('open');
  }
  function holdExit() {           /* the reader takes over from the projector */
    if (exitHeld) return;
    exitHeld = true;
    $('#exit').classList.add('held');
  }
  function closeExit() { $('#exit').classList.remove('open', 'held'); exitHeld = false; }

  /* ══════════════════════════════ WIRING ══════════════════════════════ */
  function init() {
    loadAll();
    loadPublished();
    ReelStore.on(function (st) {
      syncState.mode = st.mode; syncState.detail = st.detail; syncState.busy = st.busy; paintSync();
    });
    ReelStore.init().then(function (st) {
      paintSync();
      if (st.mode === 'local') { startWatching(); return; }
      pullShelf(false).then(function () {
        lastFinger = null;
        checkShelf(false);
        startWatching();
      });
    });
    if (chan) chan.addEventListener('message', function (ev) {
      if (ev && ev.data && ev.data.t === 'shelf') checkShelf(false);
    });
    /* another tab in this browser, writing to the same shelf */
    window.addEventListener('storage', function (ev) {
      if (ev && ev.key === KEY_E) checkShelf(false);
    });

    applyFit();
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('orientationchange', onViewportChange, { passive: true });
    if (window.matchMedia) {
      var mq = window.matchMedia('(orientation: portrait)');
      if (mq.addEventListener) mq.addEventListener('change', onViewportChange);
      else if (mq.addListener) mq.addListener(onViewportChange);
    }
    $('#rotateDismiss') && $('#rotateDismiss').addEventListener('click', dismissRotate);

    /* the keeper's sheet */
    auth.ready();
    /* who does the site itself say is here? the answer outranks a flag left in
       this browser, so a forged flag gets shown the door on the next line */
    ReelSession.status().then(function (st) {
      if (st.server && st.role === 'keeper') auth.adopt('server');
      /* with a server answering, its answer is the only one that counts: a flag
         left in this browser unlocks nothing, not even a screen */
      else if (st.server) auth.lock();
      paintKeeper();
      paintSync();
      if (st.server && st.configured) toast('The site has its own door now: signing in happens on the server, and drafts stay private.', 4600);
    });
    auth.onChange(function () { paintKeeper(); });
    paintKeeper();
    var kb = document.querySelectorAll('.js-keeper');
    Array.prototype.forEach.call(kb, function (btn) {
      btn.addEventListener('click', function () {
        if (auth.isAdmin()) return openDesk();
        openAdmin(null);
      });
    });
    $('#adminClose') && $('#adminClose').addEventListener('click', closeAdmin);
    $('#adminSheet') && $('#adminSheet').addEventListener('click', function (ev) {
      if (ev.target === $('#adminSheet')) closeAdmin();
    });
    $('#modePass') && $('#modePass').addEventListener('click', function () { setMode('pass'); });
    $('#modePin') && $('#modePin').addEventListener('click', function () { setMode('pin'); });
    $('#adminGo') && $('#adminGo').addEventListener('click', tryUnlock);
    $('#adminCodeGo') && $('#adminCodeGo').addEventListener('click', tryCode);
    $('#adminCode') && $('#adminCode').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') tryCode(); });
    $('#adminMfaBack') && $('#adminMfaBack').addEventListener('click', function () { hideMfa(); $('#adminLocked').hidden = false; });
    $('#adminDesk') && $('#adminDesk').addEventListener('click', function () { closeAdmin(); openDesk(); });
    $('#adminHome') && $('#adminHome').addEventListener('click', function () { closeAdmin(); openDesk(); });
    $('#adminSecret') && $('#adminSecret').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') tryUnlock(); });
    $('#adminId') && $('#adminId').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') $('#adminSecret').focus(); });
    $('#adminForgot') && $('#adminForgot').addEventListener('click', startReset);
    $('#adminOut') && $('#adminOut').addEventListener('click', signOut);
    $('#adminEdit') && $('#adminEdit').addEventListener('click', function () { openChange('id'); });
    $('#adminEditPin') && $('#adminEditPin').addEventListener('click', function () { openChange('pin'); });
    $('#adminStore') && $('#adminStore').addEventListener('click', openStorePanel);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && $('#adminSheet') && $('#adminSheet').classList.contains('show')) closeAdmin();
    });

    /* cover */
    var stats = coverStats();
    $('#insideStats').textContent = stats.html;
    $('#coverStats') && ($('#coverStats').textContent = stats.html);
    $('#doorShelfText').textContent = stats.n + ' moments are standing on the shelves. Open a spine and the room it happened in comes back.';
    $('#bookFront').addEventListener('click', openCover);
    $('#openCover').addEventListener('click', openCover);
    $('#book').addEventListener('click', function (ev) { if (ev.target.id === 'book') openCover(); });
    if (store.getItem(KEY_OPENED)) later(500, function () { $('#openCover').querySelector('span').textContent = 'open the diary again'; }, 0);

    /* foyer */
    $$('.door').forEach(function (d) {
      d.addEventListener('click', function () {
        var dest = d.getAttribute('data-dest');
        if (dest === 'lab') go('lab', { focus: '#draft' });
        else go('shelf');
      });
    });

    /* back */
    $('#backBtn').addEventListener('click', back);

    /* lab */
    var draft = $('#draft');
    draft.value = state.draft;
    updateCounter();
    renderRecent();
    startClock();
    paintEditFlag();
    $('#ghostFolders').innerHTML = FOLDERS.map(function (f) { return '<span class="ghost-pill">' + esc(f.name) + '</span>'; }).join('');
    draft.addEventListener('input', function () {
      state.draft = draft.value; saveDraft(); updateCounter(); armAutosave();
      if ($('#saveLight') && !state.autosave.id) paintSaveLight();
      setLamp(state.reading ? 'reading you…' : 'listening…', true);
      queueAnalyze(820);
    });
    draft.addEventListener('blur', function () { if (wordsOf(state.draft) >= 1) queueAnalyze(0); });
    $('#readNow').addEventListener('click', function () {
      if (wordsOf(state.draft) < 1) { toast('A line first — even one honest line.', 2400); return; }
      runAnalyze(true);
    });
    $('#clearDraft').addEventListener('click', function () {
      state.draft = ''; draft.value = ''; saveDraft(); updateCounter(); resetPanel();
      toast('Cleared. Nothing was kept.', 2200);
    });

    /* library */
    $('#search').addEventListener('input', function () { state.query = $('#search').value; renderLibrary(); });
    $('#exportAll').addEventListener('click', function () {
      download('yash-patel-reel-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({
        app: 'Reel', owner: OWNER, exportedAt: new Date().toISOString(),
        shelves: FOLDERS, atmospheres: SCENES, entries: state.entries
      }, null, 2));
    });

    /* theme (two buttons, same job) */
    function toggleTheme() {
      var next = document.documentElement.getAttribute('data-theme') === 'paper' ? 'reel' : 'paper';
      document.documentElement.setAttribute('data-theme', next);
      try { store.setItem(KEY_T, next); } catch (e) {}
      toast(next === 'paper' ? 'Daylight — ink on paper.' : 'Night — the reel is rolling.', 2000);
    }
    $('#themeToggle').addEventListener('click', toggleTheme);
    $('#themeToggle2').addEventListener('click', toggleTheme);

    /* exit */
    $('#navExit').addEventListener('click', openExit);
    $('#stayBtn').addEventListener('click', closeExit);
    $('#exitClose').addEventListener('click', closeExit);
    $('#closeReelBtn').addEventListener('click', function () {
      closeExit();
      var diss = $('#dissolve');
      diss.style.background = '#060505';
      diss.classList.add('go');
      later(340, function () { $('#screenLab').style.opacity = '0'; $('#screenShelf').style.opacity = '0'; $('#screenFoyer').style.opacity = '0'; });
      later(1100, function () {
        diss.classList.remove('go');
        diss.style.background = '';
        var bye = document.createElement('div');
        bye.className = 'close-note';
        bye.innerHTML = '<div><div class="close-eyebrow">the diary is closed</div>' +
          '<div class="close-line">Yash\'s words are safe here.</div>' +
          '<button class="btn" id="reopen">Open it again</button></div>';
        document.body.appendChild(bye);
        $('#reopen').addEventListener('click', function () {
          bye.remove();
          ['#screenLab', '#screenShelf', '#screenFoyer'].forEach(function (s) { $(s).style.opacity = ''; });
          go('foyer');
        });
      });
    });

    /* keyboard */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { back(); return; }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); if (state.a && state.screen === 'lab') confirmArchive(); }
      if (ev.key === 'Enter' && state.screen === 'cover') openCover();
    });

    /* boot */
    renderLibrary();
    if (wordsOf(state.draft) >= 3) queueAnalyze(200);
    window.__reel = {
      state: state, go: go, back: back, analyze: runAnalyze,
      applyFit: applyFit, dismissRotate: dismissRotate, computeFit: computeFit,
      auth: auth, openAdmin: openAdmin, closeAdmin: closeAdmin, needKeeper: needKeeper,
      loadPublished: loadPublished, startEdit: startEdit, paintClock: paintClock, hhmm: hhmm,
      watchEvery: watchEvery, checkShelf: checkShelf, fingerprint: fingerprint, cancelEdit: cancelEdit, store: ReelStore, pullShelf: pullShelf, syncUp: syncUp, sync: function () { return syncState; },
      openMoment: openMoment, openCover: openCover, renderLibrary: renderLibrary,
      session: ReelSession, openDesk: openDesk, renderDesk: renderDesk,
      setPublished: setPublished, trashMoment: trashMoment, restoreMoment: restoreMoment, autosaveNow: autosaveNow,
      stats: coverStats
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
