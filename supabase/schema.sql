-- Pic-to-Video schema. Run this once in your Supabase project's SQL editor.
-- (Dashboard → SQL Editor → New query → paste → Run.)

-- USERS: keyed by the slug we derive from the login name.
create table if not exists public.users (
  id          text primary key,           -- e.g. "u_soft-launch-tester"
  data        jsonb not null,             -- AppUser shape (name, videosGenerated, createdAt, etc.)
  updated_at  timestamptz not null default now()
);

-- PROPERTIES: the whole nested Property object lives in a single jsonb column.
-- Cheap to store, easy to migrate when the shape evolves, and we already do all
-- shape-validation in TypeScript anyway.
create table if not exists public.properties (
  id          text primary key,           -- uuid produced by the app
  owner_id    text not null,              -- references users.id (no FK so deletes don't cascade unexpectedly during testing)
  data        jsonb not null,             -- the whole Property object
  updated_at  timestamptz not null default now()
);
create index if not exists properties_owner_idx on public.properties (owner_id);
create index if not exists properties_updated_idx on public.properties (updated_at desc);

-- We hit the DB only from the server with the SECRET (service-role) key, so RLS
-- can stay off for these tables. If you ever want to open them to the browser,
-- enable RLS and add policies first.
alter table public.users      disable row level security;
alter table public.properties disable row level security;
