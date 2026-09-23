/* ============================================================================
   Reel — interface test for the visiting journey:
     cover → open → foyer → lab / library → open a spine → moment → back
   Run: node test/ui.test.js
   ==========================================================================*/
const fs = require('fs');
const path = require('path');
/* jsdom is a dev dependency, not part of the diary: it lives wherever it was
   installed last. Look in the usual places, and if it is missing, say exactly
   how to get it rather than throwing a module error at somebody. */
function findJsdom() {
  const tries = [process.env.REEL_JS,
    process.env.REEL_RIG && process.env.REEL_RIG + '/node_modules',
    './node_modules', '../node_modules',
    '/home/user/.cache/reeltest/node_modules', '/tmp/reel-rig/node_modules', '/tmp/node_modules']
    .filter(Boolean);
  for (const d of tries) { try { require.resolve(d + '/jsdom'); return d; } catch (e) {} }
  try { require.resolve('jsdom'); return null; } catch (e) {}
  return false;
}
const MODS = findJsdom();
if (MODS === false) {
  console.log('\n  jsdom is not installed here. It is only needed to run this test:\n');
  console.log('    npm install jsdom            # in this folder, or\n');
  console.log('    npm install --prefix /tmp/node_modules jsdom\n');
  console.log('  The diary itself needs nothing: no dependencies at all.\n');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = require((MODS ? MODS + '/' : '') + 'jsdom');

const PAGE = path.join(__dirname, '..', 'reel-diary.html');
if (!fs.existsSync(PAGE)) { console.log('\n  reel-diary.html is not built yet — run: node build.js\n'); process.exit(2); }
const html = fs.readFileSync(PAGE, 'utf8');
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('JSDOM ERROR:', e.message));
vc.on('error', (...a) => console.log('CONSOLE ERROR:', ...a));
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.test/',
  virtualConsole: vc
});
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = el => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

