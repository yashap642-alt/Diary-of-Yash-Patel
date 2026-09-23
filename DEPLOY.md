# Deploying REEL

## First: the error you hit

```
sh: line 1: vite: command not found
Error: Command "vite build" exited with 127
```

That is Vercel's **Framework Preset** deciding this project is a Vite app and
running `vite build`. There is no Vite here — no config, no dependency, no
build script that mentions it — so `vite` is not installed and the build dies
with exit 127. The preset comes from the dashboard (or from a leftover
`vite.config.*` / `vite` dependency somewhere in the repo), and it wins over the
files unless a `vercel.json` says otherwise.

**Fix it in the dashboard (one minute):**

1. Vercel → your project → **Settings → Build & Development Settings**
2. **Framework Preset → `Other`**
3. **Build Command →** `node build.js`
   — or clear it entirely, the `vercel.json` shipped here sets it
4. **Install Command →** `echo "no dependencies to install"` (there are none)
5. **Output Directory →** `.`
6. **Root Directory →** leave it empty — the repository root holds `reel-diary.html` and `api/`
   (if your repository root *is* the whole workspace, leave it empty — the
   `vercel.json` and the built page at that root handle it)
7. **Save → Deployments → Redeploy** (the ⋯ menu)

**Or take the guesswork away from the host entirely.** This repository now
carries `vercel.json` in both places, and each one says:

```json
{ "framework": null, "buildCommand": "node build.js",
  "outputDirectory": ".", "installCommand": "echo \"no dependencies to install\"" }
```

`"framework": null` is the important line: it tells Vercel to stop guessing, so
`vite build` can never be chosen again. If you have already pushed, pull these
files in and redeploy.

**And if a stray Vite marker is still in the repository** (`vite.config.js`,
or a `package.json` with `vite` in its dependencies, or a `"build": "vite build"`
script somewhere), delete it — `node tools/doctor.js` will tell you whether one
is there and where.

---

Two ways, both static-first. The diary is one HTML file; the optional backend
is one small function. `node tools/doctor.js` checks everything below before
you push.

---

## Which layout is your repository?

There is only one now. The repository root **is** the project: `reel-diary.html`
beside `src/`, `api/`, `test/`, `tools/`, `vercel.json` and `package.json`. No
nested folder, no second copy of the page, nothing to point at a subdirectory.

* **Root Directory** in Vercel: leave it empty.
* The root URL opens the diary, because `vercel.json` rewrites `/` to
  `/reel-diary.html`.
* On GitHub Pages there are no rewrites: link to `/reel-diary.html`, or rename
  it to `index.html` on the branch you serve.

## 1 · GitHub Pages (no server at all)

The whole repo, served as files. Works today, with one caveat: a static host
cannot save anything, so the keeper's changes travel through **the repository
itself**.

