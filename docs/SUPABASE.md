# Would Supabase help this diary?

The short answer: **not for the diary as it stands today, and yes if a second
writer ever appears.** This page is the reasoning, and the exact steps if you
decide to move the shelf into Postgres anyway.

## What the diary actually needs from a backend

| The need | How it is held today | Supabase needed? |
| --- | --- | --- |
| Visitors read the shelf with no account, no prompt | `GET /api/moments` answers published moments only; the page never asks anyone to sign in | no |
| Drafts, the trash, and the author's desk stay private | the server answers a keeper's request with the whole shelf and everyone else with published moments only; the draft text never appears in a visitor's reply or page | no |
| Only Yash may write | a session cookie issued by the server after password + second factor; every write also needs `x-reel: 1` and a same-origin request | no |
| Every device gains a change without reloading | the page asks for the shelf every few seconds and replaces what it holds; a change reaches other open pages in about a second | no |
| Nothing is lost | soft delete first, a snapshot before every write, 30 kept, `tools/restore.js` and the desk's restore button | no |
| A bookkeeping hole to prove who did what | `security.events` on the shelf, kept for the last 40, written by the server | **partly** — a real table with as many rows as you like is nicer |

Everything above is one file of Node (`api/moments.js`, no dependencies) plus
either a JSON file on disk or a key/value store. There is no second system to
misconfigure, no key to leak, and nothing to pay for.

## When Supabase genuinely becomes the right answer

1. **More than one writer.** A second person, a guest chapter, a shared diary.
   Postgres with row-level rules beats inventing per-person rules in a function.
2. **Per-entry sharing.** "This chapter is for me, that one is for family."
   That is a policy question, and policies belong in a database.
3. **Asking questions of the shelf.** Runs of moods by month, how often the
   wishes shelf grows, full-text search across years. SQL earns its keep here.
4. **You already run it.** If the shelf has to live in the same database as the
   rest of your life, that is reason enough.
5. **The database must be the last word.** If you want the rule "unpublished
   moments never leave" enforced even when the application code is wrong,
   RLS policies are the stronger place to put it.

## What it costs

- **A second identity system.** Supabase Auth issues its own tokens. The
  function has to verify them, or you trust a second login path — extra moving
  parts on the one road that must never be wrong.
- **Key custody.** A service key opens everything. It can only ever live in the
  function's environment. The moment it appears in the page, the database rules
  stop protecting anything.
- **Rules you cannot skip testing.** RLS is real code: policies need their own
  tests, or you will believe you are protected and be wrong.
- **A network hop per read.** The page already polls; the file store answers in
  under a millisecond.
- **Money and a login** to a third party, and one more account to keep alive.

For one author, one shelf, and a handful of readers, none of that buys anything
the visitor or the keeper can feel.

## If you do move: the honest version

The shape stays the same. **The page still never talks to Supabase.** It talks
to `/api/moments`, which talks to Postgres as the service role, and the
publishable key is never used by the page at all — if the page held it, row
level security would be the only thing standing between a clever visitor and
your drafts.

1. Run `supabase/schema.sql` in the SQL editor. It creates `moments`,
   `shelf_snapshots`, `security_events`, the `keepers` list, and the policies:
   anon reads published rows only, the keeper does everything, snapshots and the
   log are invisible to everyone else.
2. Create the keeper account in **Authentication → Users** (email
   `yashap642@gmail.com`, a strong password, confirmed), then insert their id
   into `public.keepers` — the last lines of the schema file are the exact SQL.
3. Put these in the project's environment (Vercel → Settings → Environment
   Variables, or your `.env` on a machine of your own):

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_KEY=<the service role key, never the publishable one>
   ```

4. Replace the storage half of `api/moments.js` with the Postgres calls below.
   The routes, the sessions, the validation, the caps, the published-only view,
   the page, and every test stay exactly as they are — that is the point of
   keeping storage behind five functions.

   ```js
   /* shelfGet: the whole shelf as the server's document */
   async function shelfGet() {
     const rows = await pg('moments?select=id,body,published,deleted_at,created_at,published_at&order=created_at.asc');
     return {
       app: 'Reel', version: VERSION, owner: OWNER, savedAt: new Date().toISOString(),
       entries: rows.map(r => Object.assign({}, r.body, {
         id: r.id, published: r.published, deletedAt: r.deleted_at,
         createdAt: r.created_at, publishedAt: r.published_at
       }))
     };
   }

   /* shelfPut: the whole shelf, written as one transaction: the rows that are
      gone from the document are gone from the table, the rest are upserted */
   async function shelfPut(doc) {
     await pg('rpc/shelf_write', { method: 'POST', body: { doc: doc } });
   }

   /* snapshot / listSnapshots / readSnapshot: the same three, against
      public.shelf_snapshots, with the prune keeping REEL_BACKUPS_KEPT rows */
   ```

   A single `rpc/shelf_write` function (PL/pgSQL, `security definer`) keeps the
   write atomic: upsert every entry, then delete the ids that are missing. Do it
   that way rather than N round trips, or a dropped connection leaves half a
   shelf.

5. Verify, in this order, with your own eyes:

   ```bash
   # a stranger's read: published ids only
   curl -s "$SUPABASE_URL/rest/v1/moments?select=id" -H "apikey: $SUPABASE_PUBLISHABLE_KEY"
   # a stranger's write: refused
   curl -s -X POST "$SUPABASE_URL/rest/v1/moments" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -d '{"id":"nope"}'
   # the shelf through the diary, as the keeper
   curl -s http://localhost:8080/api/moments
   ```

   Then run the site's own suites: `node test/security.test.js` (75+ checks,
   including "a visitor never sees a draft" and "a write without a session is
   refused") and `node test/browser.js live` (two devices, one shelf).

## The recommendation

Keep the file or key/value shelf for now. It already gives you server-side
authorization, published-only reads, private drafts, soft deletion, snapshots,
a tested restore, and live updates across devices — the things the audit asked
for — with nothing extra to run, pay for, or leak. Revisit this page the day a
second person wants to write, or the day you want to ask the shelf questions
that only SQL can answer.