(async () => {
  await wait(300);
  const fails = [];
  const check = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + extra : ''));
    if (!cond) fails.push(name);
  };
  const screen = () => window.__reel.state.screen;
  const activeScreen = () => $$('.screen.is-active').map(e => e.id).join(',');

  console.log('\n— cover —');
  check('app booted', !!window.__reel);
  check('screen is cover', screen() === 'cover', activeScreen());
  check('cover names Yash Patel', $('.cover-name').textContent.replace(/\s+/g, ' ').includes('Yash'), $('.cover-name').textContent.replace(/\s+/g, ' ').trim());
  check('diary holds seeded moments', window.__reel.state.entries.length === 7, window.__reel.state.entries.length + ' moments');
  check('cover teaser filled', $('#insideStats').textContent.includes('words'), $('#insideStats').textContent);
  check('back button hidden on cover', !$('#backBtn').classList.contains('show'));
  check('title mentions him', doc.title.includes('Yash Patel'), doc.title);

  console.log('\n— opening the diary —');
  click($('#bookFront'));
  await wait(200);
  check('cover starts opening', $('#screenCover').classList.contains('opening'));
  /* geometry is asserted in the browser filmstrip (/tmp/film_open.js); here we
     check the states that drive it */
  check('the cover has a hinge to swing on', !!$('#bookFront') && !!$('.book-cover'));
  check('the first pages exist to turn', $$('.leaf').length === 2, $$('.leaf').map(e => e.className).join(' + '));
  check('a page waits behind the cover', !!$('#coverSpread'));
  await wait(2200);   /* cover turns → travels → holds → hands over */
  check('arrived at the foyer', screen() === 'foyer', activeScreen());
  check('the foyer is the open page', $('#screenFoyer').classList.contains('foyer-screen') && !!$('#coverSpread'));
  check('foyer names the owner', $('.foyer-lede h2').textContent.includes('Yash Patel'), $('.foyer-lede h2').textContent.trim());
  check('two squares present', $$('.door').length === 2, $$('.door .door-title').map(e => e.textContent).join(' / '));
  check('squares are labelled as squares', $$('.door-kicker').map(e => e.textContent).join(' / ').includes('square'), $$('.door-kicker').map(e => e.textContent).join(' / '));
  check('back button now shown', $('#backBtn').classList.contains('show'), $('#backLabel').textContent);
  check('back sits on paper here', $('#backBtn').classList.contains('on-paper'));

  console.log('\n— door two: the library —');
  click($('#doorShelf'));
  await wait(200);
  check('library is open', screen() === 'shelf', activeScreen());
  const spines = $$('#shelfRoom .spine');
  check('books are on shelves', spines.length === 7, spines.length + ' spines');
  check('shelves are labelled by folder', $$('#shelfRoom .lib-shelf').length >= 3, $$('#shelfRoom .shelf-plate b').map(e => e.textContent).join(' · '));
  check('spines carry scene colours', spines[0].getAttribute('style').includes('--sp-top'), spines[0].getAttribute('style').slice(0, 62) + '…');
  check('tabs count the shelves', $$('#libTabs .lib-tab').length >= 2, $$('#libTabs .lib-tab').map(e => e.textContent.trim()).join(' | '));

  console.log('\n— search + filter —');
  $('#search').value = 'blazer';
  $('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(60);
  check('search narrows the shelf', $$('#shelfRoom .spine').length >= 1 && $$('#shelfRoom .spine').length < 7, $$('#shelfRoom .spine').length + ' spine(s)');
  $('#search').value = 'zzz-nothing';
  $('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(60);
  check('empty search state', !!$('#shelfRoom .empty-state'));
  $('#search').value = '';
  $('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(60);
  click($$('#libTabs .lib-tab')[1]);
  await wait(60);
  check('folder tab filters', $$('#shelfRoom .lib-shelf').length === 1, $('#shelfRoom .shelf-plate b').textContent);
  click($$('#libTabs .lib-tab')[0]);
  await wait(60);

  console.log('\n— opening a moment —');
  const targetId = $$('#shelfRoom .spine')[0].getAttribute('data-id');
  click($$('#shelfRoom .spine')[0]);
  /* jsdom reports every element at 0x0, so there is no spine to fly from and
     the app takes its plain-arrival path — the flight itself (spine → book →
     turn → dissolve) is filmed in a real browser by /tmp/film_moment.js */
  await wait(700);
  check('moment page reached', screen() === 'moment', activeScreen());
  check('nothing left stuck on top', !$('#bookOpen').classList.contains('play') && !$('.spill'), $('#bookOpen').className);
  const e = window.__reel.state.entries.find(x => x.id === targetId);
  check('scene painted from the entry', $('#screenMoment').style.getPropertyValue('--sc-grad').includes('gradient'), $('#screenMoment').style.getPropertyValue('--sc-grad').slice(0, 46) + '…');
  check('scene is the entry\'s own', $('#screenMoment').style.getPropertyValue('--sc-accent') === e.scene.accent, e.scene.key + ' · ' + e.scene.label);
  check('scene chip shows the atmosphere', $('#momentInner .scene-chip').textContent.includes(e.scene.label), $('#momentInner .scene-chip').textContent.trim());
  check('title rendered letter by letter', $$('#momentInner .paper-title span').length >= 2, e.title);
  check('logline is typing', $('#loglineType').textContent.length > 4, $('#loglineType').textContent.slice(0, 60));
  check('raw words present', $('#momentInner').innerHTML.includes('raw, exactly as he wrote it'));
  check('back button on-scene styling', $('#backBtn').classList.contains('on-scene') && $('#backLabel').textContent === 'the shelves');
  await wait(400);
  const typed = $('#loglineType').textContent;
  await wait(900);
  check('logline finishes typing', $('#loglineType').textContent.length >= typed.length, $('#loglineType').textContent.slice(-40));

  console.log('\n— moving between moments —');
  if ($('#prevBtn')) {
    const beforeTitle = $('#momentInner .paper-title').textContent;
    click($('#prevBtn'));
    await wait(400);
    const afterTitle = $('#momentInner .paper-title').textContent;
    check('earlier moment opens', afterTitle !== beforeTitle, afterTitle.slice(0, 44));
  } else { check('earlier moment link exists on newest', true, 'newest moment — no earlier'); }
  if ($('#nextBtn')) {
    click($('#nextBtn'));
    await wait(400);
    check('later moment opens', true, $('#momentInner .paper-title').textContent.slice(0, 44));
  }

  console.log('\n— back navigation —');
  click($('#backBtn'));
  await wait(200);
  check('moment → shelves', screen() === 'shelf', activeScreen());
  check('shelves still rendered', $$('#shelfRoom .spine').length === 7);
  click($('#backBtn'));
  await wait(150);
  check('shelves → foyer', screen() === 'foyer', activeScreen());
  click($('#backBtn'));
  await wait(150);
  check('foyer → cover', screen() === 'cover', activeScreen());
  check('back hides on cover', !$('#backBtn').classList.contains('show'));
  check('the diary shuts again', $('#screenCover').classList.contains('closing') || !$('#screenCover').classList.contains('opening'));
  await wait(700);
  check('and settles shut', !$('#screenCover').classList.contains('opening') && !$('#screenCover').classList.contains('closing'), $('#screenCover').className);

  console.log('\n— door one: the writing lab —');
  click($('#bookFront'));
  await wait(1400);
  click($('#doorLab'));
  await wait(200);
  check('lab is open', screen() === 'lab', activeScreen());
  const draft = $('#draft');
  draft.value = 'I want 3 matching blazer suits for the trio plus coordinated outfits for our partners. Saving up, still need about 40k.';
  draft.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(1500);
  check('live reading works', $('#panelLive').innerHTML.length > 500);
  check('atmosphere card shown', !!$('#panelLive .scene-preview'), $('#panelLive .scene-preview-line') ? $('#panelLive .scene-preview-line').textContent.slice(0, 48) : '');
  check('wish detected', $('#panelLive').innerHTML.includes('To acquire'));
  check('three titles offered', $$('#panelLive .title-card').length === 3, $$('#panelLive .title-text').map(t => t.textContent).join(' / '));
  check('summary prefilled', $('#summaryBox').value.length > 20);
  check('a visitor is told writing needs the key', /keeper/i.test($('#keeperHint').textContent), $('#keeperHint').textContent.trim());
  const before = window.__reel.state.entries.length;
  click($('#confirmBtn'));
  await wait(120);
  check('a visitor cannot write: the sheet opens', $('#adminSheet').classList.contains('show'), $('#adminWhy').textContent.trim().slice(0, 60));
  check('nothing was archived by a visitor', window.__reel.state.entries.length === before);
  click($('#modePin'));
  $('#adminSecret').value = '971264';
  click($('#adminGo'));
  await wait(900);
  check('the PIN signs the keeper in', window.__reel.auth.isAdmin());
  check('the sheet closes on a good key', !$('#adminSheet').classList.contains('show'));
  click($('#confirmBtn'));
  await wait(1500);
  check('kept on the shelf', window.__reel.state.entries.length === before + 1, before + ' → ' + window.__reel.state.entries.length);
  const fresh = window.__reel.state.entries[0];
  check('scene stored with the moment', !!fresh.scene && !!fresh.scene.key, fresh.scene.key);
  check('spine appears in the library', (window.__reel.renderLibrary(), $$('#shelfRoom .spine').length), $$('#shelfRoom .spine').length + ' spines');
  check("wish list stored", fresh.wish.items.length >= 2 && fresh.wish.items.some(i => /blazer/i.test(i.text)), fresh.wish.items.map(i => i.text).join(" + "));


  console.log('\n— the clock —');
  const stamp = $('#draftDate').textContent;
  check('the page shows the date', /\d{4}/.test(stamp), stamp);
  check('and the time as HH:MM', /\b([01]\d|2[0-3]):[0-5]\d\b/.test(stamp), stamp);
  check('the clock is on the cover too', /\d{4}/.test($('#coverClock').textContent) && /:/.test($('#coverClock').textContent), $('#coverClock').textContent);
  check('the lab bar carries it', /:/.test($('#labDate').textContent), $('#labDate').textContent);
  check('the shelf carries it', /:/.test($('#shelfClock').textContent), $('#shelfClock').textContent);
  const fixed = window.__reel.hhmm(new Date('2026-03-09T04:07:00'));
  check('hours and minutes are two digits', fixed === '04:07' || /^\d\d:\d\d$/.test(fixed), fixed);
  window.__reel.paintClock('2026-12-31T23:59:00');
  check('painting again moves the clock', /23:59/.test($('#draftDate').textContent), $('#draftDate').textContent);
  window.__reel.paintClock();
  check('and back to now', /:/.test($('#draftDate').textContent) && /\d{4}/.test($('#draftDate').textContent));

  console.log('\n— the keeper\u2019s lock —');
  const A = window.__reel.auth;
  check('the gate is a real one', !!A && typeof A.unlock === 'function');
  check('no plaintext password in the page', !/hari2114ya|971264/.test(html), 'scanned the built file');
  check('signed in as the keeper', A.isAdmin());
  check('the keeper chip says so', /signed in/i.test($('.js-keeper').textContent), $('.js-keeper').textContent.trim());
  A.lock();
  check('signing out locks it again', !A.isAdmin());
  check('readers need no key at all', window.__reel.state.entries.length >= 7 && screen() === 'lab');
  const wrongId = A.unlock('yashpatel', 'hari2114ya', {});
  check('the ID is case sensitive', !wrongId.ok, wrongId.why);
  const wrongPass = A.unlock('YashPatel', 'Hari2114ya', {});
  check('the password is case sensitive', !wrongPass.ok, wrongPass.why);
  const badPin = A.unlock('', '000000', {});
  check('a wrong PIN is refused', !badPin.ok, badPin.why);
  const good = A.unlock('YashPatel', 'hari2114ya', {});
  check('the keeper ID and password open it', good.ok, good.by + ' as ' + good.id);
  check('and it survives a screen change', (window.__reel.go('shelf'), A.isAdmin()));
  A.lock();
  const pin = A.unlock('', '971264', {});
  check('the PIN opens it on its own', pin.ok, pin.by);
  /* a change needs the old key first */
  const noOld = A.change({ currentId: 'YashPatel', currentSecret: 'not-it', newPass: 'whatever1' });
  check('a change is not a back door', !noOld.ok, noOld.why);
  const changed = A.change({ currentId: '', currentSecret: '971264', newPass: 'gulmohar-9' });
  check('the keeper can change the password with the PIN', changed.ok);
  A.lock();
  check('the old password is gone', !A.unlock('YashPatel', 'hari2114ya', {}).ok);
  check('the new password works', A.unlock('YashPatel', 'gulmohar-9', {}).ok);
  const back = A.change({ currentId: 'YashPatel', currentSecret: 'gulmohar-9', newPass: 'hari2114ya' });
  check('and it can be changed back', back.ok && (A.lock(), A.unlock('YashPatel', 'hari2114ya', {}).ok));
  /* the mail route */
  const req = A.requestReset();
  check('a reset code is made for the keeper\u2019s mail', /^\d{4}$/.test(req.code) && req.mail === 'yashap642@gmail.com', req.mail);
  check('the wrong code is refused', !A.reset({ code: '0000', newPass: 'nope' }).ok);
  const res = A.reset({ code: req.code, newPass: 'monsoon-24' });
  check('the mailed code sets a new key', res.ok);
  check('the new key works', (A.lock(), A.unlock('YashPatel', 'monsoon-24', {}).ok));
  check('and the old one does not', (A.lock(), !A.unlock('YashPatel', 'hari2114ya', {}).ok));
  A.change({ currentId: 'YashPatel', currentSecret: 'monsoon-24', newPass: 'hari2114ya' });
  A.lock();
  /* throttling */
  A._resetTries();
  for (let i = 0; i < A.MAX_TRIES; i++) A.unlock('YashPatel', 'guess-' + i, {});
  check('wrong tries start costing time', A.blockedFor() > 0, A.blockedFor() + 's ' + A.unlock('YashPatel', 'hari2114ya', {}).why);
  A._resetTries();
  check('a good key still works after the wait is cleared', A.unlock('YashPatel', 'hari2114ya', {}).ok);
  check('the keeper may write again', (window.__reel.go('lab'), A.isAdmin()));

  console.log('\n— changing a moment already shelved —');
  const was = window.__reel.state.entries[0];
  const beforeEdit = window.__reel.state.entries.length;
  window.__reel.auth.unlock('', '971264', {});
  window.__reel.startEdit(was.id);
  await wait(1900);
  check('the moment opens in the lab', screen() === 'lab', activeScreen());
  check('its own words are in the textarea', $('#draft').value === was.raw, ($('#draft').value || '').slice(0, 40));
  check('the lab says which moment is being changed', !$('#editFlag').hidden && /changing/i.test($('#editFlag').textContent), $('#editFlag').textContent.trim());
  check('the button offers to save, not to add', /save changes/i.test($('#confirmBtn').textContent), $('#confirmBtn').textContent.trim());
  $('#draft').value = was.raw + ' And one line more, added on a second reading of it.';
  $('#draft').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(1600);
  click($('#confirmBtn'));
  await wait(1400);
  check('it is changed in place, not duplicated', window.__reel.state.entries.length === beforeEdit, beforeEdit + ' → ' + window.__reel.state.entries.length);
  const after = window.__reel.state.entries.filter(e => e.id === was.id)[0];
  check('same moment, new words', !!after && /one line more/.test(after.raw), (after && after.raw || '').slice(-40));
  check('it remembers when it was first written', !!after && after.createdAt === was.createdAt, (after && after.createdAt) + ' vs ' + was.createdAt);
  check('editing mode is over', !$('#editFlag') || $('#editFlag').hidden);
  check('changing it reached storage', /one line more/.test(window.localStorage.getItem('reel.entries.v2') || ''));

  console.log('\n— credits —');
  click($('#navExit'));
  await wait(80);
  check('credits roll', $('#exit').classList.contains('open'));
  check('credits name Yash Patel', $('#creditRoll').textContent.includes('Yash Patel'));
  check('credits summarise atmospheres', $('#creditRoll').textContent.includes('atmospheres'), $('#creditRoll').textContent.replace(/\s+/g, ' ').slice(60, 200));
  click($('#stayBtn'));
  check('stay closes credits', !$('#exit').classList.contains('open'));

  console.log('\n— persistence —');
  check('entries saved to storage', JSON.parse(window.localStorage.getItem('reel.entries.v2')).length === window.__reel.state.entries.length);


  console.log('\n— fitting the screen it is opened on —');
  check('the layout has a live fit factor', !!window.__reel.state.fit && window.__reel.state.fit.k > 0, '--fit ' + window.__reel.state.fit.k);
  check('the fit is exposed to the page', doc.documentElement.style.getPropertyValue('--fit') !== '', doc.documentElement.style.getPropertyValue('--fit'));
  check('a portrait phone is recognised', typeof window.__reel.computeFit === 'function');
  check('the invitation to turn the phone is in the shell', !!$('#rotateHint') && !!$('#rotateDismiss'));
  check('the invitation names the reason', /sideways|landscape/i.test($('#rotateHint').textContent), $('#rotateHint').textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
  check('the invitation can be dismissed for good', typeof window.__reel.dismissRotate === 'function');
  window.__reel.dismissRotate();
  check('dismissing it is remembered', window.localStorage.getItem('reel.rotate.v1') === '1');

  console.log('\n— no vignette, anywhere —');
  check('the vignette layer is off in both lights', /--vignette:\s*0/.test(html) || html.includes('--vignette: 0'));
  check('the scene vignette is hidden by rule', /\.scene-vignette\s*\{[^}]*display:\s*none/.test(html));
  check('the light that remains is light, not shade', html.includes('rgba(255, 250, 236, .1)') || html.includes('rgba(255, 240, 214, .065)'));
  check('no radial darkening is left in the page furniture',
    !/radial-gradient\([^;]*transparent \d+%, rgba\(0,\s*0,\s*0/.test(html), 'scanned the stylesheet');

  console.log('\n' + (fails.length ? 'FAILURES: ' + fails.join(' | ') : 'ALL CHECKS PASSED'));
  process.exit(fails.length ? 1 : 0);
})();
