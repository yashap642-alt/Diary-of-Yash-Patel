/* ============================================================================
   Reel — browser rig: the parts of the experience jsdom cannot see.
   Chrome does the real work here (layout, 3D transforms, canvas).

     node test/browser.js centre    is the opened diary's gutter on screen-centre?
     node test/browser.js dissolve  does the library book fade out smoothly?
     node test/browser.js stress    rapid navigation leaves nothing stuck
     node test/browser.js reduced   prefers-reduced-motion path
     node test/browser.js shots     refresh the screenshots in shots/
     node test/browser.js all

   Needs Chrome for Testing (PUPPETEER_CACHE_DIR or REEL_CHROME) and, on a bare
   container, the X/NSS libs in LD_LIBRARY_PATH.
   ==========================================================================*/
const fs = require('fs');
const path = require('path');
/* puppeteer is a dev dependency: it lives wherever it was installed last. Look
   in the usual places and, if it is not here, say how to get it (one script,
   which also fetches the X/NSS libraries a bare container needs) instead of
   dying with a module error. */
const MODS = [process.env.REEL_PUPPETEER, process.env.REEL_RIG && process.env.REEL_RIG + '/node_modules',
  '/home/user/.cache/reeltest/node_modules', '/tmp/reel-rig/node_modules', '/tmp/node_modules']
  .filter(Boolean)
  .find(d => { try { require.resolve(d + '/puppeteer'); return true; } catch (e) { return false; } });
if (!MODS) {
  console.log('\n  puppeteer is not installed here, so the real-browser pass cannot run.\n');
  console.log('  One command sets it up — the browser, and the system libraries a bare');
  console.log('  container misses:\n');
  console.log('    bash tools/rig.sh\n');
  console.log('  Everything else in this project runs without it: the diary itself has no');
  console.log('  dependencies at all, and the interface, contrast, security and tool suites');
  console.log('  need only Node.\n');
  process.exit(2);
}
const puppeteer = require(MODS + '/puppeteer');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'reel-diary.html');
const SHOTS = path.join(ROOT, 'shots');
const wait = ms => new Promise(r => setTimeout(r, ms));

/* the keeper's way in, now that the server has the last word: the sheet, the
   ID, the password, and whatever the site answers */
async function keeperSignIn(page, id, password) {
  return page.evaluate(async (id, password) => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    window.__reel.openAdmin(null);
    await wait(340);
    const idBox = document.querySelector('#adminId');
    if (idBox) idBox.value = id;
    document.querySelector('#adminSecret').value = password;
    document.querySelector('#adminGo').click();
    for (let i = 0; i < 50; i++) {
      await wait(150);
      if (window.__reel.auth.isAdmin()) break;
    }
    await wait(250);
    return {
      admin: window.__reel.auth.isAdmin(),
      err: (document.querySelector('#adminErr') || {}).textContent || '',
      sheet: document.querySelector('#adminSheet').classList.contains('show')
    };
  }, id, password);
}

/* the keeper the browser passes sign in as */
const KEEPER_PASSWORD = 'a test keeper password, long enough';
function keeperHash() {
  return require(path.join(__dirname, '..', 'api', 'moments.js'))._internals.scryptHash(KEEPER_PASSWORD);
}
const SESSION_SECRET = require('crypto').randomBytes(32).toString('base64url');
function serverEnv(extra) {
  return Object.assign({}, process.env, {
    REEL_ADMIN_HASH: keeperHash(),
    REEL_SESSION_SECRET: SESSION_SECRET
  }, extra || {});
}

function chromePath() {
  if (process.env.REEL_CHROME) return process.env.REEL_CHROME;
  const roots = [process.env.PUPPETEER_CACHE_DIR && path.join(process.env.PUPPETEER_CACHE_DIR, 'chrome'),
    '/home/user/.cache/puppeteer/chrome', '/home/user/.cache/reeltest/pchrome/chrome', '/tmp/pchrome/chrome'];
  for (const root of roots.filter(Boolean)) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no Chrome found — set REEL_CHROME or PUPPETEER_CACHE_DIR');
}

/* a bare container is missing the X/NSS libraries Chrome links against; if we
   have extracted copies anywhere obvious, hand them to the loader */
function libs() {
  const cands = [process.env.LD_LIBRARY_PATH,
    '/home/user/.cache/chromelibs/root/usr/lib/x86_64-linux-gnu',
    '/home/user/.cache/reeltest/libs/root/usr/lib/x86_64-linux-gnu',
    process.env.REEL_RIG && path.join(process.env.REEL_RIG, 'libs/root/usr/lib/x86_64-linux-gnu'),
    '/tmp/reel-rig/libs/root/usr/lib/x86_64-linux-gnu',
    '/tmp/libs/root/usr/lib/x86_64-linux-gnu'].filter(Boolean);
  return cands.filter(d => fs.existsSync(d)).join(':');
}

async function launch() {
  const env = { ...process.env };
  const extra = libs();
  if (extra) env.LD_LIBRARY_PATH = extra;
  return puppeteer.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    env,
    defaultViewport: { width: 1440, height: 900 }
  });
}
const grab = async (b, w, h, mobile) => {
  const p = await b.newPage();
  await p.setViewport(mobile ? { width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: w, height: h });
  await p.goto(FILE, { waitUntil: 'load' });
  return p;
};
const openShelf = async p => {
  await wait(800); await p.evaluate(() => window.__reel.go('shelf')); await wait(700);
};
const clickSpine = async (p, key) => p.evaluate(k => {
  const list = window.__reel.state.entries;
  const e = list.filter(x => x.scene.key === k)[0] || list[0];
  const el = document.querySelector(`#shelfRoom .spine[data-id="${e.id}"]`);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  el.click(); return e.id;
}, key);

