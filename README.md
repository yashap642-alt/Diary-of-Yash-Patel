# Reel — the diary of Yash Patel

A minimalist, soft-cinematic personal diary that you can **visit**. It opens
like a book, it asks you whether you came to write or to wander, and every
saved moment is a book on a shelf that reopens into the room it happened in.

Inside the writing lab there are still only two sections, nothing else: raw
thoughts on the left, an intelligent reading of them on the right.

`reel-diary.html` is the whole app — one file, no build step, no network calls,
no API keys. Open it in any browser; your entries live in that browser's local
storage and can be exported as JSON at any time.

---

## One link to the whole project

`serve.js` puts everything behind a single address, with no dependencies:

```bash
cd reel && node serve.js          # → http://localhost:8080
```

| Address | What it is |
| --- | --- |
| `/` | the diary itself — the same page as `/diary` |
| `/diary` | the diary itself, the built single-file app |
| `/download` | `reel-diary.html` as a download |
| `/project/…` | every source, test, tool, stylesheet and screenshot, readable in the browser |
| `/project.zip` | the whole repo as a zip — `node_modules`, caches and `.git` left out |
| `/tests` | runs `ui.test.js` and `contrast.test.js` and prints their output |
| `/moments.json` | the published shelf, once `moments.json` sits beside the app |

It binds `0.0.0.0` on `PORT` (8080 by default), so a hosting proxy or a phone on
the same network reaches it just as well as the machine it runs on. On GitHub
you do not need it at all — Pages serves those same files itself; this is for
running the whole thing (public page *and* sources *and* tests) off one URL
without deploying anything.

## The visit — five screens, one diary

| Screen | What it is |
| --- | --- |
| **The cover** | The diary of Yash Patel, closed, with a ribbon in it. Clicking it opens it for real: the cover swings on its hinge, its paper-backed inside comes round, two leaves flick across — and the whole book **travels so that the gutter between its two pages comes to rest exactly on the centre of the screen**, in line with the ruled gutter of the page behind it (measured from the live layout, so it lands on any screen size). It holds open for a beat, hands over to the page, and the two squares are already printed on it. A second click skips the rest. |
| **The foyer** | The two squares, on the open page: **Write something** → the writing lab. **Visit the moments** → the library. |
| **The writing lab** | The two-pane journal: raw dump, live reading, Confirm & Archive. |
| **The library** | Every moment stands as a spine on the shelf it was filed under. Spines are painted with their own atmosphere, sized and tilted by the entry's own hash. Search or filter by shelf. |
| **A moment** | Click a spine: it lifts out of that exact spot on the shelf, grows into a book on the way to the middle of the screen, its cover turns, holds open for a beat, then **dissolves into the story** — a ~0.9 s lift-fade with a breath of blur, never a cut — and the whole background becomes the atmosphere of that entry — gradient, moving weather, a soft stand-in for the place (a window with rain on it, a skyline, a horizon, an arch, a counter edge), and light — with the story laid over it: title, logline, shelves, what it held, the line to remember, and the raw words. Moving to the next moment repaints the room slowly rather than snapping. |

A **back** pill sits top-left on every screen after the cover (the cover is
home) and re-dresses itself for wherever it is — dark glass in the lab, paper
in the foyer, glass over the scene in a moment. Leaving the foyer, the diary
shuts itself again. Preferences for reduced motion are honoured: the flight and the turn are
skipped and the page simply arrives.

### One diary, every screen

Nothing here is a fixed layout that has been shrunk. A single number, `--fit`,
is worked out from the viewport (`min(width/1200, height/900) + 0.12`, clamped
0.62–1.18, with tighter caps for a narrow portrait phone and a short landscape
one) and published on the document. The diary's own cover, every spine on the
shelves, the gaps between them, the shelf boards and the moment page's rhythm
all read it through `calc(… * var(--fit))`, and it is recomputed on resize and
on rotation. Desktop gets 1.12, an iPad 0.97, a phone 0.62 — the same diary,
dressed for the screen it was opened on.

A phone held upright is offered something better: a **premium invitation to turn
the page** — a phone drawing that turns itself a quarter turn every five
seconds, *“Turn the page sideways”*, and a single **read it upright** button. It
appears only on a touch screen in portrait, only on the shelves or inside a
moment, slides up from the foot of the page, never blocks the screen, and gets
out of the way the moment the device turns — or for good, once dismissed.

