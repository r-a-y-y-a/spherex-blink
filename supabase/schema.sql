-- Run once in the Supabase SQL editor.
-- Cache of IRSA archive searches, keyed by RA/Dec rounded to 3 decimals.
create table if not exists public.searches (
  key text primary key,
  ra double precision not null,
  dec double precision not null,
  frames jsonb not null,
  created_at timestamptz not null default now()
);

-- Only the server (secret key) reads and writes this table.
alter table public.searches enable row level security;
