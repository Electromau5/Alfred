-- Alfred — Supabase schema (PUBLIC, no authentication)
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- NOTE: This is a single shared dataset with no per-user login. Anyone with the
-- app URL + public key can read/write these rows. Chosen intentionally for a
-- no-login, cross-device personal app. Safe to re-run (drops and recreates).

drop table if exists public.alfred_notes cascade;

-- ── Memos ──────────────────────────────────────────────────────────────
create table public.alfred_notes (
  id                  text primary key,
  name                text,
  content             text,
  priority            text,
  difficulty          text,
  blocker             text,
  blocker_reason      text default '',
  project             text default '',
  sub_project         text default '',
  status              text default '',
  recurring_frequency text default '',
  created_at          timestamptz default now()
);

-- ── Upgrading an existing database (skip if running fresh) ─────────────
-- alter table public.alfred_notes add column if not exists project             text default '';
-- alter table public.alfred_notes add column if not exists sub_project         text default '';
-- alter table public.alfred_notes add column if not exists status              text default '';
-- alter table public.alfred_notes add column if not exists recurring_frequency text default '';

-- ── Public access via the anon/publishable key ─────────────────────────
-- RLS stays ON with a permissive policy so the client key can read/write,
-- but nothing is scoped to a user (there is no login).
alter table public.alfred_notes enable row level security;

drop policy if exists "public alfred notes" on public.alfred_notes;
create policy "public alfred notes" on public.alfred_notes
  for all to anon, authenticated
  using (true) with check (true);
