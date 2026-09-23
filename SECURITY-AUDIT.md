# Security audit — Diary of Yash Patel ("Reel")

**Scope reviewed:** `api/moments.js`, `src/store.js`, `src/auth.js`, `src/app.js`,
`src/shell.html`, `serve.js`, `build.js`, `vercel.json` (both roots), `tools/`,
`test/`. Everything below was read in the code and confirmed by a test unless
marked otherwise.

**Bottom line.** The diary's *front of house* is in good shape: escaping is
disciplined, there is no `eval`, no inline event handlers, no dependency tree,
and no secret is written into the source. The problems are all behind the
curtain: **there is no server-side notion of an author**, **there is no draft /
published boundary**, so every memory is public the moment it is saved, and
**there is no backup**, so one bad save is final. Those three are fixed in this
round. A managed database (Supabase) is *not* required to fix them, and section
F explains why, with the schema and policies included for the case where you
want it later.

---

## A. The architecture as it actually is

| Layer | Reality |
| --- | --- |
| Page | one built HTML file (`reel-diary.html`, ~300 KB) with the engine, the lock and the store inlined at build time; a static file with no server logic of its own |
| Reads | `GET /api/moments` (Vercel function or `serve.js`) → KV, else a JSON file, else the browser; a static `moments.json` fallback |
| Writes | `PUT /api/moments` with `Authorization: Bearer <REEL_ADMIN_TOKEN>`, or a commit to the repo through the GitHub Contents API (token held in the browser) |
| Author identity | `src/auth.js` — PBKDF2 verifiers in `localStorage`; a flag in `localStorage` says "keeper" |
| Data | one JSON document, `{app, version, owner, savedAt, shelves, entries[]}`, two versions old |
| Deletion | hard delete from the array |
| Backups | none |

## B. Findings

### CRITICAL 1 — Every memory is public, including the ones you have not published

**Evidence** `api/moments.js:99-107` returns the whole stored document to any
caller. There is no `published` field anywhere in the data model
(`src/app.js` `buildEntry`, line 1335 onward), and the public page renders every
entry it receives (`src/app.js:1517` shelves, `1577` moment page).

**Consequence** The moment you write a memory it is world-readable, in draft or
not, on the shelf and in `moments.json`, and on GitHub Pages the raw JSON is a
URL a stranger can open. Anything you wrote and hesitated over is already out.

