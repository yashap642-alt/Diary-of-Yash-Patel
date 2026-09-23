/* ============================================================================
   Reel — contrast audit of the stylesheet, in both lights.
   Parses the CSS token blocks directly (no browser needed) and asserts:
     - body & secondary text  >= 4.5:1
     - meta / small caps text >= 4.0:1
     - accents as text        >= 4.5:1
     - filled buttons         >= 4.5:1
     - emotion inks (graphics)>= 3.0:1
   Composites translucent surfaces (cards, panes) over their background first.

   Usage:  node test/contrast.test.js        (prints a table, exits 1 on fail)
   ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.css'), 'utf8');

/* ------------------------------------------------------------------ helpers */
function block(selector) {
  const i = css.indexOf(selector + ' {');
  if (i < 0) throw new Error('block not found: ' + selector);
  const j = css.indexOf('}', i);
  return css.slice(i + selector.length + 2, j);
}
function tokens(selector) {
  const out = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  const body = block(selector);
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].trim();
  return out;
}
function parse(color) {
  color = String(color).trim();
  let m = color.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = color.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  throw new Error('cannot parse colour: ' + color);
}
function over(fg, bg) {
  const a = fg.a === undefined ? 1 : fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
function lum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/* ------------------------------------------------------------------- checks */
const THEMES = [
  { name: 'night (reel)', selector: ':root' },
  { name: 'daylight (paper)', selector: 'html[data-theme="paper"]' }
];
let failures = [];
function check(label, fg, bg, min, note) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failures.push(label + ' = ' + r.toFixed(2) + ':1 (needs ' + min + ')');
  console.log('   ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(38) + r.toFixed(2) + ':1'.padEnd(9) + ' min ' + min + (note ? '   ' + note : ''));
}

THEMES.forEach(theme => {
  const t = tokens(theme.selector);
  const bg0 = parse(t['--bg-0']);
  const card = over(parse(t['--card']), bg0);
  const card2 = over(parse(t['--card-2']), bg0);

  console.log('\n' + theme.name.toUpperCase());
  console.log('   surfaces: bg ' + hex(bg0) + ' · card ' + hex(card) + ' · card-2 ' + hex(card2));

  console.log('   — text on page —');
  check('--ink', parse(t['--ink']), bg0, 7);
  check('--ink-2', parse(t['--ink-2']), bg0, 4.5);
  check('--ink-3 (labels, eyebrows)', parse(t['--ink-3']), bg0, 4.5);
  check('--ink-4 (meta, counters)', parse(t['--ink-4']), bg0, 4.0);
  check('--accent (as text)', parse(t['--accent']), bg0, 4.5);
  check('--accent-2', parse(t['--accent-2']), bg0, 4.5);

  console.log('   — text on raised surfaces —');
  check('--ink-2 on card', parse(t['--ink-2']), card, 4.5);
  check('--ink-3 on card', parse(t['--ink-3']), card, 4.5);
  check('--ink-4 on card', parse(t['--ink-4']), card, 4.0);
  check('--accent on card', parse(t['--accent']), card, 4.5);
  check('--ink-3 on card-2', parse(t['--ink-3']), card2, 4.5);

  console.log('   — filled controls —');
  check('--on-accent on --accent-solid', parse(t['--on-accent']), parse(t['--accent-solid']), 4.5);
  check('--on-accent on --accent-2', parse(t['--on-accent']), parse(t['--accent-2']), 4.5);
  check('--pink (warning chips)', parse(t['--pink']), card, 4.5);
  check('--green (good chips)', parse(t['--green']), card, 4.5);

  console.log('   — emotion inks (graphics) —');
  ['joy', 'love', 'gratitude', 'pride', 'hope', 'calm', 'sadness', 'longing', 'loneliness', 'anxiety', 'anger', 'shame', 'exhaustion'].forEach(id => {
    const v = t['--e-' + id];
    check('--e-' + id, parse(v), bg0, 3.0);
  });

  console.log('   — structure —');
  const line = parse(t['--line']);
  check('--line (hairlines)', over(line, bg0), bg0, 1.12, 'needs only to be visible');
  const line2 = parse(t['--line-2']);
  check('--line-2 (borders)', over(line2, bg0), bg0, 1.3);
});

/* ── the diary's own paper (cover, foyer, the two squares) ──────────────────
   These are full-screen sheets, so they get their own pass. The two squares sit
   on a translucent card over that sheet, exactly as they do in the app. */
(function paper() {
  /* the paper tokens live in their own :root block further down the sheet */
  const root = (() => {
    const i = css.indexOf('--page-1');
    const open = css.lastIndexOf('{', i);
    const close = css.indexOf('}', i);
    const out = {};
    const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(css.slice(open, close))) !== null) out[m[1]] = m[2].trim();
    return out;
  })();
  const sheet = parse(root['--page-1']);                /* lightest page (top of the gradient) */
  const deeper = parse(root['--page-2']);
  const card = over({ r: 255, g: 253, b: 247, a: 0.66 }, sheet);   /* the square's own fill */
  console.log('\nTHE DIARY PAPER (both lights wash this sheet, so it is audited once)');
  console.log('   surfaces: page ' + hex(sheet) + ' · page (lower) ' + hex(deeper) + ' · square ' + hex(card));
  console.log('   — text on the open page —');
  check('page ink (titles)', parse(root['--page-ink']), sheet, 7);
  check('page ink 2 (body)', parse(root['--page-ink-2']), sheet, 4.5);
  check('page ink 3 (eyebrows, captions)', parse(root['--page-ink-3']), sheet, 4.5);
  check('page ink 3 on the lower page', parse(root['--page-ink-3']), deeper, 4.5);
  console.log('   — text on a square —');
  check('page ink on a square', parse(root['--page-ink']), card, 7);
  check('page ink 2 on a square', parse(root['--page-ink-2']), card, 4.5);
  check('page ink 3 on a square', parse(root['--page-ink-3']), card, 4.5);
  console.log('   — the diary\'s inner page (the ink is literal in the sheet) —');
  check('inside name #3d2e1d', parse('#3d2e1d'), parse('#ece1cc'), 7);
  check('inside line #57432e', parse('#57432e'), parse('#ece1cc'), 4.5);
  check('inside eyebrow #7d6746', parse('#7d6746'), parse('#ece1cc'), 4.0);
})();

console.log('\n' + (failures.length ? 'FAILURES:\n  - ' + failures.join('\n  - ') : 'ALL CONTRAST TARGETS MET'));
process.exit(failures.length ? 1 : 0);