1. Push the project. The repository root holds `reel-diary.html`, `api/`,
   `src/`, `build.js`, `vercel.json`.
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`**.
3. Open your Pages URL with the page's name on the end — a static host has no
   rewrites, so the address is `<your-pages-url>/reel-diary.html`. (Rename the
   file to `index.html` on the branch you serve if you would rather the bare
   address worked.)
4. Sign in as keeper (**Keeper → the key**, ID `YashPatel` + password, or the PIN).
5. **Keeper → Where it saves → GitHub repository**, and fill in:
   * owner, repository, branch (`main`),
   * file: `moments.json`,
   * a **fine-grained token** with `Contents: Read and write` on that repository
     (GitHub → Settings → Developer settings → Fine-grained tokens).
6. Press **Save & test**. You should read `✓ connected`.
   From then on, every add, change and delete is a commit to `moments.json`,
   and every visitor's page reads the committed shelf.

> The token lives in your browser only. Never commit it.

---

## 2 · Vercel (static page + the `/api/moments` function)

`api/moments.js` deploys automatically as the function `/api/moments`, and
`vercel.json` already sets the build command, the output directory and the
function's duration.

### The import that usually goes wrong

Leave **Root Directory** empty. Everything the host needs — the built page, the
function in `api/`, `vercel.json`, `package.json` — is at the root of the
repository. Pointing *Root Directory* at a subfolder is the one mistake that
makes both the site and the function disappear.

### Then

1. **Project → Settings → Environment Variables** — the keeper's secrets. Make
   them on your own machine; they are printed once, and stored nowhere else:

   ```bash
   cd reel
   node tools/keys.js password "your-password"   # -> REEL_ADMIN_HASH
   node tools/keys.js secrets                    # -> session secret, MFA secret, recovery codes
   ```

   | Variable | What it is |
   | --- | --- |
   | `REEL_ADMIN_HASH` | the scrypt hash of the keeper's password. Until this exists the endpoint is **read-only** and says so |
   | `REEL_SESSION_SECRET` | signs the session cookie. Changing it ends every session |
   | `REEL_TOTP_SECRET` | the second factor: scan it into an authenticator app |
   | `REEL_RECOVERY_CODES` | comma-separated, hashed at rest, each usable once |
   | `REEL_KEEPER_ID` | optional, defaults to `YashPatel` |
   | `REEL_SESSION_EPOCH` | optional; raise the number to sign every device out at once |
   | `REEL_CORS_ORIGIN` | optional; only if the page is served from a different domain than the function |
   | `REEL_BACKUPS_KEPT`, `REEL_MAX_BODY`, `REEL_MAX_ENTRIES`, `REEL_LOGIN_MAX`, `REEL_WRITE_MAX` | optional; the snapshots kept, the caps and the lockouts |
   | `KV_REST_API_URL` + `KV_REST_API_TOKEN` | *only if you want the shelf stored in a database.* Create a free Upstash Redis database from Vercel's **Storage** tab and these are filled in for you |

2. Redeploy. Visit `/api/moments` — you should see
   `{"app":"Reel","entries":[],...}`. That is the backend answering.
3. Open the diary, write something, press **Confirm & Archive**, and sign in at
   the sheet: the ID and the password, then the six-digit code from the
   authenticator. The moment should land on the shelf and survive a reload.

Without KV the endpoint still reads (from the committed `moments.json`), and a
write is refused with the reason — Vercel's function disk is read-only apart
from `/tmp`, which is wiped between calls.

### What an open page costs

Every open page asks `/api/moments/version` once a second to stay in step. The
answer is a few dozen bytes and the function reuses it for a fraction of a second
in memory, so a hundred readers cost about one request per second rather than a
hundred — but **each request is still a KV command on the host's meter**. A page
left open and visible for an hour is 3 600 of them against Upstash's free daily
allowance. If you would rather spend less, slow the poll down from any page:

```js
window.__reel.watchEvery(5000)      // five seconds between asks, remembered here
```

Readers who are not looking at the tab cost nothing: the poll pauses while the
page is hidden and asks once the instant it is brought back.

### Your shelf must never be uploaded

A shelf file holds drafts. `.vercelignore` (and `.gitignore`) keep
`moments.json`, `backups/` and any `.env` out of the deploy and out of the
repository; keep those lines where they are. If you have a shelf written by an
earlier version, move it in first — `node tools/migrate.js --dry-run`, then
`node tools/migrate.js` — and commit neither the shelf nor its backups.

---

## The errors people actually hit

| What you see | What it means | Fix |
| --- | --- | --- |
| `Error: No Output Directory named "public" found after the Build completed` | Vercel guessed a framework and expected a build output folder | `vercel.json` already sets `"outputDirectory": "."` and `"framework": null`; keep that file, or set *Output Directory* to `.` in Settings |
| `Error: The pattern "api/moments.js" defined in \`functions\` doesn't match any Serverless Functions` | `api/` was not uploaded — it is in `.vercelignore`, or the root directory is set to a subfolder | clear **Root Directory**; keep `api/` |
| `404: NOT_FOUND` on the site root | the host is not applying the rewrite from `/` | keep the `rewrites` entry in `vercel.json` (`/` → `/reel-diary.html`), or link straight to `/reel-diary.html` |
| `ENOENT: no such file or directory, open '/home/user/reel-diary.html'` during build | an older `build.js` wrote to an absolute path | fixed in this version; pull the latest `build.js` |
| the endpoint calls itself `read-only`, or a write answers `401 not signed in` | no `REEL_ADMIN_HASH` in the environment, or the request carried no session cookie | set the keeper's secrets (above) and redeploy; sign in at the sheet |
| a write answers `403 that request did not come from the diary` | the request had no `x-reel: 1` header, or came from another origin | writes only happen through the page itself; if the page is served from another domain, set `REEL_CORS_ORIGIN` |
| the second factor is always refused | the authenticator is not on `REEL_TOTP_SECRET`, or the phone's clock is adrift | `node tools/keys.js totp "<secret>"` prints what the code should be; one step either side is accepted |
| A PUT returns `501 … read-only` | on Vercel without a KV store | add Upstash/Vercel KV, or use the GitHub back instead |
| `sh: line 1: vite: command not found` / `Command "vite build" exited with 127` | the host's Framework Preset thinks this is a Vite app | set **Framework Preset → Other**, or keep the shipped `vercel.json` (`"framework": null`) and redeploy — see the top of this file |
| `Build Completed` but the page is blank/stale | the committed `reel-diary.html` was built from older sources | run `node build.js` locally and commit the page (or let the host run it — `vercel.json` already asks for it) |

---

## Local, exactly as the host runs it

```bash
node tools/doctor.js      # will this deploy work?
node build.js             # rebuild the single file
node serve.js             # http://localhost:8080 — diary, sources, /api/moments

# the same checks the host would do, run here:
node test/ui.test.js        # the journey, the lock, changing a moment
node test/contrast.test.js  # both lights
node test/security.test.js  # sessions, MFA, drafts, ids, limits, snapshots
node test/tools.test.js     # migrating an older shelf, restoring one
node test/browser.js all    # real Chrome, including two devices on one shelf
```