**Remediation** `published` and `deletedAt` on every entry; the public read path
filters to `published && !deletedAt` **on the server**, so an unpublished memory
never reaches a visitor's browser at all. The keeper's own read (valid session)
returns everything. Implemented in the new `api/moments.js`; tested in
`test/security.test.js` (the draft's own words are asserted to be *absent* from
the visitor's response body).

### CRITICAL 2 — The author's authority lives in the browser

**Evidence** `src/auth.js:26-42`: the verifiers and the "I am the keeper" flag
both live in `localStorage` (`reel.vault.v1`, `reel.admin.v1`,
`reel.admin.keep.v1`). A visitor can open devtools, set that flag, and the
interface treats them as you. The server gate is a single static string,
`REEL_ADMIN_TOKEN`, compared in `api/moments.js:67-72`, and that token is held
in the browser in plain `localStorage` (`src/store.js:29-30`, `117`).

**Consequence** The lock protects nothing that a curious visitor cannot undo in
ten seconds, and the credential that *does* gate the server never expires, has
no identity attached, cannot be revoked, is shared with every device, and is
readable by any script that ever runs on the page. There is no audit trail of
who wrote what.

**Remediation** Server-side sessions: `POST /api/session` verifies the password
against a scrypt hash held **only** in the server environment, then sets an
`HttpOnly`, `SameSite=Strict` cookie carrying an HMAC-signed, expiring token
(12 h, renewed on use, 7 days maximum) with a session epoch for "sign out
everywhere". Every write is authorized against that session on the server. The
local PBKDF2 lock is kept, but demoted to what it honestly is: an offline
convenience lock for the no-backend mode, and it can never authorize a write
against a server.

### HIGH 3 — The credentials ship with the page and can be cracked offline

**Evidence** `src/auth.js:38-42` — `DEFAULT_VAULT` carries the PBKDF2-SHA256
verifiers (12,000 iterations) for the ID, the password and the PIN, and is
inlined into the built file.

**Consequence** No password is written down, but the verifier is public, so the
password can be attacked offline with no rate limit at all. 12,000 iterations
is roughly 50 times below current OWASP guidance for PBKDF2-HMAC-SHA256
(600,000), and a GPU does millions of guesses per second at that cost.

**Remediation** The real password is verified **server-side** with `scrypt`
(N=16384, r=8, p=1, 32-byte key, per-install salt) and never leaves the
environment. `tools/keys.js` prints the hash to paste into the host's
environment variables. The client-side verifier remains only for the offline
mode, and the app says so in plain words in the sign-in sheet.

### HIGH 4 — No rate limiting or lockout on the server

**Evidence** `api/moments.js` has no counter of any kind. Throttling exists only
in the client (`src/auth.js` trial counter), where an attacker simply does not
run it.

**Remediation** A limiter on the server, keyed by source address and by
identity, with exponential backoff and a temporary lockout, applied to sign-in,
the second factor and writes; `Retry-After` in the reply and the wait shown in
the sheet. Tested: the sixth wrong password returns 429 with `Retry-After`.

### HIGH 5 — No session expiry, no revocation, no second factor, no recovery

**Evidence** `src/store.js:29-30,117` — the bearer token is stored and replayed
forever; `src/auth.js:31` — `KEEP_DAYS = 30`, a client-side flag that nothing
can revoke; there is no MFA and no account recovery route.

**Remediation** Expiry and renewal as in CRITICAL 2, `POST /api/session/logout`,
a session epoch in the environment for "sign out everywhere", TOTP (RFC 6238)
as a second factor with one-time recovery codes hashed in the environment, and
a recovery path that needs either a recovery code or a new hash from
`tools/keys.js` plus a redeploy: no email service, no third party, nothing
stored in the browser.

### HIGH 6 — A crafted id executes script for every visitor

**Evidence** `src/app.js:1459` builds the shelf spine with
`data-id="' + e.id + '"` — the id is interpolated into an **attribute** with no
escaping, while everything around it is escaped. Ids are accepted unvalidated by
the server (`api/moments.js:125` checks only that `entries` is an array).

**Consequence** A stored document containing
`id: '" onmouseover="fetch(...'"` runs script in the browser of everyone who
opens the shelf, and that script can read `localStorage`, which is where the
write token lives. Stored XSS with credential theft in one step.

**Remediation** Three layers: (1) `data-id` and every other attribute
interpolation now escapes quotes; (2) the server validates the shape of what it
is given — ids must match `^[A-Za-z0-9_-]{1,64}$`, strings are length-capped,
and unknown fields are dropped, so a hostile document cannot be stored in the
first place; (3) the client sanitises anything it reads out of `localStorage`
before rendering. Tested with a hostile entry carrying
`<img src=x onerror=...>` in the title and an id full of quotes: no script runs
and the text renders as text.

### HIGH 7 — No backup, and deletion is forever

**Evidence** `api/moments.js:56-60` and `128`: a single file (or single KV key)
is overwritten on every save. `removeEntry` in `src/app.js` drops the entry from
the array and pushes the result.

**Consequence** One wrong click, one client-side filtering bug, or one failed
write in the middle of a save and the memory is gone. There is nothing to
restore from.

**Remediation** Every save first writes a timestamped snapshot
(`backups/…json`, 30 kept, in both the file and KV modes); deletion is **soft**
(`deletedAt`), so a deleted moment moves to the keeper's Trash and can be
restored; the desk lists the snapshots and can restore one in a click; and
`tools/restore.js` does the same from a terminal. Tested: create, restrict,
delete, list, restore, and the restored document matches.

### MEDIUM 8 — No validation of what is written

**Evidence** `api/moments.js:125` — `Array.isArray(doc.entries)` and nothing
else: unbounded strings, unbounded entry counts, arbitrary field types, any id.

**Remediation** A schema check on write: at most 5,000 entries, 200 KB of text
per entry, 2 MB per request, known fields only, ids constrained as above,
booleans coerced, dates normalized. Rejections say what was wrong without
echoing the payload.

### MEDIUM 9 — CORS wide open on a write endpoint, no CSRF defence

**Evidence** `api/moments.js:79-81` sends `Access-Control-Allow-Origin: *` on
every response including the write path; there is no `Origin` check.

**Remediation** No CORS header on same-origin responses; an explicit allow-list
(`REEL_CORS_ORIGIN`) for anything else; writes additionally require an
`Origin`/`Referer` match and a `X-Reel` header, and the session cookie is
`SameSite=Strict`, which alone stops cross-site form posts.

### MEDIUM 10 — No security headers anywhere

**Evidence** `serve.js:47` writes a generic header block; `vercel.json` has
`headers` nowhere. No CSP, no `X-Content-Type-Options`, no frame protection, no
`Referrer-Policy`.

**Consequence** Clickjacking of the keeper's screen, MIME sniffing, and no
second line of defence if an escaping slip ever appears.

**Remediation** A Content-Security-Policy is computed **at build time** (the
SHA-256 of each inline script block) and written into the page as a meta tag, so
it also works on GitHub Pages where headers cannot be set; `serve.js` and
`vercel.json` add `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` and HSTS on https. Tested: the browser
run listens for `securitypolicyviolation` and asserts none, which proves the
policy actually permits the app as built.

### MEDIUM 11 — Host-header trust opens the write path

**Evidence** `api/moments.js:62-65,69` — when no token is configured, a write is
allowed if `Host` is `localhost`. The header is client-controlled unless every
proxy in front of it overwrites it.

**Remediation** The localhost convenience is gone. With no author configured
server-side the endpoint is **read-only** and says so.

### MEDIUM 12 — Publishing depends on manual file work

**Evidence** the "Publish by hand" panel (`src/shell.html`, `#adminHome`,
`#pubStore`) expects an export and a commit; the deployed page then has to be
refreshed by someone who remembers.

**Remediation** Publishing becomes a button in the keeper's desk, and the
snapshot the public reads is written by the same save that published it. Export
stays as an escape hatch, not as the workflow.

### LOW 13 — Internal detail echoed in errors

`api/moments.js:132` returns `err.message`, which includes filesystem paths.
Now: a generic message to the caller, the detail into the server log.

### LOW 14 — Predictable temp file, no fsync

`api/moments.js:57-59` writes `FILE + '.tmp'` then renames. Fine for a diary;
noted for completeness.

### LOW 15 — Browser storage as the primary store in local mode

`localStorage` is wiped when site data is cleared, and private windows drop it
on close. Unchanged in behaviour, but the desk now says which mode you are in
and what that means for the words you just wrote.

## C. What I did not find

No hardcoded password, token or key in the repository (the audit scans for it
and `tools/doctor.js` fails the build if one appears). No `eval`, no
`new Function`, no inline event-handler attributes. No `dangerouslySetInnerHTML`
equivalent outside the twenty-two `innerHTML` assignments, and each of those was
read: all but the one in HIGH 6 escape their interpolations. No third-party
script, font or analytics call at load: the page makes no network request until
you use it. No tracking of visitors beyond the standard server log.

## D. Priorities, in order

1. **Draft privacy** (CRITICAL 1) and **server-side author identity**
   (CRITICAL 2) — without these, nothing else matters.
2. **Rate limiting and session hygiene** (HIGH 4, 5) — the things that make
   server-side auth hold up in the real world.
3. **Validation and escaping** (HIGH 6, MEDIUM 8) — the difference between a
   document you can trust and one you cannot.
4. **Backups and soft delete** (HIGH 7) — the difference between an incident and
   a loss.
5. **Headers and CORS** (MEDIUM 9, 10, 11) — cheap, and they close whole classes
   of attack.
6. **Authoring friction** (MEDIUM 12) — a security control nobody wants to use
   gets bypassed, so publishing had to become one click.

## E. The target architecture (what is implemented in this round)

```
visitor  ──GET /api/moments──────────▶  published entries only
keeper   ──POST /api/session─────────▶  scrypt check ─▶ MFA ─▶ HMAC cookie (HttpOnly, Strict)
keeper   ──GET /api/moments──────────▶  everything, drafts and trash included
keeper   ──PUT /api/moments──────────▶  validated ─▶ snapshot written ─▶ stored
keeper   ──POST /api/moments/restore─▶  a snapshot comes back
```

* one self-contained function, `api/moments.js`, mounted by `serve.js` and by
  Vercel, no dependencies, so it deploys anywhere the page already deploys;
* the browser no longer holds a server credential: the session is a cookie it
  cannot read, and the interface is told what it may do by the server;
* the shelf the public reads contains only what you published, and a memory
  that exists only in your browser is marked as such on your screen and never
  claimed to be saved;
* nothing in the design changed: same cover, same shelves, same words, same
  two-section lab. The keeper's desk is one new screen, and the lab gained a
  title field, a draft switch, a preview and a save light.

## F. Should you move to Supabase?

**Not required, and I did not make it the default.** The honest comparison:

| | Current shape, hardened (shipped here) | Supabase Postgres + Auth |
| --- | --- | --- |
| Where the data lives | a JSON document in KV, in a file, or committed by the GitHub back | a Postgres table |
| Author identity | scrypt hash + TOTP in your host's environment, HMAC session cookie | Supabase Auth (users, sessions, MFA, recovery email) |
| Access policy | enforced in the function, one place, ~40 lines to read | enforced by row-level security in the database |
| Public read | `published && !deletedAt`, filtered server-side | `policy: select where published` for the `anon` role |
| Secret surface | one environment variable set on your host | project URL + anon key + service key, plus the policy file |
| Backups | snapshots this project writes, 30 kept, one click to restore | managed backups and point-in-time recovery (paid tier for the useful window) |
| Cost | 0 | free tier, then paid |
| Who can break it | you, by editing the environment | you, by editing the environment or the policies |

A single author writing a diary does not gain much from a database. What a
managed database buys you is multi-user auth, sharing, and a backup window you
do not have to own; what it costs is a second service to configure, a key that
can bypass every policy, and a place for the diary to live that is not yours.
**If you ever want a second writer, comments, or an admin UI, the migration is
worth it** and `supabase/schema.sql` plus `docs/SUPABASE.md` are in this
workspace with the exact policies that reproduce the rules above. That path is
prepared and documented but **not exercised by the tests here**, and it is
labelled as such: I will not claim a control works that this round has not run.

## G. Controls implemented, and how each one was verified

| Control | Verified by |
| --- | --- |
| Drafts never leave the server for a visitor | `test/security.test.js`: draft's words asserted absent from the public response |
| Sign-in is server-side (scrypt + timing-safe compare) | wrong password 401, correct password sets the cookie |
| Session cookie is `HttpOnly`, `SameSite=Strict`, expiring, HMAC-signed | headers asserted; forged and expired tokens rejected 401 |
| "Sign out everywhere" | session epoch bumped → old cookie rejected |
| MFA (TOTP RFC 6238 + recovery codes, single use) | RFC 6238 test vectors; wrong code 401 and rate limited; recovery code works once |
| Rate limiting and lockout | sixth wrong password 429 with `Retry-After` |
| CSRF | write without `Origin`/`X-Reel` 403; cross-site request gets no CORS header |
| Manipulated ids and hostile content | id with quotes and script payload rejected 400; hostile entry rendered inert in the browser pass |
| Validation | oversized body 413, bad JSON 400, unknown fields dropped, over-long strings refused |
| Soft delete and restore | visitor loses it, keeper sees it in Trash, restore brings it back |
| Backups and restoration | snapshot written on save; list, restore, and the restored document compared |
| Security headers and CSP | headers asserted on the live server; zero `securitypolicyviolation` events in the browser |
| No secret in the repository | `tools/doctor.js` scan, run in the test sweep |
| Unconfigured server is read-only | no author configured → sign-in and writes answer 401 with the reason, reads still serve published moments |

## H. What changed, file by file

Every change is inside the project that already existed. Nothing was rebuilt
from scratch, no framework arrived, and the visitor's journey, the design, the
shelves, the lab and the offline copy all still work the way they did.

| File | What it is now |
| --- | --- |
| `api/moments.js` | rewritten: sessions (scrypt + timing-safe compare), TOTP and single-use recovery codes, HMAC session cookies with expiry and a revocation epoch, published-only public view, validation and caps, soft delete, snapshots before every write, rate limiting with `Retry-After`, security headers, CORS pinned to one origin, and a store that is either Upstash KV (Vercel) or a JSON file (anywhere with a disk). Still one dependency-free file. |
| `serve.js` | the whole-project link now serves the built page, the sources, the shots, a zip, and every `/api/*` route, with the same headers and CSP |
| `src/session.js` | new: the page's only door — sign in, second factor, who am I, sign out |
| `src/store.js` | the three backs; writes carry the session cookie and never a secret from the page; the public read path no longer trusts a static file over the endpoint |
| `src/app.js` | the desk (drafts, on the shelf, thrown away), the private switch, publish/unpublish, soft delete with restore and burn, the snapshot restore, autosave with a visible save light, the preview, the MFA step, and the hostile-id escape that finding H6 named |
| `src/auth.js` | unchanged as the *offline* lock, now explicitly the second of two locks; adopts the server's answer when a server is present |
| `src/shell.html`, `src/ui.css` | the desk, the private switch, the save light and the second-factor step, in the existing visual language |
| `build.js` | inlines the new module and recomputes the CSP hash of the inline scripts on every build |
| `tools/keys.js` | password hash, session secret, MFA secret, recovery codes, offline verifiers, and a `totp` command for checking an authenticator |
| `tools/migrate.js` | new: upgrades an older shelf in place — repaired ids, `published` defaults, a copy aside first, `--dry-run` |
| `tools/restore.js` | new: lists snapshots, puts one back, keeps a copy of what it replaced |
| `tools/doctor.js`, `vercel.json`, `.gitignore`, `.vercelignore` | the deploy checks, headers for every hosted page, and the shelf kept out of the repository and off the host |
| `supabase/schema.sql`, `docs/SUPABASE.md` | the optional Postgres home, with the row-level rules that reproduce this model — prepared, documented, and labelled as not exercised |
| `test/security.test.js` (78 checks), `test/tools.test.js` (23) | new suites: the server over real HTTP, and the migration/restore against real files |
| `test/browser.js` | new passes: `live` (two devices, one shelf) and `security` (a draft a stranger cannot see, a forged flag that unlocks nothing, hostile text rendered inert, and the page's own policy blocking nothing it needs) |

## I. What you must set by hand

Nothing below is done for you, and the site says so in plain words until it is
done. `node tools/doctor.js` checks the shape of all of it before you push.

1. **The keeper's secrets on the host** (Vercel → Settings → Environment
   Variables, or a `.env` you keep to yourself):

   ```bash
   cd reel
   node tools/keys.js password "your-password"   # -> REEL_ADMIN_HASH
   node tools/keys.js secrets                    # -> REEL_SESSION_SECRET, REEL_TOTP_SECRET, REEL_RECOVERY_CODES
   ```

   Until `REEL_ADMIN_HASH` exists the endpoint is **read-only**: it refuses
   writes and says why, rather than quietly trusting localhost.

2. **The second factor**: scan `REEL_TOTP_SECRET` into an authenticator app.
   `node tools/keys.js totp "<secret>"` prints the code it should be showing.

3. **Storage, if you deploy to Vercel**: add Upstash/Vercel KV
   (`KV_REST_API_URL` + `KV_REST_API_TOKEN`), because a function's disk is
   read-only apart from a `/tmp` that is wiped between calls. On a VPS or in
   this workspace nothing needs adding: the shelf is `REEL_DATA_FILE`
   (`./moments.json` by default).

4. **Behind a proxy** (Vercel, Cloudflare, nginx): set `REEL_TRUST_PROXY=1` so
   the lockout counts the real client address rather than the proxy's.

5. **Your own shelf, if you have one from before**: `node tools/migrate.js
   --dry-run`, then `node tools/migrate.js`. Commit neither the shelf nor its
   `backups/` — `.gitignore` and `.vercelignore` already cover both.

6. **A GitHub token**, only if you want the repository back (the CI-free way to
   publish from a static host): a fine-grained token with `contents: read &
   write`, pasted into **Keeper → Where it saves**. It stays in that browser.

7. **If you change the keeper's password**, re-run step 1 and redeploy;
   `REEL_SESSION_EPOCH` is the switch that signs every existing device out at
   once.

## J. The four scenarios, as they were run

`test/browser.js live` drives two real browsers against a real server; the
output is the record.

| The scenario you asked for | What the pass does | Result |
| --- | --- | --- |
| 1. The author writes at the deployed URL, presses Confirm & Archive, is asked for the key, and the right key goes to the shelf | signs in through the sheet with the ID and password, writes, saves | the moment lands on the shelf and on disk; a wrong password is refused with the reason and nothing is written |
| 2. A visitor may write but cannot go further; the shelf stays open to everyone | a stranger presses Confirm & Archive | the key sheet opens, `0` moments on the backend afterwards, and the visitor still reads all seven |
| 3. Anything archived anywhere reaches every open page without a reload | two browser contexts, one shelf | the second device grows the spine within about a second, says so in a toast, and the change arrives as the same moment, not a twin |
| 4. Editing from the shelf asks for the key, and the edit lands everywhere | trashed and restored through the desk; an edit in place | the other device loses it and gains it back with no reload; the shelf on disk is the same seven, and what was thrown away is still there, marked, not erased |

`test/browser.js security` adds the parts a visitor would try: a draft's own
words absent from the public reply *and* from the visitor's page, publish and
unpublish travelling live, a hostile title and body rendered as the text they
are, a forged `localStorage` flag unlocking nothing, and the page's own policy
blocking nothing it needs.

## K. What is still true, and what I will not claim

* **A static host has no door.** On GitHub Pages there is no server to ask, so
  the offline copy's verifiers are a lock on the pencil, not a vault: anyone can
  edit their own browser's copy of a page that has no server. The audit says
  this plainly, and the honest fix is to use the server (Vercel, a VPS, this
  workspace's `serve.js`) when the diary is meant to be guarded rather than
  merely private in practice.
* **The file/KV store has no row-level policies**, because there are no rows.
  The rules live in the one function that can reach the shelf, which is a single
  thing to read and test — `supabase/schema.sql` is there for the day that stops
  being true.
* **The Supabase path is written, not exercised.** It is labelled as such in
  `docs/SUPABASE.md`, in the schema's comments and in this report. No control in
  this round is claimed unless a test in this repository runs it.
