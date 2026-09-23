-- ============================================================================
--  Reel — an optional home in Supabase Postgres.
--
--  Run this in the Supabase SQL editor only if you have decided to keep the
--  diary's shelf in Postgres instead of a file or a key/value store. The diary
--  works without any of this; docs/SUPABASE.md says when it is worth doing and
--  exactly what else has to change.
--
--  The shape of the rules, in one sentence: the page never talks to this
--  database, the server function does, and even if someone did talk to it with
--  the publishable key, they could only ever read published moments.
-- ============================================================================

-- ── who counts as the keeper ────────────────────────────────────────────────
--  One row per person allowed to write. The function checks the same list in
--  its own memory of sessions; this table is what the database itself trusts.
create table if not exists public.keepers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  added_at   timestamptz not null default now()
);

alter table public.keepers enable row level security;

--  A keeper may see that they are a keeper. Nobody else may read the list.
drop policy if exists keepers_see_self on public.keepers;
create policy keepers_see_self on public.keepers
  for select to authenticated
  using (user_id = auth.uid());

--  security definer so a policy can ask the question without every reader
--  needing the right to read the table.
create or replace function public.is_keeper()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.keepers k where k.user_id = auth.uid());
$$;

-- ── the moments ─────────────────────────────────────────────────────────────
--  The diary's entry is a document; the columns that matter to access control
--  and to querying are promoted, the rest travels in body.
create table if not exists public.moments (
  id           text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  body         jsonb not null default '{}'::jsonb,
  published    boolean not null default true,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  updated_at   timestamptz not null default now(),
  /* the same caps the server enforces, so the database cannot be talked into
     holding something the page would refuse to draw */
  constraint moments_title_fits  check (char_length(coalesce(body->>'title', '')) <= 200),
  constraint moments_raw_fits    check (char_length(coalesce(body->>'raw',   '')) <= 200000),
  constraint moments_body_is_obj check (jsonb_typeof(body) = 'object')
);

create index if not exists moments_published_idx on public.moments (published, deleted_at);
create index if not exists moments_created_idx   on public.moments (created_at desc);

alter table public.moments enable row level security;

--  a visitor, with nothing but the publishable key, sees the published shelf
drop policy if exists moments_read_published on public.moments;
create policy moments_read_published on public.moments
  for select to anon, authenticated
  using (published and deleted_at is null);

--  the keeper sees and does everything
drop policy if exists moments_keeper_read on public.moments;
create policy moments_keeper_read on public.moments
  for select to authenticated
  using (public.is_keeper());

drop policy if exists moments_keeper_write on public.moments;
create policy moments_keeper_write on public.moments
  for all to authenticated
  using (public.is_keeper())
  with check (public.is_keeper());

--  Belt and braces: a view that can only ever contain published moments, in
--  case you want to hand a key to something other than the function.
create or replace view public.published_moments
with (security_invoker = true) as
  select id, body, published_at, created_at
  from public.moments
  where published and deleted_at is null;

-- ── backups ─────────────────────────────────────────────────────────────────
--  One row per snapshot. The server writes one before every change and keeps
--  the newest REEL_BACKUPS_KEPT of them, exactly as it does on disk.
create table if not exists public.shelf_snapshots (
  name       text primary key,           -- moments-YYYYMMDD-HHMMSS-xxxx.json
  taken_at   timestamptz not null default now(),
  content    jsonb not null,
  bytes      integer generated always as (length(content::text)) stored
);

alter table public.shelf_snapshots enable row level security;

drop policy if exists snapshots_keeper_only on public.shelf_snapshots;
create policy snapshots_keeper_only on public.shelf_snapshots
  for all to authenticated
  using (public.is_keeper())
  with check (public.is_keeper());
--  No policy for anon: a visitor cannot even prove the snapshots exist.

-- ── the audit trail ─────────────────────────────────────────────────────────
--  Sign-ins, failed sign-ins, writes, restores. Readable by the keeper, written
--  by the server (which connects as the service role).
create table if not exists public.security_events (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  what     text not null check (char_length(what) <= 120),
  detail   text check (char_length(coalesce(detail, '')) <= 200),
  ip       text check (char_length(coalesce(ip, '')) <= 64),
  ok       boolean not null default true
);

alter table public.security_events enable row level security;

drop policy if exists events_keeper_only on public.security_events;
create policy events_keeper_only on public.security_events
  for select to authenticated
  using (public.is_keeper());
--  No insert policy: only the service role writes here, and the service role
--  is never in the page, only in the function's environment.

-- ── keep updated_at honest, in the database rather than in the app ──────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists moments_touch on public.moments;
create trigger moments_touch before update on public.moments
  for each row execute function public.touch_updated_at();

-- ── the keeper ──────────────────────────────────────────────────────────────
--  Create the account in Authentication → Users (email + password, confirm it),
--  then run:
--
--    insert into public.keepers (user_id, note)
--    select id, 'Yash Patel' from auth.users where email = 'yashap642@gmail.com'
--    on conflict (user_id) do nothing;
--
--  Verify the rules yourself, with the publishable key in PGPUB and the shelf
--  holding at least one draft:
--
--    curl -s "$SUPABASE_URL/rest/v1/moments?select=id" -H "apikey: $PGPUB"
--      → only published ids come back, drafts and trash do not
--    curl -s -X DELETE "$SUPABASE_URL/rest/v1/moments?id=eq.<a draft id>" -H "apikey: $PGPUB"
--      → refused; nothing is deleted
--
--  The service key belongs in the function's environment as SUPABASE_SERVICE_KEY
--  and nowhere else. If you ever paste it into the page, the whole section above
--  stops meaning anything, because the page would then be the keeper.