**The date and time are live.** Every screen that shows them — the cover, the
lab's own header, the shelf — paints the reader's own clock as `23 September
2026 · 14:35` (24-hour, zero-padded), and repaints every fifteen seconds, when
the tab comes back to the front, and when midnight passes under an open diary
(which also re-labels the shelf's "today" grouping).

**Anything that needs the room, scrolls** — every screen is a scroll container:
the lab, the shelves, a moment, the credits, and the cover and foyer too, whose
centring gives way (CSS *safe* centring) so a short window never clips their top
with no way back to it. The credits stop rolling the moment a finger or a wheel
touches them and settle into the page to be read at your own pace, and while the
turn-the-phone card sits at the foot of a screen the content keeps clear of it.

The search box asks for exactly as much as the screen can show, and a phone on
its side folds its chrome away (the shelves become one scrolling row, the
sub-title drops, the paddings close up) so the books stay above the fold.

### Two lights

The palette is traditional first and modern in cut: **midnight indigo** ground
with **brass** light for the night — `#1a1d26 / #20242e / #282d38`, ink
`#f5f0e6`, accent `#ddab61` — and **ivory paper** with **indigo ink**,
**madder** and **teak** for the day — `#e7dfcb / #e1d8c2 / #d7ccb2`, ink
`#212732`, accent `#924520`, oxblood leather on the diary's cover. The night is
no longer black and the day is no longer white; every pair was derived by
walking a colour along its own lightness until it passed, so the contrast is
proven rather than hoped for (68 pairings, all passing, and the audit re-runs in
`test/contrast.test.js`).

### Atmospheres

Fourteen, chosen by the engine from the entry's own signals — night, rain,
dawn, celebration, temple, sea, city, kitchen, rose, moss, paper, ember, snow,
heart — layered over a shelf map → emotion map → time-of-day fallback. Each
carries a palette, a particle type, a line of weather prose and a place:

| Atmosphere | Palette | Particles |
| --- | --- | --- |
| the small hours | `#1b2440 → #293757` · `#e0b877` | stars |
| rain | `#1b2b34 → #263d49` · `#9fc4d6` | rain |
| first light | `#2a1e33 → #3d2937 → #503123` · `#f0b87e` | bokeh |
| celebration | `#2a1d14 → #452d1d` · `#e6bd82` | motes |
| quiet faith | `#241812 → #3b2717` · `#e0ac52` | smoke |
| somewhere else | `#12262c → #1d3d45` · `#84cbd0` | bokeh |
| the city | `#1b2029 → #2b3341` · `#a8b8cc` | dust |
| home | `#241a14 → #3a281a` · `#e0b073` | steam |
| tenderness | `#2a1a24 → #452a3a` · `#eaaebc` | petals |
| growing things | `#18251c → #263a2a` · `#a2cbae` | dust |
| an ordinary day | `#241f19 → #34302a` · `#d3c6ae` | dust |
| heat | `#26170f → #3e2519` · `#e78f5c` | embers |
| cold | `#1c242c → #2c3a47` · `#c2d6e0` | snow |
| ache | `#201a2a → #342a44` · `#c9aede` | dust |

Each room is lifted out of the black it used to sit in — midnight indigo with
brass light, oxblood and teak for the mornings — and every palette is checked
against its own lightest stop: ink ≥ 9.5:1, accent ≥ 4.5:1 — so the story stays
readable inside any room. **There is no vignette anywhere**: not on a scene, not
on the lab's preview, not on the paper. What light there is, is light.

---

## The backend — what actually keeps the moments

**There was none.** Until this round the diary wrote only to the browser that
was using it and read a `moments.json` that nothing could update — which is
exactly why a moment added as keeper showed up on that machine and nowhere
else, and why a deleted one walked back in on the next load. Now there is a
persistence layer, `src/store.js`, with three backs, and every **add, change
and delete** goes through it:

| Back | Where the moments live | Works on | Needs |
| --- | --- | --- | --- |
| **local** | this browser only (the old behaviour, and the default when nothing is configured) | anywhere | nothing |
| **git** | the **GitHub repository itself** — every save is a commit to `moments.json` through the Contents API | GitHub Pages, Vercel, any static host | owner, repo, branch, path and a fine-grained token (`contents: read & write`) |
| **api** | **`/api/moments`** — the site's own endpoint (`api/moments.js`) | Vercel, a VPS, Docker, `node serve.js` | on Vercel: an Upstash/KV store in the environment; on a machine with a disk: nothing |

`auto` (the default) probes `/api/moments` first, then a configured repository,
then falls back to the browser. The keeper chooses in **Keeper → Where it
saves**, which tests the connection and says plainly what it found.

### Which backend, for which deploy

* **GitHub Pages** — static, no server, so use the **git** back. Every save is a
  commit; every visitor's page then reads the committed `moments.json`. This is
  the one to pick if you are deploying the repo to GitHub Pages as-is.
* **Vercel** — `api/moments.js` is deployed automatically as the function
  `/api/moments`, and `vercel.json` points `/diary` at the built page. A
  function's disk is read-only apart from `/tmp`, which is wiped, so the
  endpoint persists to **Upstash Redis / Vercel KV** when
  `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the `UPSTASH_*` names) are in the
  project's Environment Variables. Without them, reads still work from the
  committed `moments.json` and writes are refused with that reason in plain
  words rather than pretending.
* **A machine with a disk** (VPS, Docker, this sandbox, `node serve.js`) — the
  same endpoint persists to `REEL_DATA_FILE` (default `./moments.json`). No
  dependencies, no database.

### Locking the writes

The gate is a **session the server issues**, not a flag in a browser. Sign in at
the keeper's sheet with the ID and the password, then the second factor — a
code from an authenticator app, or a recovery code — and the server answers with
a cookie: `HttpOnly`, `SameSite=Strict`, signed with a secret only the host
knows. Every write needs that cookie, an `x-reel: 1` header and a same-origin
request; anything else is refused with a reason. Five wrong passwords from one
address and the door waits, then waits longer.

None of it is in the page. The page holds no token, no service key, no password;
it asks the server who it is.

| On the host's environment | Why it exists |
| --- | --- |
| `REEL_ADMIN_HASH` | the keeper's password, hashed with scrypt (`node tools/keys.js password "\u2026"`) |
| `REEL_SESSION_SECRET` | signs session cookies (`node tools/keys.js secrets` makes one, with an MFA secret and recovery codes) |
| `REEL_TOTP_SECRET` | the second factor; `node tools/keys.js totp "<secret>"` says what your app should be showing |
| `REEL_RECOVERY_CODES` | comma-separated, hashed at rest, each usable once, for the day the phone is lost |
| `REEL_KEEPER_ID` | defaults to `YashPatel` |
| `REEL_SESSION_EPOCH` | raise the number to end every existing session at once |
| `REEL_DATA_FILE` | where the shelf lives on a machine with a disk (default `./moments.json`) |
| `REEL_BACKUPS_KEPT` | how many snapshots to keep (default 30) |
| `REEL_MAX_BODY`, `REEL_MAX_ENTRIES`, `REEL_LOGIN_MAX`, `REEL_WRITE_MAX`, `REEL_CORS_ORIGIN`, `REEL_COOKIE_NAME`, `REEL_TRUST_PROXY` | the caps, the lockout, and the cases where the site answers to another name |

**With no author configured the endpoint is read-only**: it says so in plain
words and refuses every write, rather than quietly trusting localhost. That is
the right default for a public address, and `node tools/doctor.js` tells you
where you stand before you push.

### What a visitor may read

Only published moments, and nothing else. The server keeps one shelf with
everything on it — drafts, the trash, the audit trail, the snapshots — and
answers a visitor with a **view**: entries that are published and not thrown
away, with no trace of the rest. A draft's words are not in the reply at all,
which is why looking at what the server sends shows nothing.

### Every open device keeps up

The shelf is not a photograph taken at page load. **Every open page asks once a
second whether anything moved**, and the moment you come back to the tab, focus
the window or open a second tab it asks straight away. Add a moment on your phone
and every other open page grows a spine within about a second, with no reload and
no re-deploy. Edit one and the other devices quietly replace the words. Delete
one and it clears from every shelf, the seven sample moments included.

The ask itself is deliberately tiny. `GET /api/moments/version` answers with a
short string, not the shelf:

```json
{ "ok": true, "role": "visitor", "revision": "1x91vyl", "at": "2026-09-23T04:12:07.416Z" }
```

Three things keep that honest and cheap:

* **Only what you can see counts.** A visitor's revision is built from the
  published moments alone, so a draft being written never wakes a reader's page.
  The keeper's revision covers the whole shelf, drafts and trash included.
* **The server answers from a moment of memory.** For a fraction of a second the
  same answer is reused, so a hundred open pages cost one read of the shelf per
  tick rather than a hundred. Every write clears it, so the next second already
  carries the news.
* **Consistency has one door each way.** A moment enters the shelf only through
  **Confirm & Archive** in the writing lab, and leaves it only through the
  delete on a moment opened from the shelf. Both go through the same write path,
  so every device and the backend always agree.

The poll pauses when the tab is hidden and resumes the instant it is looked at
again. It also steps aside while the keeper is mid-edit: a change that arrives
then is remembered and applied the moment the edit finishes, so nothing is ever
pulled out from under his hands.

Two details that used to break exactly this: the sample moments carry **fixed ids
(`seed-1` … `seed-7`)**, so two devices merge them into seven spines instead of
fourteen, and the little `pending` / `published` notes that belong to one browser
are stripped on the way both **out** and **in**, so a moment deleted on your
phone cannot be kept alive by a flag that travelled in the JSON.

**On a metered backend**, a page left open and visible asks 3 600 times an hour.
The answer is tiny and Upstash/Vercel KV bills per command, so if that matters,
slow the poll down from the console of any page — it is remembered in that
browser:

```js
window.__reel.watchEvery(5000)     // ask every five seconds instead
window.__reel.watchEvery(1000)     // and back to the shelf's own cadence
```

### Deploying

Step by step, with the errors people actually hit and their fixes: **[DEPLOY.md](DEPLOY.md)**.
The one that bites first: a host that guesses this is a Vite app runs `vite build`
and dies with `sh: line 1: vite: command not found` (exit 127). The shipped
`vercel.json` — at the project root *and* at the workspace root — carries
`"framework": null` so that guess can never be made again; Settings → Framework
Preset → **Other** does the same in one click.
Before pushing, `node tools/doctor.js` answers "will this deploy work?" in one
screen — the built page, the function, the vercel.json wiring, tokens, and
whether the build would ever try to write outside the project.


```bash
# GitHub Pages (static page + commits through the git back)
git add . && git commit -m "Reel" && git push
# then: Settings → Pages → Deploy from branch → main / root

# Vercel (static page + the /api/moments function)
vercel            # then, in Project → Settings → Environment Variables, add the keeper's
                  # secrets (REEL_ADMIN_HASH, REEL_SESSION_SECRET, REEL_TOTP_SECRET,
                  # REEL_RECOVERY_CODES) and, if you want persistence on Vercel,
                  # KV_REST_API_URL + KV_REST_API_TOKEN
```

The built page is `reel-diary.html` — one file, in the root of the repository,
the only HTML in the project. `vercel.json` rewrites `/` and `/diary` to it, so
visitors get the diary at the bare address; on GitHub Pages, link to
`/reel-diary.html` directly (or rename it to `index.html` on the branch you
serve). `node build.js` writes it and nothing else — no second copy to keep in
step.

## The keeper's lock — who may write

The diary is a reading room for everyone. Nobody needs a key to open it, walk
the shelves, open a moment and read it exactly as it was written.

**Writing is Yash's.** Adding a moment, changing one, deleting one — even
emptying the shelf — goes through one small sheet, and the sheet wants a key:

| Key | What it is |
| --- | --- |
| **ID & password** | `YashPatel` with the keeper's password — both **case sensitive**, so `yashpatel` will not do |
| **PIN** | six digits on their own, for the offline copy, when typing a password on a phone is a nuisance |
| **Second factor** | a six-digit code from an authenticator app, or one of the recovery codes |
| **Mail route** | if the key is lost: a code is made for **yashap642@gmail.com**, mailed from that inbox |

Two locks, and they are not the same lock:

* **On the site**, the authority is the server's session cookie. Nothing in the
  page can mint one: it is signed with `REEL_SESSION_SECRET`, and every write
  re-checks it. Open the console and set whatever you like in `localStorage` —
  the server still answers *not signed in*, the desk stays shut, and nothing
  reaches the shelf. `node test/browser.js security` proves exactly that, in a
  real browser, on purpose.
* **On the offline copy** (a file on a disk, no server anywhere), the verifiers
  in `src/auth.js` are what stands between a visitor and the pencil. They are
  salted PBKDF2-SHA256 hashes, 12 000 rounds, and the password itself appears
  nowhere in the repository — `test/ui.test.js` scans the built file for it.

A session lasts twelve hours of use and never more than seven days. Signing out,
changing the password, or raising `REEL_SESSION_EPOCH` ends every session at
once. Five wrong tries and the wait starts doubling, up to fifteen minutes.

**Changing the shipped key.** The site's password lives on the host, not in the
code:

```bash
cd reel
node tools/keys.js password "a-new-password"    # → REEL_ADMIN_HASH
node tools/keys.js secrets                      # → session secret, MFA secret, recovery codes
node tools/keys.js verifiers "YashPatel" "a-new-password" "971264"   # the offline copy's verifiers
```

Put the first two in the host's environment (Vercel → Settings → Environment
Variables). Paste the `verifiers` block over `DEFAULT_VAULT` in `src/auth.js`
and run `node build.js` only if you want the offline copy's key changed too.

### Publishing a moment to the world

One press. **Confirm & Archive** writes the moment to the shelf; the server
answers every visitor with published moments only, and every open page picks the
change up within a second or two — no reload, no re-deploy. **Private** on the
desk keeps a moment as a draft: yours to see and edit, invisible to everyone
else until you publish it.

The manual road still exists for a host with no server at all (GitHub Pages):
**Export .json** writes the same document, you commit it beside the page, and
every visitor's copy merges it in tagged "published", saying where it came from.
A visitor's own writing stays in their browser and can never leak into the
published diary.

## The writing lab

**Left — raw thought dump.** Paste the unfiltered thing: the ache, the day, the
person, the list, the number you are saving toward. Nothing has to be tidy.
Drafts are kept automatically as you type.

**Right — assessment.** It reads the entry while you write and returns:

| Panel | What it reads |
| --- | --- |
| What is here | Up to three emotions with intensity — Joy, Love, Gratitude, Pride, Hope, Calm, Sadness, Longing, Loneliness, Anxiety, Anger, Shame, Exhaustion |
| Body & mind | Physical signals (sleep, body, movement, food & drink, numbing) and mind-state (focus, fog, overwhelm, overthinking, resolve, stillness) |
| Themes | Work & career, love, family & friends, money, home, health, creative life, study, self, faith, travel, screens |
| Life chapter | A ranked shelf list with fit meters — one **primary folder** plus up to **two cross-links** |
| Titles | Three short-story-style titles with different instincts — cinematic, poetic, plain, tender, wry |
| Cinematic summary | The 1–2 sentence logline that captures the exact feeling of the moment (editable) |
| Refine | Free-text instructions — *“more poetic”*, *“shorter”*, *“put it in Career Crossroads”* |
| Confirm & Archive | One button. Saves everything. |

**Wishes & Tangible Dreams.** When an entry is a wish, the reading switches
mode: the summary becomes a **clean to-the-point list of items to acquire**
(with quantities and purpose clauses intact — e.g. *“3 matching blazer suits for
the trio + coordinated outfits for our partners + good camera”*), it keeps the
**line to remember** from the original raw story so the emotion survives, and it
files itself on the Wishes shelf with up to two cross-links.

**The shelves.** Wishes & Tangible Dreams · Moments of Joy · Heartbreak &
Healing · Love & People · Career Crossroads · Quiet Dreams · Daily Struggles ·
Body, Mind & Health · Money & Nest · Self & Becoming. The engine proposes; you
decide. Click any folder to make it primary, cross-link up to two more.

**Archive.** Shelves with live counts, full-text search, entry cards showing date,
titles, emotion dots and folder pills.

**Reading a saved page.** A curtain wipe, the title rising letter by letter, the
logline typed out, then the placement, emotions, the wish list, the line to
remember, the alternate titles it could have worn, and the raw text exactly as
you wrote it. ← earlier / later → to walk the reel, ↻ replay the moment to watch
it again.

**Leaving.** *Exit* rolls the closing credits of your own archive — entries kept,
words written, wishes with prices on them, folder breakdown — then dissolves to
black. *Close the reel* fades the app away with a soft white flash; *Stay a while
longer* puts you back on the page.

**Two lights — measured, not guessed.** ◐ toggles:
- **Night (reel)** — near-black, warm amber accents, liftable quiet greys, film
  grain and a heavy vignette.
- **Daylight (paper)** — warm cream paper with soft peach/sage/rose washes, deep
  espresso ink, and a **bronze** accent (not the dark mode's pale gold, which
  washes out on light). Filled buttons flip to white-on-bronze; the grain drops
  to almost nothing and the vignette to a whisper.

Every colour pair is asserted in CI rather than eyeballed (`test/contrast.test.js`),
including translucent cards composited over their background:

| Pair | Night | Daylight | Target |
| --- | --- | --- | --- |
| body ink | 16.2:1 | 15.1:1 | ≥ 7 |
| secondary text | 11.2:1 | 9.4:1 | ≥ 4.5 |
| labels & eyebrows | 5.3:1 | 5.3:1 | ≥ 4.5 |
| meta / counters | 5.2:1 | 4.6:1 | ≥ 4.0 |
| accent as text | 10.5:1 | 4.7:1 | ≥ 4.5 |
| filled button label | 9.2:1 | 5.7:1 | ≥ 4.5 |
| emotion inks (worst) | 4.6:1 | 3.8:1 | ≥ 3.0 |

Emotion colours are theme-aware custom properties (`--e-joy` … `--e-exhaustion`),
so every bar, dot and chip re-tints between lights — the amber of Joy becomes a
deep ochre on paper, the rose of Love darkens to stay readable rather than
floating away.

---

## How the intelligence works

Everything runs locally in the browser — `src/engine.js` is a dependency-free,
deterministic analyser (~1,000 lines of lexicons and scoring). It is not a neural
network; it is a careful reader:

1. **Lexicon scan with morphology.** ~500 weighted signal terms per category,
   matched with plural/verb-form variants, so *worried / worrying / worries* all
   land, and *dreads* doesn't hide from *dread*.
2. **Negation damping.** *“I am not happy”* scores Joy at 25%, not 100%.
3. **Relative emotions.** Intensity is normalised against the strongest emotion
   in that entry, so a 100% Sadness means “dominant here”, not “big in absolute”.
4. **Physical & mental weighting.** Not all body lines are equal: a headache
   outweighs a cup of chai, and a joy-only entry doesn't get filed under Health.
5. **Shelf scoring with an evidence guard.** Emotions, themes, entity signals and
   wish-strength are combined per shelf; the top score is the primary folder and
   cross-links need a real score floor, so they stay meaningful. A shelf also has
   to be *supported by evidence it claims* — a gratitude entry is never offered
   "Heartbreak & Healing" just because it mentioned people, and a heavy work day
   is never filed under romance.
6. **Wish extraction.** Quantity + adjectives on the left, the item, attached
   model/set nouns (`Kindle Paperwhite`), proper nouns (`Leh trip`), and a short
   purpose clause on the right (`for the trio`) — then deduplicated longest-first.
   A wish needs a real cue (*want, need, saving up for, also want…*) or a bulleted
   list, so *“I bought a coffee”* and *“he is saving me a seat”* don't become
   wishing entries.
7. **Narrative generation.** Nine title banks across five moods and a wish bank;
   titles are seeded-shuffled, clash-filtered and concept-driven, so the three
   options never restate each other. Loglines are drawn from templates keyed to
   the strongest shelf.

Deterministic: the same words always produce the same reading (until you ask for
other angles).

---

## Privacy

Nothing is loaded from anywhere: no fonts, no scripts, no telemetry, no
analytics, no cookies that are not the keeper's own session. With no backend
configured the diary is entirely local, and then "no servers, no accounts" is
literally true — entries live in `localStorage` on your device, and *Export
.json* is how you carry them somewhere else.

Configure a backend and one thing changes, by design: moments you have
**published** are stored on your own server (a JSON file on a machine with a
disk, a key/value store on Vercel, or a commit to your own repository) and are
readable by anyone with the link. Drafts are not. They sit in the same shelf,
and the server is what decides who may see them: a visitor's reply does not
contain them at all. Deleting a moment marks it thrown away rather than erasing
the words — the trash is yours, the snapshots are yours, and *burn* in the desk
is the one action that removes the words for good.

## Moving an old shelf in, and getting it back

A shelf written before this round is upgraded in place, and never loses a word:

```bash
cd reel
node tools/migrate.js --dry-run            # say what would change, write nothing
node tools/migrate.js                      # copy it aside, then upgrade it
node tools/restore.js                      # list the snapshots that exist
node tools/restore.js --latest --yes       # put the newest one back
```

The migration reads every moment through the same validation the server uses, so
anything that would be refused at the door is repaired here instead: an entry
that never said whether it was published is treated as published (that is what
was public before), an id that could break a page is replaced rather than thrown
away with the moment it belongs to, and the shelf you had is copied into
`backups/` first. `test/tools.test.js` runs all of that against a real file.

Every write the site makes takes a snapshot before it happens, and the newest
`REEL_BACKUPS_KEPT` (30, or 12 in the tests) are kept. Restoring is itself a
write, so the shelf being replaced is copied aside too: nothing is ever the only
place a moment lives.

## Files

```
reel-diary.html      the diary — the one built page. Open it, or point a host at it
build.js            inlines the engine, the locks, the interface and the styling into that one file
serve.js            the whole project on one link: the diary, the sources, a zip, /api/moments
src/engine.js       the analyser (pure logic, also runnable under Node)
src/app.js          interface behaviour
src/ui.css          the soft-cinematic styling
src/auth.js         the offline lock: PBKDF2 verifiers, sessions, the mail route
src/session.js      the site's door: sign in, the second factor, who am I
src/store.js        the three backs — browser, GitHub repository, site endpoint
src/shell.html      page skeleton with build placeholders
api/moments.js      the endpoint: sessions, scrypt, TOTP, published-only reads,
                    snapshots, validation, rate limiting, a KV store or a file
tools/keys.js       password hashes, a session secret, an MFA secret, recovery codes, verifiers
tools/migrate.js    upgrade an older shelf without losing a word
tools/restore.js    list snapshots and put one back
tools/doctor.js     answers "will this deploy work?" before you push
tools/rig.sh        sets up puppeteer + Chrome (+ the X/NSS libs on a bare container)
test/ui.test.js       jsdom: the whole journey, fitting, scrolling, the keeper's lock
test/contrast.test.js contrast audit of the stylesheet in both lights
test/security.test.js the server itself, over HTTP: 85 checks
test/tools.test.js    migration and restore, against real files
test/browser.js       real Chrome: centre, dissolve, stress, fit, scroll, admin, publish,
                      backend, live, security, reduced, shots
test/try.js         engine walk-through across sample entries
shots/              twenty screenshots of the journey, both lights, phones both ways
docs/SUPABASE.md    when a Postgres home is worth it, and what it costs
supabase/schema.sql that home's tables and row-level rules
README.md DEPLOY.md SECURITY-AUDIT.md   this file, the deploy steps, the audit
package.json vercel.json                the scripts, and how a host should build
```

Rebuild after editing sources:

```bash
cd reel && node build.js
node test/ui.test.js        # interface behaviour (cover → foyer → lab/library → moment → back)
node test/contrast.test.js  # both lights, every ink/accent pair
node test/security.test.js  # the server over HTTP: sessions, MFA, drafts, ids, the limits
node test/tools.test.js     # migrating an older shelf, and restoring one
node test/try.js            # engine readings
node tools/doctor.js        # will this deploy work?
node test/browser.js all    # the parts jsdom cannot see, in real Chrome:
                            #   centre   — the opened diary's gutter sits on screen centre
                            #   dissolve — the library book melts, never blinks out
                            #   stress   — 14 rapid navigations leave nothing stuck
                            #   scroll   — every screen reaches its own first and last line
                            #   admin    — a visitor can read but not write; the keeper can do both
                            #   publish  — a committed moments.json reaches a visitor's shelf
                            #   backend  — add/change/delete survive a reload through the site's
                            #              endpoint AND through a mocked GitHub repository
                            #   fit      — desktop/tablet/phone(either way) each get their own
                            #              layout, the invitation appears only in portrait
                            #   live     — two devices, one shelf: add, change, delete, no reload
                            #   security — a draft a stranger cannot see, a forged flag that
                            #              unlocks nothing, hostile text that stays text, and
                            #              the page's own policy blocking nothing it needs
                            #   reduced  — prefers-reduced-motion path
                            #   shots    — refresh shots/
                            # needs Chrome (REEL_CHROME / PUPPETEER_CACHE_DIR); on a bare
                            # container point LD_LIBRARY_PATH at the extracted X/NSS libs
```