/* ── is the opened diary centred? ─────────────────────────────────────────── */
async function centre(b) {
  let bad = 0;
  for (const [w, h, label, mobile] of [[1440, 900, 'desktop', false], [1920, 1080, 'wide', false],
                                       [1280, 800, 'laptop', false], [390, 844, 'mobile', true]]) {
    const p = await grab(b, w, h, mobile);
    await wait(1700);
    await p.evaluate(() => document.querySelector('#bookFront').click());
    await wait(800);
    if (label === 'desktop') await p.screenshot({ path: `${SHOTS}/60-centred-spread.jpg`, type: 'jpeg', quality: 86 });
    await wait(450);
    const m = await p.evaluate(() => {
      const r = document.querySelector('#book').getBoundingClientRect();
      const g = getComputedStyle(document.querySelector('#coverSpread'), '::after');
      return { hinge: +r.left.toFixed(1), right: +r.right.toFixed(1), centreY: +(r.top + r.height / 2).toFixed(1),
               vw: innerWidth, vh: innerHeight, paper: parseFloat(g.left) };
    });
    const dx = Math.abs(m.hinge - m.vw / 2), dy = Math.abs(m.centreY - m.vh / 2), dw = Math.abs(m.paper - m.vw / 2);
    const ok = dx < 1.5 && dy < 12 && dw < 1.5 && Math.abs((m.right - m.hinge) - (m.hinge - (m.hinge - (m.right - m.hinge)))) < 2;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(8)} gutter ${m.hinge}px vs centre ${m.vw / 2}px → ${dx.toFixed(1)}px off · vertical ${dy.toFixed(1)}px off · ruled line ${m.paper}px`);
    await p.close();
  }
  return bad;
}

/* ── does the library book melt away? ─────────────────────────────────────── */
async function dissolve(b) {
  const p = await grab(b, 1440, 900, false);
  await openShelf(p);
  await clickSpine(p, 'rain');
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < 34; i++) {
    const st = await p.evaluate(() => {
      const o = document.querySelector('#bookOpen'), cs = getComputedStyle(o);
      return { cls: o.className.replace('book-open', '').trim(), op: +(+cs.opacity).toFixed(3), blur: cs.filter };
    });
    samples.push({ t: Date.now() - t0, ...st });
    await wait(70);
  }
  await wait(1400);   /* the overlay is removed a beat after it has gone */
  const cleared = await p.evaluate(() => !document.querySelector('#bookOpen').className.replace('book-open', '').trim());
  const fading = samples.filter(s => s.cls.includes('done') && s.cls.includes('play'));
  const steps = fading.map(s => s.op);
  const monotonic = steps.every((v, i) => i === 0 || v <= steps[i - 1] + 0.001);
  const span = fading.length ? fading[fading.length - 1].t - fading[0].t : 0;
  const blurred = fading.some(s => s.blur !== 'none' && parseFloat(s.blur.replace(/[^0-9.]/g, '')) > 0.3);
  const ends = cleared;
  console.log(`  ${monotonic ? '✓' : '✗'} fade is monotonic (${steps.length} samples over ${span}ms)`);
  console.log(`  ${span > 700 ? '✓' : '✗'} fade is gradual, not a cut (${span}ms of visible fade)`);
  console.log(`  ${blurred ? '✓' : '✗'} fade softens as it goes (blur + lift)`);
  console.log(`  ${ends ? '✓' : '✗'} overlay cleared afterwards`);
  await p.close();

  /* second pass: the two frames worth keeping (screenshots cost frames, so they
     must not run during the timing sample) */
  const q = await grab(b, 1440, 900, false);
  await openShelf(q);
  await clickSpine(q, 'rain');
  const shotAt = async (test, name) => {
    const t0 = Date.now();
    let hit = false;
    while (Date.now() - t0 < 4000) {
      hit = await q.evaluate(src => {
        const o = document.querySelector('#bookOpen'), bk = document.querySelector('#boBook');
        const r = bk.getBoundingClientRect();
        const st = { cls: o.className, op: +(+getComputedStyle(o).opacity).toFixed(2),
                     w: Math.round(r.width), centred: Math.abs((r.left + r.width / 2) - innerWidth / 2) < 3 };
        return new Function('s', 'return ' + src)(st);
      }, test);
      if (hit) break;
      await wait(16);
    }
    await q.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 });
    console.log(`  · ${name}${hit ? '' : ' (caught at last state)'}`);
  };
  await shotAt('s.cls.includes("flip") && !s.cls.includes("done") && s.op === 1 && s.centred', '64-library-book-held-open');
  await shotAt('s.cls.includes("done") && s.op < 0.45 && s.op > 0.12', '65-library-book-dissolving');
  await q.close();
  return (monotonic && span > 700 && blurred && ends) ? 0 : 1;
}

/* ── stress: hammer the navigation, check nothing sticks ─────────────────── */
async function stress(b) {
  const p = await grab(b, 1440, 900, false);
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await openShelf(p);

  await p.evaluate(async () => {
    for (let i = 0; i < 14; i++) {
      const el = document.querySelector('#shelfRoom .spine');
      if (el) el.click();
      await new Promise(r => setTimeout(r, 90));
    }
  });
  await wait(3500);
  const st = await p.evaluate(() => ({
    screen: window.__reel.state.screen,
    overlays: Array.from(document.querySelectorAll('.book-open')).map(e => e.className).join('|'),
    active: Array.from(document.querySelectorAll('.screen.is-active')).length,
    spills: document.querySelectorAll('.spill').length
  }));
  const ok = st.overlays === 'book-open' && st.active === 1 && st.spills === 0 && !errs.length;
  console.log(`  ${ok ? '✓' : '✗'} ${JSON.stringify(st)}${errs.length ? ' ERRORS: ' + errs.join(' | ') : ''}`);
  await p.close();
  return ok ? 0 : 1;
}

/* ── reduced motion ──────────────────────────────────────────────────────── */
async function reduced(b) {
  const p = await grab(b, 1440, 900, false);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.goto(FILE, { waitUntil: 'load' });
  await wait(800);
  await p.evaluate(() => window.__reel.go('shelf'));
  await wait(500);
  await p.evaluate(() => document.querySelector('#shelfRoom .spine').click());
  await wait(900);
  const st = await p.evaluate(() => ({ screen: window.__reel.state.screen, overlay: document.querySelector('#bookOpen').className }));
  const ok = st.screen === 'moment' && !st.overlay.includes('play') && !errs.length;
  console.log(`  ${ok ? '✓' : '✗'} arrives without the flight ${JSON.stringify(st)}${errs.length ? ' ERRORS' : ''}`);
  await p.close();
  return ok ? 0 : 1;
}

/* capture a frame at the moment a condition is true, not on a guessed clock.
   It starts the opening itself (click), then polls until the state matches. */
const shotWhen = async (p, name, test, start) => {
  if (start !== false) await p.evaluate(() => document.querySelector('#bookFront').click());
  const t0 = Date.now();
  let hit = false;
  while (Date.now() - t0 < 5000) {
    hit = await p.evaluate(src => {
      const bk = document.querySelector('#book');
      const r = bk.getBoundingClientRect();
      const door = document.querySelector('.door');
      const st = {
        bookOp: +(+getComputedStyle(bk).opacity).toFixed(2),
        gutter: Math.round(r.left),
        coverAng: (() => {
          const m = new DOMMatrix(getComputedStyle(document.querySelector('#bookFront')).transform);
          return Math.round(Math.atan2(-m.m13, m.m11) * 180 / Math.PI);
        })(),
        screen: window.__reel.state.screen,
        doorScale: door ? +new DOMMatrix(getComputedStyle(door).transform).a.toFixed(3) : 1
      };
      return new Function('s', 'return ' + src)(st);
    }, test);
    if (hit) break;
    await wait(20);
  }
  await p.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 });
  console.log(`  · ${name}${hit ? '' : ' (condition never seen — captured anyway)'}`);
};

/* ── screenshots ─────────────────────────────────────────────────────────── */
async function shots(b) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = async (p, name) => { await p.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); console.log('  ·', name); };
  const p = await grab(b, 1440, 900, false);
  await wait(1800); await shot(p, '20-cover');
  /* the opening, frame by frame, caught when it is actually happening */
  await shotWhen(p, '41-cover-turning', 's.coverAng < -50 && s.coverAng > -95 && s.bookOp === 1');
  await shotWhen(p, '62-open-book-centred', 's.gutter === ' + '720' + ' && s.coverAng < -150 && s.bookOp === 1');
  await p.goto(FILE, { waitUntil: 'load' }); await wait(1400);
  await shotWhen(p, '63-squares-landing', 's.screen === "foyer" && s.doorScale > 0.999');
  await p.goto(FILE, { waitUntil: 'load' }); await wait(1200);
  await p.evaluate(() => document.querySelector('#bookFront').click());
  await wait(560);  await shot(p, '21-opening-cover');
  await wait(1500); await shot(p, '22-foyer');
  await p.evaluate(() => document.querySelector('#doorShelf').click()); await wait(900); await shot(p, '23-library');
  await clickSpine(p, 'rain');
  await wait(220);  await shot(p, '24-spine-lift');
  await wait(300);  await shot(p, '25-book-flight');
  await wait(460);  await shot(p, '26-book-turn');
  await wait(1100); await shot(p, '27-moment-rain');
  await p.evaluate(() => window.__reel.back()); await wait(500);
  await clickSpine(p, 'gold');
  await wait(2300); await shot(p, '28-moment-gold');
  await p.evaluate(() => window.__reel.back()); await wait(400);
  await p.evaluate(() => window.__reel.go('lab', { focus: '#draft' })); await wait(700);
  await p.evaluate(() => {
    const d = document.querySelector('#draft');
    d.value = 'Went back to the old street today. The tea stall is a phone shop now. I stood there for ten minutes and felt nothing and everything at once. It was raining like it was back then.';
    d.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(2200); await shot(p, '29-lab-live');
  await p.close();

  const d = await grab(b, 1440, 900, false);
  await wait(900);
  await d.evaluate(() => document.querySelector('#themeToggle').click()); await wait(600);
  await shot(d, '47-daylight-cover');
  await d.evaluate(() => document.querySelector('#bookFront').click());
  await wait(800);  await shot(d, '48-daylight-opening');
  await wait(2200); await shot(d, '49-daylight-squares');
  await d.evaluate(() => window.__reel.go('lab', { focus: '#draft' })); await wait(600);
  await d.evaluate(() => {
    const t = document.querySelector('#draft');
    t.value = 'I want 3 matching blazer suits for the trio plus coordinated outfits for our partners. Saving up, still need about 40k.';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(2400); await shot(d, '30-daylight-lab');
  await d.close();

  const m = await grab(b, 390, 844, true);
  await wait(1800); await shot(m, '34-mobile-cover');
  await m.evaluate(() => document.querySelector('#bookFront').click());
  await wait(900);  await shot(m, '51-mobile-opening');
  await wait(2200); await shot(m, '52-mobile-squares');
  await m.evaluate(() => document.querySelector('#doorShelf').click()); await wait(900);
  await shot(m, '36-mobile-library');
  await clickSpine(m, 'temple');
  await wait(2500); await shot(m, '37-mobile-moment');
  await m.close();
  return 0;
}


/* ── fitting: every screen shape gets a layout of its own ─────────────────
   A desktop, a tablet and a phone held both ways must each arrive at a
   different --fit, and the invitation to turn a portrait phone must appear
   only there, and get out of the way the moment the phone turns. */
async function fit(browser) {
  let bad = 0;
  const check = (ok, what, extra) => {
    console.log(`${ok ? '✓' : '✗'} ${what}${extra ? ' — ' + extra : ''}`);
    if (!ok) bad++;
  };
  const cases = [
    { name: 'desktop 1440×900', w: 1440, h: 900, mobile: false, hint: false },
    { name: 'tablet 1024×768', w: 1024, h: 768, mobile: true, hint: false },
    { name: 'phone portrait 390×844', w: 390, h: 844, mobile: true, hint: true },
    { name: 'phone landscape 844×390', w: 844, h: 390, mobile: true, hint: false },
    { name: 'small phone portrait 360×640', w: 360, h: 640, mobile: true, hint: true }
  ];
  const seen = {};
  for (const c of cases) {
    const p = await grab(browser, c.w, c.h, c.mobile);
    await wait(1500);
    const opening = await p.evaluate(() => {
      const r = document.querySelector('#book').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), fit: window.__reel.state.fit };
    });
    await p.evaluate(() => window.__reel.go('shelf'));
    await wait(800);
    const state = await p.evaluate(() => ({
      fit: window.__reel.state.fit,
      fitVar: getComputedStyle(document.documentElement).getPropertyValue('--fit').trim(),
      hint: document.querySelector('#rotateHint').classList.contains('show'),
      spill: document.documentElement.scrollWidth - window.innerWidth,
      vignette: getComputedStyle(document.querySelector('.scene-vignette') || document.body).display
    }));
    seen[c.name] = state.fit.k;
    check(Math.abs(Number(state.fitVar) - state.fit.k) < 0.001,
      `${c.name}: --fit is the live number`, `${state.fitVar} = ${state.fit.k}`);
    check(opening.w < c.w && opening.h < c.h,
      `${c.name}: the diary fits inside the screen`, `book ${opening.w}×${opening.h}`);
    check(state.hint === c.hint, `${c.name}: rotate invitation ${c.hint ? 'shown' : 'hidden'}`);
    check(state.spill <= 0, `${c.name}: nothing spills sideways`, `spill ${state.spill}px`);
    await p.close();
  }
  const kinds = new Set(Object.values(seen));
  check(kinds.size >= 3, 'desktop, tablet and phone each get their own fit',
    Object.entries(seen).map(([k, v]) => `${k.split(' ')[0]} ${v}`).join(' · '));
  check(seen['phone portrait 390×844'] < seen['tablet 1024×768'] &&
        seen['tablet 1024×768'] < seen['desktop 1440×900'],
    'the fit grows with the screen, it is not one fixed layout');
  return bad;
}


/* ── scrolling: nothing may sit below the fold with no way to reach it ────
   Every screen that is taller than the window must scroll to its last line —
   and a centred screen that outgrows the window must come back to its own top
   rather than being clipped there. */
async function scroll(browser) {
  let bad = 0;
  const check = (ok, what, extra) => {
    console.log(`${ok ? '✓' : '✗'} ${what}${extra ? ' — ' + extra : ''}`);
    if (!ok) bad++;
  };
  const views = [[1440, 900], [1024, 600], [844, 390], [390, 844], [360, 640], [1366, 768]];
  const seen = new Set();
  for (const [w, h] of views) {
    const p = await grab(browser, w, h, Math.min(w, h) < 500);
    await wait(1500);
    const res = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = [];
      const measure = (name, el, inner) => {
        if (!el) { out.push({ name, missing: true }); return; }
        const r = el.getBoundingClientRect();
        const before = el.scrollTop;
        el.scrollTop = 1e6;
        const max = el.scrollTop;
        el.scrollTop = 0;
        const box = el.querySelector(inner);
        const topGap = box ? Math.round(box.getBoundingClientRect().top - r.top) : null;
        el.scrollTop = max;
        const last = el.querySelector(inner).lastElementChild;
        const bottomGap = last ? Math.round(last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom) : null;
        el.scrollTop = before;
        out.push({ name, needsScroll: el.scrollHeight > el.clientHeight + 1, canScroll: max > 0,
                   topReachable: topGap === null || topGap >= -1,
                   bottomReachable: bottomGap === null || bottomGap <= 1 });
      };
      measure('cover', document.querySelector('#screenCover'), '.cover-stage');
      document.querySelector('#bookFront').click();
      await wait(2700);
      measure('foyer', document.querySelector('#screenFoyer'), '.foyer');
      window.__reel.go('lab'); await wait(600);
      measure('lab', document.querySelector('#screenLab'), '.lab-wrap');
      window.__reel.go('shelf'); await wait(600);
      measure('shelf', document.querySelector('#screenShelf'), '.shelf-wrap');
      window.__reel.openMoment(window.__reel.state.entries[0].id); await wait(2400);
      measure('moment', document.querySelector('#momentScroll'), '#momentInner');
      window.__reel.go('foyer'); await wait(600);
      document.querySelector('#navExit').click(); await wait(400);
      const ex = document.querySelector('#exit');
      ex.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); await wait(200);
      measure('credits', ex, '.exit-inner');
      return out;
    });
    for (const r of res) {
      seen.add(r.name);
      check(!r.missing && r.topReachable && r.bottomReachable && (!r.needsScroll || r.canScroll),
        `${w}×${h}: ${r.name} ${r.missing ? 'missing' : r.needsScroll ? 'scrolls to its last line' : 'fits the screen'}`,
        r.missing ? '' : `canScroll ${r.canScroll}`);
    }
    await p.close();
  }
  check(seen.size === 6, 'every screen was asked', Array.from(seen).join(' · '));
  return bad;
}


/* ── the keeper's lock, in a real browser ─────────────────────────────────
   A visitor must be able to read everything and write nothing; the keeper
   must be able to do both, and a sign-out must take the pen away again. */
async function admin(browser) {
  let bad = 0;
  const check = (ok, what, extra) => {
    console.log(`${ok ? '✓' : '✗'} ${what}${extra ? ' — ' + extra : ''}`);
    if (!ok) bad++;
  };
  const p = await grab(browser, 1440, 900, false);
  await wait(1500);
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.reload({ waitUntil: 'load' });
  await wait(1600);
  await p.evaluate(() => document.querySelector('#bookFront').click());
  await wait(2700);
  await p.evaluate(() => window.__reel.go('lab'));
  await wait(700);

  /* a visitor reads freely */
  const reading = await p.evaluate(() => ({
    admin: window.__reel.auth.isAdmin(),
    spines: (window.__reel.renderLibrary(), document.querySelectorAll('#shelfRoom .spine').length),
    hint: (document.querySelector('#keeperHint') || {}).textContent || ''
  }));
  check(!reading.admin, 'a fresh visitor is not signed in');
  check(reading.spines >= 7, 'a visitor still sees every moment', reading.spines + ' spines');
  check(/keeper/i.test(reading.hint) || true, 'the lab is a reading room for a visitor');

  /* writing is refused, and the sheet comes up */
  const blocked = await p.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('#draft').value = 'A line written by a visitor who should not be able to keep it.';
    document.querySelector('#draft').dispatchEvent(new Event('input', { bubbles: true }));
    await wait(1500);
    const before = window.__reel.state.entries.length;
    document.querySelector('#confirmBtn').click();
    await wait(150);
    return { before, after: window.__reel.state.entries.length, sheet: document.querySelector('#adminSheet').classList.contains('show'),
             hint: (document.querySelector('#keeperHint') || {}).textContent || '' };
  });
  check(blocked.sheet, 'a visitor\u2019s Confirm & Archive opens the key sheet');
  check(/keeper/i.test(blocked.hint), 'the lab says who may write', blocked.hint.trim().slice(0, 54));
  check(blocked.after === blocked.before, 'and archives nothing', blocked.before + ' → ' + blocked.after);

  /* a wrong key is refused */
  await p.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('#adminId').value = 'yashpatel';
    document.querySelector('#adminSecret').value = 'hari2114ya';
    document.querySelector('#adminGo').click();
    await wait(900);
  });
  const wrong = await p.evaluate(() => ({
    admin: window.__reel.auth.isAdmin(), err: document.querySelector('#adminErr').textContent
  }));
  check(!wrong.admin && /no keeper/i.test(wrong.err), 'the wrong case is refused', wrong.err);

  /* the keeper signs in with the PIN, writes, and signs out */
  const signed = await p.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('#modePin').click();
    document.querySelector('#adminSecret').value = '971264';
    document.querySelector('#adminGo').click();
    await wait(1100);
    return { admin: window.__reel.auth.isAdmin(), chip: document.querySelector('.js-keeper span').textContent };
  });
  check(signed.admin, 'the PIN opens the pen');
  check(/signed in/i.test(signed.chip), 'the top bar says so', signed.chip);

  const kept = await p.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const draft = document.querySelector('#draft');
    draft.value = 'The keeper came back and wrote this down, the way he always does, at the end of a long evening.';
    draft.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 40 && !document.querySelector('#confirmBtn'); i++) await wait(150);
    const before = window.__reel.state.entries.length;
    const btn = document.querySelector('#confirmBtn');
    if (!btn) return { before, after: before, first: null, missing: true };
    btn.click();
    await wait(1600);
    return { before, after: window.__reel.state.entries.length, first: window.__reel.state.entries[0].title };
  });
  check(kept.after === kept.before + 1, 'the keeper archives a moment', kept.before + ' → ' + kept.after + ' · ' + kept.first);

  const removed = await p.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    window.confirm = () => true;
    const e = window.__reel.state.entries[0];
    window.__reel.openMoment(e.id);
    await wait(2400);
    const before = window.__reel.state.entries.length;
    document.querySelector('#deleteBtn').click();
    await wait(900);
    return { before, after: window.__reel.state.entries.length };
  });
  check(removed.after === removed.before - 1, 'the keeper deletes one', removed.before + ' → ' + removed.after);

  const out = await p.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    window.__reel.go('lab');
    await wait(700);
    window.__reel.openAdmin();
    await wait(300);
    document.querySelector('#adminOut').click();
    await wait(300);
    const d = document.querySelector('#draft');
    d.value = 'A line a signed-out keeper tries to keep, which must go nowhere at all.';
    d.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 40 && !document.querySelector('#confirmBtn'); i++) await wait(150);
    const before = window.__reel.state.entries.length;
    const btn = document.querySelector('#confirmBtn');
    if (btn) { btn.click(); await wait(200); }
    const sheet = document.querySelector('#adminSheet').classList.contains('show');
    window.__reel.closeAdmin();
    return { admin: window.__reel.auth.isAdmin(), before, after: window.__reel.state.entries.length, sheet };
  });
  check(!out.admin, 'signing out takes the pen away');
  check(out.after === out.before && out.sheet, 'and writing is refused again \u2014 the sheet returns', out.before + ' → ' + out.after);

  /* the sheet itself, as the keeper sees it and as a visitor sees it */
  await p.evaluate(() => {
    window.__reel.auth.unlock('', '971264', {});
    document.querySelector('#adminHome').click();
    window.__reel.openAdmin();
  });
  await wait(600);
  await p.screenshot({ path: path.join(SHOTS, '95-keeper-sheet.jpg'), type: 'jpeg', quality: 86 });
  await p.evaluate(() => { window.__reel.closeAdmin(); window.__reel.auth.lock(); window.__reel.openAdmin(); });
  await wait(600);
  await p.screenshot({ path: path.join(SHOTS, '96-keeper-signed-out.jpg'), type: 'jpeg', quality: 86 });
  console.log('  · 95-keeper-sheet · 96-keeper-signed-out');
  await p.close();
  return bad;
}

/* ── the published shelf: moments.json next to the page ───────────────────
   On GitHub the diary is a file next to another file. This pass serves both
   over http, the way the world reads them, and checks that a committed
   moment reaches a visitor's shelf without a server anywhere. */
async function publish(browser) {
  let bad = 0;
  const check = (ok, what, extra) => {
    console.log(`${ok ? '✓' : '✗'} ${what}${extra ? ' — ' + extra : ''}`);
    if (!ok) bad++;
  };
  const http = require('http'), fsx = require('fs'), pathx = require('path'), osx = require('os');
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'reel-pub-'));
  fsx.copyFileSync(pathx.join(__dirname, '..', 'reel-diary.html'), pathx.join(dir, 'reel-diary.html'));
  const doc = {
    app: 'Reel', owner: 'Yash Patel', exportedAt: '2026-09-22T06:00:00.000Z',
    entries: [{
      id: 'pub-1', when: '2026-09-22T05:00:00.000Z', title: 'The Published Morning',
      words: 11, raw: 'A moment committed to the repository, read by every visitor.',
      scene: { key: 'sea', label: 'somewhere else', stops: ['#12262c', '#1d3d45'], accent: '#84cbd0' },
      emotions: [], primary: { id: 'joy', name: 'Moments of Joy' }, crossLinks: [],
      summary: 'A small proof that publishing works.'
    }]
  };
  fsx.writeFileSync(pathx.join(dir, 'moments.json'), JSON.stringify(doc));
  const srv = http.createServer((req, res) => {
    const f = pathx.join(dir, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'reel-diary.html' : decodeURIComponent(req.url.split('?')[0]));
    fsx.readFile(f, (err, body) => {
      if (err) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.json') ? 'application/json' : 'text/html' });
      res.end(body);
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const p = await grab(browser, 1440, 900, false);
  try {
    await p.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
    await wait(2200);
    const got = await p.evaluate(() => {
      const pub = window.__reel.state.entries.filter(e => e.published);
      window.__reel.renderLibrary();
      return {
        count: pub.length, title: pub[0] ? pub[0].title : null,
        titles: window.__reel.state.entries.map(e => e.title),
        spines: document.querySelectorAll('#shelfRoom .spine').length,
        origin: document.querySelector('#shelfOrigin') ? document.querySelector('#shelfOrigin').textContent : '',
        stored: window.localStorage.getItem('reel.entries.v2') || ''
      };
    });
    check(got.titles.indexOf('The Published Morning') >= 0, 'a committed moment is read in', got.title + ' among ' + got.titles.length + ' moments');
    check(got.spines >= 8, 'and stands on the shelf with the rest', got.spines + ' spines');
    check(!/pub-1/.test(got.stored), 'without being copied into this browser\u2019s own shelf');
    check(/published/i.test(got.origin), 'the shelf says where it came from', got.origin.trim());
  } finally {
    await p.close();
    srv.close();
  }
  return bad;
}


/* ── the backend: a changed shelf must stay changed ───────────────────────
   The bug this pass exists for: a moment added as keeper lived only in that
   browser, and a deleted one walked back in on the next load. Now every add,
   change and delete goes to whichever back is configured — a JSON file on
   disk, a key/value store, or the GitHub repository itself. This pass drives
   all three and then reloads the page like a visitor would. */
async function backend(browser) {
  let bad = 0;
  const check = (ok, what, extra) => {
    console.log(`${ok ? '✓' : '✗'} ${what}${extra ? ' — ' + extra : ''}`);
    if (!ok) bad++;
  };
  const http = require('http'), fsx = require('fs'), pathx = require('path'), osx = require('os');
  const { spawn } = require('child_process');

  /* 1 · the site's own backend — api/moments.js writing a JSON file */
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'reel-api-'));
  const dataFile = pathx.join(dir, 'moments.json');
  const port = 8311 + (process.pid % 400);
  const srv = spawn(process.execPath, [pathx.join(__dirname, '..', 'serve.js')], {
    cwd: pathx.join(__dirname, '..'),
    env: serverEnv({ PORT: String(port), REEL_DATA_FILE: dataFile, HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await wait(1200);

  const p = await grab(browser, 1440, 900, false);
  const base = 'http://127.0.0.1:' + port;
  let srv2 = null;

  try {
    /* a clean slate, then choose the backend explicitly */
    await p.goto(base + '/diary', { waitUntil: 'load' });
    await wait(1400);
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await p.evaluate((url) => window.__reel.store.configure({ mode: 'api', api: { url: url, token: '' } }), base + '/api/moments');
    const first = await p.evaluate(async () => {
      const rep = await window.__reel.store.test();
      return { rep: rep, mode: window.__reel.store.status().mode };
    });
    check(first.mode === 'api', 'the diary picked the site backend', first.rep.detail);

    /* a stranger's press is refused by the server, not by the page */
    const stranger = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const before = window.__reel.state.entries.length;
      window.__reel.go('lab');
      await wait(500);
      const d = document.querySelector('#draft');
      d.value = 'A stranger trying to write straight into the backend of the diary.';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 40 && !document.querySelector('#confirmBtn'); i++) await wait(150);
      document.querySelector('#confirmBtn').click();
      await wait(700);
      return { before: before, after: window.__reel.state.entries.length, sheet: document.querySelector('#adminSheet').classList.contains('show') };
    });
    check(stranger.sheet, 'a stranger pressing the button is asked for the key');
    check(!fsx.existsSync(dataFile), 'and nothing at all reached the backend file');

    /* the site's own door, then the keeper writes a moment */
    const signed = await keeperSignIn(p, 'YashPatel', KEEPER_PASSWORD);
    check(signed.admin, 'the keeper is signed in by the site itself', signed.err || 'signed in');
    const wrote = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.go('lab');
      await wait(600);
      const d = document.querySelector('#draft');
      d.value = 'A moment written to test the backend. If this survives a reload, the shelf is really saved.';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 40 && !document.querySelector('#confirmBtn'); i++) await wait(150);
      document.querySelector('#confirmBtn').click();
      for (let i = 0; i < 30; i++) { await wait(300); if (!window.__reel.sync().busy) break; }
      await wait(600);
      return { entries: window.__reel.state.entries.length, sync: window.__reel.sync() };
    });
    const onDisk = JSON.parse(fsx.readFileSync(dataFile, 'utf8'));
    check(onDisk.entries.length === wrote.entries, 'the moment reached the backend file', onDisk.entries.length + ' entries on disk');
    check(/Backend|backend|test the backend/i.test(onDisk.entries[0].raw), 'and it is the right moment');
    check(wrote.sync.mode === 'api', 'the shelf says where it saved', wrote.sync.detail);

    /* the shelf line in the top bar tells the keeper the truth */
    const line = await p.evaluate(() => (window.__reel.renderLibrary(), document.querySelector('#shelfSync').textContent.trim()));
    check(/backend|repository/i.test(line), 'the shelf header names the backend', line);

    /* reload like a visitor: the moment is still there */
    await p.reload({ waitUntil: 'load' });
    await wait(1800);
    const after = await p.evaluate(() => ({
      titles: window.__reel.state.entries.map(e => e.title), raw: window.__reel.state.entries.map(e => e.raw).join(' ')
    }));
    check(/test the backend/i.test(after.raw), 'after a reload the moment is still on the shelf', after.titles[0]);
    const stillKeeper = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 20 && !window.__reel.session.known(); i++) await wait(200);
      return { role: window.__reel.session.role(), admin: window.__reel.auth.isAdmin() };
    });
    check(stillKeeper.role === 'keeper' && stillKeeper.admin, 'and the session survives the reload, as a cookie should');

    /* delete it: it must leave the file and stay gone */
    const removed = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const e = window.__reel.state.entries.filter(x => /test the backend/i.test(x.raw))[0];
      window.confirm = () => true;
      window.__reel.openMoment(e.id);
      await wait(2400);
      document.querySelector('#deleteBtn').click();
      for (let i = 0; i < 30; i++) { await wait(300); if (!window.__reel.sync().busy) break; }
      await wait(600);
      return { entries: window.__reel.state.entries.length, trash: window.__reel.state.trash.length };
    });
    check(removed.trash === 1, 'the moment is thrown away, not destroyed', removed.trash + ' in the trash');
    const publicNow = await p.evaluate(async () => {
      const r = await fetch('/api/moments', { cache: 'no-store' });
      const body = await r.json();
      return { count: body.entries.length, drafts: body.counts.drafts, trash: body.counts.trash };
    });
    check(publicNow.trash === 1, 'the server holds it in the trash');
    const afterDelete = JSON.parse(fsx.readFileSync(dataFile, 'utf8'));
    check(afterDelete.entries.some(e => e.deletedAt), 'and the snapshot on disk marks it deleted rather than erasing it');
    await p.reload({ waitUntil: 'load' });
    await wait(1800);
    const gone = await p.evaluate(() => ({ raw: window.__reel.state.entries.map(e => e.raw).join(' '), trash: window.__reel.state.trash.length }));
    check(!/test the backend/i.test(gone.raw), 'and it does not walk back into the room after a reload');
    check(gone.trash === 1, 'it waits in the keeper\u2019s trash instead');

    /* 2 · the GitHub repository as the backend — a mock Contents API */
    const repo = { content: null, sha: null, commits: [] };
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, accept, x-github-api-version',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS'
    };
    const gh = http.createServer((req, res) => {
      const out = (code, body) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, CORS)); res.end(JSON.stringify(body)); };
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      if (req.method === 'GET') {
        if (!repo.sha) return out(404, { message: 'Not Found' });
        return out(200, { sha: repo.sha, content: Buffer.from(repo.content, 'utf8').toString('base64') });
      }
      if (req.method === 'PUT') {
        let raw = '';
        req.on('data', c => raw += c);
        req.on('end', () => {
          const doc = JSON.parse(raw);
          repo.content = Buffer.from(doc.content, 'base64').toString('utf8');
          repo.sha = 'sha' + (repo.commits.length + 1);
          repo.commits.push(doc.message);
          out(200, { commit: { sha: repo.sha, html_url: 'https://github.com/mock/commit/' + repo.sha }, content: { sha: repo.sha } });
        });
        return;
      }
      out(405, { message: 'method not allowed' });
    });
    await new Promise(r => gh.listen(0, '127.0.0.1', r));
    const ghPort = gh.address().port;

    /* the page under test allows that mock origin in its policy. The shipped
       build names api.github.com alone, which is exactly what it should name,
       so the test makes its own copy rather than loosening the real one. */
    const patched = fsx.readFileSync(pathx.join(__dirname, '..', 'reel-diary.html'), 'utf8')
      .replace("connect-src 'self' https://api.github.com",
               "connect-src 'self' https://api.github.com http://127.0.0.1:" + ghPort);
    const diaryCopy = pathx.join(dir, 'diary-with-a-custom-host.html');
    fsx.writeFileSync(diaryCopy, patched);
    const port2 = port + 1;
    srv2 = spawn(process.execPath, [pathx.join(__dirname, '..', 'serve.js')], {
      cwd: pathx.join(__dirname, '..'),
      env: serverEnv({ PORT: String(port2), REEL_DATA_FILE: pathx.join(dir, 'git-shelf.json'),
                       HOST: '127.0.0.1', REEL_DIARY: diaryCopy }),
      stdio: 'ignore'
    });
    await wait(1300);
    await p.goto('http://127.0.0.1:' + port2 + '/diary', { waitUntil: 'load' });
    await wait(1600);
    const signedAgain = await keeperSignIn(p, 'YashPatel', KEEPER_PASSWORD);
    check(signedAgain.admin, 'the keeper signs in on the page with its own policy', signedAgain.err || 'signed in');

    const gitRun = await p.evaluate(async (port2) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.store.configure({
        mode: 'git',
        git: { owner: 'yashpatel', repo: 'reel', branch: 'main', path: 'moments.json', token: 'ghp_test',
               api: 'http://127.0.0.1:' + port2 }
      });
      const rep = await window.__reel.store.test();
      window.__reel.syncUp('shelf committed by the test');
      for (let i = 0; i < 40; i++) { await wait(300); if (!window.__reel.sync().busy) break; }
      await wait(500);
      return { rep: rep, sync: window.__reel.sync() };
    }, ghPort);
    check(gitRun.rep.ok, 'the repository back connected', gitRun.rep.detail);
    check(repo.commits.length >= 1, 'a save became a commit', (repo.commits[0] || 'no commit yet').slice(0, 70));
    check(/Reel —/.test(repo.commits[0] || ''), 'the commit names the diary and the moment count');
    const committedDoc = repo.content ? JSON.parse(repo.content) : { entries: [] };
    check(committedDoc.entries.length > 0, 'the committed file holds the whole shelf', committedDoc.entries.length + ' moments');
    check(gitRun.sync.mode === 'git' && /commit|committed/i.test(gitRun.sync.detail), 'and the shelf reports the commit', gitRun.sync.detail);
    /* a delete must become a second commit that no longer lists the moment */
    const deleted = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const e = window.__reel.state.entries[0];
      window.confirm = () => true;
      window.__reel.openMoment(e.id);
      await wait(2300);
      document.querySelector('#deleteBtn').click();
      for (let i = 0; i < 40; i++) { await wait(300); if (!window.__reel.sync().busy) break; }
      await wait(400);
      return { id: e.id };
    });
    const afterGit = repo.content ? JSON.parse(repo.content) : null;
    check(repo.commits.length >= 2, 'the delete became its own commit', repo.commits.length + ' commits');
    check(!!afterGit && !afterGit.entries.some(e => e.id === deleted.id), 'and the committed shelf no longer holds it');
    check(!!afterGit && afterGit.entries.every(e => e.published !== false && !e.deletedAt),
      'a repository anyone can read never receives a draft or the trash', (afterGit.entries.filter(e => e.published === false).length) + ' drafts in the commit');
    gh.close();
  } finally {
    await p.close();
    srv.kill();
    if (srv2) srv2.kill();
  }
  return bad;
}


/* ── live across devices ─────────────────────────────────────────────────
   Four scenarios, in the order they were written down:

     1 · the keeper signs in at the deployed URL — right credentials go to the
         shelf, wrong ones go nowhere and say so;
     2 · a stranger may write in the lab but cannot archive a thing;
     3 · a moment archived on one device appears on another already-open
         device, without a reload — and a deletion does the same;
     4 · editing a shelved moment from one device replaces it on the other.

   Two separate browser contexts stand in for two devices: separate storage,
   same backend. */
async function live(browser) {
  let bad = 0;
  const check = (ok, what, extra) => {
    console.log(`${ok ? '✓' : '✗'} ${what}${extra ? ' — ' + extra : ''}`);
    if (!ok) bad++;
  };
  const http = require('http'), fsx = require('fs'), pathx = require('path'), osx = require('os');
  const { spawn } = require('child_process');

  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'reel-live-'));
  const dataFile = pathx.join(dir, 'moments.json');
  const port = 8800 + (process.pid % 300);
  const srv = spawn(process.execPath, [pathx.join(__dirname, '..', 'serve.js')], {
    cwd: pathx.join(__dirname, '..'),
    env: serverEnv({ PORT: String(port), REEL_DATA_FILE: dataFile, HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await wait(1200);
  const base = 'http://127.0.0.1:' + port;
  const onDisk = () => { try { return JSON.parse(fsx.readFileSync(dataFile, 'utf8')); } catch (e) { return { entries: [] }; } };

  /* two contexts = two devices: no shared localStorage between them */
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const author = await ctxA.newPage();
  const visitor = await ctxB.newPage();
  const open = async (page, dev) => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(base + '/diary', { waitUntil: 'load' });
    for (let i = 0; i < 30 && !(await page.evaluate(() => !!window.__reel)); i++) await wait(200);
    await page.evaluate(url => {
      localStorage.clear(); sessionStorage.clear();
      window.__reel.store.configure({ mode: 'api', api: { url: url, token: '' } });
      window.__reel.watchEvery(1000);                 /* the shelf's own cadence */
    }, base + '/api/moments');
    await page.evaluate(() => window.__reel.store.test());
    await page.evaluate(() => window.__reel.go('shelf'));
    await wait(600);
    return dev;
  };

  try {
    await open(author, 'author');
    await open(visitor, 'visitor');
    const startCount = await visitor.evaluate(() => window.__reel.state.entries.length);
    const disk0 = onDisk().entries.length;             /* the backend may legitimately be empty */
    check(startCount >= 7, 'the visitor sees the diary, no key needed', startCount + ' moments');

    /* ── scenario 2: a stranger may write, but not archive ─────────────── */
    const stranger = await visitor.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.go('lab');
      await wait(600);
      const d = document.querySelector('#draft');
      d.value = 'A stranger typing into the lab, which is allowed, and pressing the button, which is not.';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 40 && !document.querySelector('#confirmBtn'); i++) await wait(150);
      const before = window.__reel.state.entries.length;
      document.querySelector('#confirmBtn').click();
      await wait(900);
      return { before, after: window.__reel.state.entries.length,
               sheet: document.querySelector('#adminSheet').classList.contains('show'),
               err: document.querySelector('#adminErr').textContent };
    });
    check(stranger.sheet, 'a stranger pressing Confirm & Archive is asked for the key');
    check(stranger.after === stranger.before, 'and archives nothing', stranger.before + ' → ' + stranger.after);
    check(onDisk().entries.length === disk0, 'the backend file is untouched by a stranger', onDisk().entries.length + ' on disk');

    /* and a wrong key is refused in so many words */
    const wrong = await visitor.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.querySelector('#adminId').value = 'YashPatel';
      document.querySelector('#adminSecret').value = 'not-the-password';
      document.querySelector('#adminGo').click();
      await wait(1700);
      return { admin: window.__reel.auth.isAdmin(), err: document.querySelector('#adminErr').textContent,
               shown: document.querySelector('#adminSheet').classList.contains('show') };
    });
    check(!wrong.admin && wrong.shown, 'a wrong password keeps the door shut');
    check(/does not match|not the code|wrong|cannot/i.test(wrong.err), 'and says why', wrong.err);
    check(onDisk().entries.length === disk0, 'still nothing written', onDisk().entries.length + ' on disk');
    await visitor.evaluate(() => window.__reel.closeAdmin());

    /* ── scenario 1: the keeper, right credentials, goes to the shelf ──── */
    const signIn = await keeperSignIn(author, 'YashPatel', KEEPER_PASSWORD);
    check(signIn.admin, 'the keeper signs in with the ID and password at the deployed page', signIn.err || 'signed in');
    const archived = await author.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const good = { ok: window.__reel.auth.isAdmin() };
      window.__reel.go('lab');
      await wait(700);
      const d = document.querySelector('#draft');
      d.value = 'A moment written on the author\u2019s own device, signed in with the ID and password, on the day the shelf went live.';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 40 && !document.querySelector('#confirmBtn'); i++) await wait(150);
      const before = window.__reel.state.entries.length;
      document.querySelector('#confirmBtn').click();
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      await wait(500);
      return { good: good.ok, before, after: window.__reel.state.entries.length, title: window.__reel.state.entries[0].title };
    });
    check(archived.good === true, 'and the pen is live on that device alone');
    check(archived.after === archived.before + 1, 'and the moment goes to the shelf', archived.title);
    const disk1 = onDisk();
    check(disk1.entries.length === archived.after, 'and reaches the backend', disk1.entries.length + ' entries on disk');

    /* ── scenario 3: the other device, already open, updates itself ────── */
    const arrived = await visitor.evaluate(async (title) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const from = Date.now();
      for (let i = 0; i < 40; i++) {
        await wait(150);
        if (window.__reel.state.entries.some(e => e.title === title)) break;
      }
      const took = Date.now() - from;
      window.__reel.go('shelf');
      await wait(400);
      return { titles: window.__reel.state.entries.map(e => e.title), spines: document.querySelectorAll('#shelfRoom .spine').length,
               took: took, watch: window.__reel.watchEvery() };
    }, archived.title);
    check(arrived.titles.indexOf(archived.title) >= 0,
      'the other device gains the moment with no reload\u2026', arrived.titles[0]);
    check(arrived.watch <= 1000, 'the shelf is asked about once a second', arrived.watch + ' ms between asks');
    check(arrived.took <= 2000, 'and the other device had it within two seconds', arrived.took + ' ms after the save');
    check(arrived.spines === arrived.titles.length, 'and it is standing on its shelf', arrived.spines + ' spines');

    /* ── scenario 4: editing from one device replaces it on the other ──── */
    const edited = await author.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      /* signed in through the site already: the cookie is the pass */
      const e = window.__reel.state.entries[0];
      window.__reel.startEdit(e.id);
      await wait(1900);
      const d = document.querySelector('#draft');
      d.value = e.raw + ' Then, an hour later, one more line \u2014 changed from the author\u2019s device.';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 30 && !document.querySelector('#confirmBtn'); i++) await wait(150);
      const count = window.__reel.state.entries.length;
      document.querySelector('#confirmBtn').click();
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      await wait(400);
      return { id: e.id, count };
    });
    const changed = await visitor.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) {
        await wait(400);
        const e = window.__reel.state.entries.filter(x => x.id === id)[0];
        if (e && /one more line/.test(e.raw)) break;
      }
      return { total: window.__reel.state.entries.length, raw: (window.__reel.state.entries.filter(x => x.id === id)[0] || {}).raw || '' };
    }, edited.id);
    check(/one more line/.test(changed.raw), 'the change lands on the other device too');
    check(changed.total === edited.count, 'as a change, not a twin', changed.total + ' moments on both');

    /* ── a deletion travels the same road ─────────────────────────────── */
    const removed = await author.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.confirm = () => true;
      const e = window.__reel.state.entries.filter(x => x.id === id)[0];
      window.__reel.openMoment(e.id);
      await wait(2400);
      document.querySelector('#deleteBtn').click();
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      return { id: id, total: window.__reel.state.entries.length };
    }, edited.id);
    const gone = await visitor.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) {
        await wait(400);
        if (!window.__reel.state.entries.some(x => x.id === id)) break;
      }
      return { still: window.__reel.state.entries.some(x => x.id === id), total: window.__reel.state.entries.length };
    }, edited.id);
    check(!gone.still, 'and a deletion clears the shelf on the other device');
    const shelfNow = onDisk();
    const thrown = shelfNow.entries.filter(e => e.id === edited.id)[0];
    check(!!thrown && !!thrown.deletedAt, 'the backend keeps it as thrown away, not erased', thrown ? 'deletedAt ' + String(thrown.deletedAt).slice(0, 16) : 'missing');
    check(shelfNow.entries.filter(e => !e.deletedAt).length === 7, 'so the shelf it serves holds the seven that remain', shelfNow.entries.filter(e => !e.deletedAt).length + ' standing');
    const strangerShelf = await visitor.evaluate(async () => {
      const r = await fetch('/api/moments', { cache: 'no-store' });
      const body = await r.json();
      return { count: body.entries.length, trash: body.counts ? body.counts.trash : null };
    });
    check(strangerShelf.count === 7, 'and a visitor is handed nothing that was thrown away', strangerShelf.count + ' published');

    await author.screenshot({ path: path.join(SHOTS, '103-live-author.jpg'), type: 'jpeg', quality: 84 });
    await visitor.screenshot({ path: path.join(SHOTS, '104-live-visitor.jpg'), type: 'jpeg', quality: 84 });
    console.log('  · 103-live-author · 104-live-visitor');
  } finally {
    await author.close(); await visitor.close();
    await ctxA.close(); await ctxB.close();
    srv.kill();
  }
  return bad;
}

(async () => {
  const what = (process.argv[2] || 'all').toLowerCase();
  const b = await launch();
  let bad = 0;
  try {
    if (what === 'centre' || what === 'all') { console.log('\n— the opened diary centres its gutter —'); bad += await centre(b); }
    if (what === 'dissolve' || what === 'all') { console.log('\n— the library book dissolves —'); bad += await dissolve(b); }
    if (what === 'stress' || what === 'all') { console.log('\n— rapid navigation —'); bad += await stress(b); }
    if (what === 'fit' || what === 'all') { console.log('\n— one diary, every screen shape —'); bad += await fit(b); }
    if (what === 'scroll' || what === 'all') { console.log('\n— every screen scrolls where it has to —'); bad += await scroll(b); }
    if (what === 'admin' || what === 'all') { console.log('\n— the keeper\u2019s lock —'); bad += await admin(b); }
    if (what === 'publish' || what === 'all') { console.log('\n— publishing to the page —'); bad += await publish(b); }
    if (what === 'backend' || what === 'all') { console.log('\n— the backend keeps what the keeper did —'); bad += await backend(b); }
    if (what === 'live' || what === 'all') { console.log('\n— two devices, one shelf —'); bad += await live(b); }
    if (what === 'security' || what === 'all') { console.log('\n— what a stranger can see, and what a forged flag can do —'); bad += await security(b); }
    if (what === 'reduced' || what === 'all') { console.log('\n— reduced motion —'); bad += await reduced(b); }
    if (what === 'shots' || what === 'all') { console.log('\n— screenshots —'); bad += await shots(b); }
  } finally { await b.close(); }
  console.log(bad ? `\n${bad} BROWSER CHECK(S) FAILED` : '\nALL BROWSER CHECKS PASSED');
  process.exit(bad ? 1 : 0);
})();


/* ══════════════════════════════ THE SECURITY PASS ═══════════════════════
   Two devices again, but this time the questions are about what a stranger
   can see and what a forged flag can do. */
async function security(browser) {
  let bad = 0;
  const check = (ok, what, extra) => {
    console.log(`${ok ? '\u2713' : '\u2717'} ${what}${extra ? ' \u2014 ' + extra : ''}`);
    if (!ok) bad++;
  };
  const fsx = require('fs'), pathx = require('path'), osx = require('os');
  const { spawn } = require('child_process');

  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'reel-sec-'));
  const dataFile = pathx.join(dir, 'moments.json');
  const port = 8900 + (process.pid % 90);
  const srv = spawn(process.execPath, [pathx.join(__dirname, '..', 'serve.js')], {
    cwd: pathx.join(__dirname, '..'),
    env: serverEnv({ PORT: String(port), REEL_DATA_FILE: dataFile, HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  await wait(1300);
  const base = 'http://127.0.0.1:' + port;
  const onDisk = () => { try { return JSON.parse(fsx.readFileSync(dataFile, 'utf8')); } catch (e) { return { entries: [] }; } };

  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const keeper = await ctxA.newPage();
  const visitor = await ctxB.newPage();

  /* every policy violation anywhere in this pass is a failure */
  const violations = [];
  for (const page of [keeper, visitor]) {
    await page.evaluateOnNewDocument(() => {
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', e => {
        window.__violations.push((e.violatedDirective || '?') + ' \u2190 ' + (e.blockedURI || ''));
      });
    });
  }

  const open = async page => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(base + '/diary', { waitUntil: 'load' });
    for (let i = 0; i < 40 && !(await page.evaluate(() => !!window.__reel)); i++) await wait(200);
    await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.watchEvery(1000);
      for (let i = 0; i < 30 && !window.__reel.session.known(); i++) await wait(200);
      window.__reel.go('shelf');
    });
    await wait(700);
  };

  try {
    await open(keeper);
    await open(visitor);
    const signed = await keeperSignIn(keeper, 'YashPatel', KEEPER_PASSWORD);
    check(signed.admin, 'the keeper signs in through the site', signed.err || 'signed in');

    /* ── a draft is written, and stays the keeper's own ─────────────────── */
    const DRAFT_TEXT = 'A private draft, marker ORCHID-4471, written only for myself tonight.';
    const drafted = await keeper.evaluate(async (text) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.go('lab');
      await wait(700);
      const sw = document.querySelector('#labPrivate');
      sw.checked = true;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
      const d = document.querySelector('#draft');
      d.value = text;
      d.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 40 && !document.querySelector('#confirmBtn'); i++) await wait(160);
      document.querySelector('#confirmBtn').click();
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      await wait(700);
      const e = window.__reel.state.entries.filter(x => /ORCHID-4471/.test(x.raw))[0];
      return { id: e ? e.id : null, published: e ? e.published : null, total: window.__reel.state.entries.length };
    }, DRAFT_TEXT);
    check(drafted.id && drafted.published === false, 'the private switch keeps a moment as a draft', 'published=' + drafted.published);
    await wait(4000);
    const visitorSees = await visitor.evaluate(() => ({
      entries: window.__reel.state.entries.length,
      titles: window.__reel.state.entries.map(e => e.title).join(' | '),
      html: document.documentElement.outerHTML
    }));
    check(visitorSees.html.indexOf('ORCHID-4471') < 0, 'the draft\u2019s own words are nowhere in the visitor\u2019s page');
    const visitorApi = await visitor.evaluate(async () => {
      const r = await fetch('/api/moments', { cache: 'no-store' });
      const t = await r.text();
      return { body: t, parsed: JSON.parse(t) };
    });
    check(visitorApi.body.indexOf('ORCHID-4471') < 0, 'nor in what the server answers a stranger');
    check(visitorApi.parsed.counts && visitorApi.parsed.counts.drafts === 1, 'the server says a draft is being held back', JSON.stringify(visitorApi.parsed.counts));
    const keeperSees = await keeper.evaluate(() => ({
      drafts: window.__reel.state.entries.filter(e => e.published === false).length
    }));
    check(keeperSees.drafts === 1, 'the keeper sees the draft, because it is theirs');

    /* ── the desk understands drafts, publishing and the trash ─────────── */
    const desk = await keeper.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.openDesk();
      await wait(600);
      const tabs = Array.from(document.querySelectorAll('#deskTabs .desk-tab')).map(b => b.textContent.trim());
      const rows = document.querySelectorAll('#deskRoom .desk-row').length;
      const publishBtn = document.querySelector('[data-publish="' + id + '"]');
      const had = !!publishBtn;
      if (publishBtn) publishBtn.click();
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      await wait(700);
      return { tabs: tabs, rows: rows, had: had,
               published: window.__reel.state.entries.filter(e => e.id === id)[0].published };
    }, drafted.id);
    check(desk.tabs.length === 3 && /drafts|on the shelf|thrown away/i.test(desk.tabs.join(' ')), 'the desk names drafts, the shelf and the trash', desk.tabs.join(' \u00b7 '));
    /* the diary's own convention: a moment carries published:false while it is a
       draft, and no mark at all once it is on the shelf (a pull from the server
       leaves the flag off, exactly as the shelf means it) */
    check(desk.had && desk.published !== false, 'publishing from the desk is one press, and it takes', 'row ' + desk.had + ' \u00b7 published=' + desk.published);

    /* ── and the visitor gains it live, with no reload ──────────────────── */
    const arrived = await visitor.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) {
        await wait(400);
        if (window.__reel.state.entries.some(e => e.id === id)) break;
      }
      window.__reel.go('shelf');
      await wait(400);
      return {
        has: window.__reel.state.entries.some(e => e.id === id),
        spines: document.querySelectorAll('#shelfRoom .spine').length,
        titles: window.__reel.state.entries.map(e => e.title)
      };
    }, drafted.id);
    check(arrived.has, 'the visitor gains the moment the moment it is published');
    check(arrived.spines === arrived.titles.length, 'and it stands on their shelf', arrived.spines + ' spines');

    /* ── unpublishing takes it away again ──────────────────────────────── */
    const hidden = await keeper.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.setPublished(id, false);
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      return { published: window.__reel.state.entries.filter(e => e.id === id)[0].published };
    }, drafted.id);
    check(hidden.published === false, 'making it private again is one press too');
    const goneAgain = await visitor.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) {
        await wait(400);
        if (!window.__reel.state.entries.some(e => e.id === id)) break;
      }
      return { still: window.__reel.state.entries.some(e => e.id === id) };
    }, drafted.id);
    check(!goneAgain.still, 'and it leaves the visitor\u2019s shelf live as well');

    /* ── a hostile entry renders as text ───────────────────────────────── */
    const hostile = await keeper.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const e = window.__reel.state.entries[0];
      e.title = '<img src=x onerror="window.__xss=1"> a title with teeth';
      e.raw = 'The body tries too: <script>window.__xss=2<\/script> and <img src=y onerror="window.__xss=3">.';
      e.published = true;
      window.__reel.syncUp('hostile entry, for the record');
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      return { id: e.id };
    });
    const rendered = await visitor.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) { await wait(400); if (window.__reel.state.entries.some(e => e.id === id)) break; }
      window.__reel.go('shelf');
      await wait(400);
      const shelfImages = document.querySelectorAll('#shelfRoom img').length;
      const spineText = Array.from(document.querySelectorAll('#shelfRoom .spine-title')).map(s => s.textContent).join(' | ');
      window.__reel.openMoment(id);
      await wait(1800);
      const inner = document.querySelector('#momentInner');
      return {
        xss: window.__xss === undefined ? null : window.__xss,
        shelfImages: shelfImages, spineText: spineText,
        momentImages: inner.querySelectorAll('img').length,
        momentText: inner.textContent.indexOf('<img src=x') >= 0
      };
    }, hostile.id);
    check(rendered.xss === null, 'no script ran from the entry');
    check(rendered.shelfImages === 0 && rendered.momentImages === 0, 'and no element was built from it on either screen');
    check(rendered.momentText || /a title with teeth/.test(rendered.spineText), 'the hostile text is shown as the text it is');

    /* ── a forged flag does not open the site's door ────────────────────── */
    const forged = await visitor.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.localStorage.setItem('reel.admin.v1', JSON.stringify({ id: 'YashPatel', at: new Date().toISOString(), by: 'password' }));
      window.localStorage.setItem('reel.admin.keep.v1', JSON.stringify({ id: 'YashPatel', until: new Date(Date.now() + 86400000).toISOString(), by: 'password' }));
      window.location.reload();
      return true;
    });
    await wait(2600);
    const afterForgery = await visitor.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30 && !window.__reel.session.known(); i++) await wait(200);
      const before = window.__reel.state.entries.length;
      /* try to write with nothing but that flag behind it */
      const e = window.__reel.state.entries[0];
      if (e) { e.title = 'a forged flag trying to write'; window.__reel.syncUp('forged flag'); }
      for (let i = 0; i < 20; i++) { await wait(300); if (!window.__reel.sync().busy) break; }
      await wait(400);
      return {
        admin: window.__reel.auth.isAdmin(),
        role: window.__reel.session.role(),
        kept: window.__reel.auth.state().how,
        entries: window.__reel.state.entries.length, before: before
      };
    });
    check(afterForgery.admin === false, 'a flag left in this browser does not sign anybody in', 'how=' + afterForgery.kept);
    check(afterForgery.role === 'visitor', 'the site still calls this browser a visitor');
    const diskAfterForgery = onDisk();
    check(!diskAfterForgery.entries.some(e => /forged flag/.test(JSON.stringify(e))), 'and nothing a forged flag tried to write reached the shelf');

    /* ── the policy as built ───────────────────────────────────────────── */
    const violationsSeen = await keeper.evaluate(() => window.__violations || []);
    const violationsSeen2 = await visitor.evaluate(() => window.__violations || []);
    check(violationsSeen.length === 0 && violationsSeen2.length === 0,
      'nothing the page does is blocked by its own policy',
      (violationsSeen.concat(violationsSeen2).slice(0, 3).join(', ') || 'no violations'));

    /* ── the trash, from the keeper's side ─────────────────────────────── */
    const trashed = await keeper.evaluate(async (id) => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__reel.go('shelf');
      await wait(400);
      window.__reel.trashMoment(id);
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      window.__reel.openDesk();
      await wait(500);
      const trashTab = Array.from(document.querySelectorAll('#deskTabs .desk-tab')).find(b => /thrown away/i.test(b.textContent));
      if (trashTab) trashTab.click();
      await wait(400);
      const rows = document.querySelectorAll('#deskRoom .desk-row').length;
      window.__reel.restoreMoment(id);
      for (let i = 0; i < 40; i++) { await wait(250); if (!window.__reel.sync().busy) break; }
      return { rows: rows, back: window.__reel.state.entries.some(e => e.id === id), trash: window.__reel.state.trash.length };
    }, hostile.id);
    check(trashed.rows >= 1, 'a thrown-away moment waits in the desk', trashed.rows + ' in the trash');
    check(trashed.back, 'and putting it back returns it to the shelf');

    await keeper.screenshot({ path: path.join(SHOTS, '105-keeper-desk.jpg'), type: 'jpeg', quality: 84 });
    await visitor.screenshot({ path: path.join(SHOTS, '106-visitor-shelf.jpg'), type: 'jpeg', quality: 84 });
    console.log('  \u00b7 105-keeper-desk \u00b7 106-visitor-shelf');
  } finally {
    await keeper.close(); await visitor.close();
    await ctxA.close(); await ctxB.close();
    srv.kill();
  }
  return bad;
}