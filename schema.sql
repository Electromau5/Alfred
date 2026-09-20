-- Alfred — Voucher Time Tracker — Supabase schema (PUBLIC, no authentication)
-- Run in Supabase → SQL Editor → New query → paste → Run.
--
-- NOTE: This is a single shared dataset with no per-user login. Anyone with the
-- app URL + publishable key can read/write these rows. Chosen intentionally for a
-- no-login, cross-device personal tool.
--
-- SAFE TO RE-RUN: uses "create table if not exists", so existing billing data is
-- never dropped. Alfred's old memo table (public.alfred_notes) is left untouched;
-- uncomment the line at the bottom only if you want to retire it.

-- ── Time entries ───────────────────────────────────────────────────────
-- One row per billable block of work. id is generated client-side by uid().
create table if not exists public.alfred_time_entries (
  id           text primary key,
  entry_date   date,                      -- calendar date the work was performed
  start_time   text,                      -- 'HH:MM', 24-hour
  end_time     text,                      -- 'HH:MM', 24-hour, always after start_time
  hours        numeric      default 0,    -- derived from start/end, stored for export
  case_name    text         default '',   -- defendant / matter
  attorney     text         default '',   -- retaining counsel
  category     text         default '',   -- Discovery Download, File Review, Extraction
                                          -- Analysis, Phone Call / Conference, Report
                                          -- Writing, Court Testimony, Travel, Other
  mode         text         default 'Out-of-Court',  -- 'In-Court' | 'Out-of-Court'
  description  text         default '',   -- narrative shown on the voucher
  rate         numeric      default 250,  -- $/hr in effect for this entry
  raw_text     text         default '',   -- original dictation, kept for audit
  created_at   timestamptz  default now()
);

-- Overlap checks and the Entries filters both scan by date.
create index if not exists alfred_time_entries_date_idx on public.alfred_time_entries (entry_date);
create index if not exists alfred_time_entries_case_idx on public.alfred_time_entries (case_name);

-- ── Per-case billing settings ──────────────────────────────────────────
-- Rate and statutory cap, editable per case on the Vouchers tab.
create table if not exists public.alfred_cases (
  name       text primary key,
  attorney   text        default '',
  rate       numeric     default 250,   -- $/hr
  cap        numeric     default 3000,  -- statutory voucher cap, $
  created_at timestamptz default now()
);

-- ── Public access via the anon/publishable key ─────────────────────────
-- RLS stays ON with a permissive policy so the client key can read/write,
-- but nothing is scoped to a user (there is no login).
alter table public.alfred_time_entries enable row level security;
alter table public.alfred_cases        enable row level security;

drop policy if exists "public alfred time entries" on public.alfred_time_entries;
create policy "public alfred time entries" on public.alfred_time_entries
  for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "public alfred cases" on public.alfred_cases;
create policy "public alfred cases" on public.alfred_cases
  for all to anon, authenticated
  using (true) with check (true);

-- ── Retiring the old memo app's table (optional, DESTRUCTIVE) ──────────
-- The voucher tracker never reads alfred_notes. Export anything you still want
-- from it before uncommenting this.
-- drop table if exists public.alfred_notes cascade;
