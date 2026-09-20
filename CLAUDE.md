# Alfred — Claude Code Reference

## What it is
A **single-file, no-build voice time tracker** (`index.html`) for forensic experts and
court-appointed vendors who bill county/state court systems through voucher portals.
You dictate what you worked on; Alfred parses it into a structured, itemized time entry,
checks it for overlapping intervals, tracks it against the case's voucher cap, and exports
a CSV that matches court voucher import schemas.

No framework, no bundler. All logic lives in one HTML file with inline CSS and a `<script>`
block. Backed by Supabase for optional cloud sync; falls back to `localStorage` if cloud is
unavailable.

## File structure
```
index.html     — the entire app (HTML + CSS + JS, ~2160 lines)
schema.sql     — Supabase table definitions (run once to set up the DB)
mcp/server.js  — optional MCP server exposing time entries as tools (reads the same tables)
```

## Tech stack
- **Frontend:** Vanilla JS, Web Speech API (dictation), CSS custom properties
- **Storage:** `localStorage` (primary cache) + Supabase (cloud sync, upsert on save)
- **Cloud:** Supabase JS SDK loaded via CDN (`@supabase/supabase-js@2`)
- **Deploy:** Vercel, production alias **https://alfred-iota-three.vercel.app** (`vercel --prod`).
  `.vercelignore` keeps `mcp/`, `schema.sql` and `CLAUDE.md` out of the bundle — `mcp/package.json`
  would otherwise trip Vercel's framework detection on an app that needs no build.

## Supabase setup
Credentials are hardcoded at the top of the `<script>` block:
```js
const SUPABASE_URL = 'https://aoiaajghndbvjkkkqbnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';
```
Tables are `alfred_time_entries` and `alfred_cases`. localStorage keys are `alfred-entries`
and `alfred-cases`.

`cloudEnabled` also checks that `window.supabase` actually loaded — if the CDN is blocked or
the machine is offline, the app degrades to localStorage-only instead of dying at startup.
**Never remove that guard**: a thrown error there would take the whole script down and lose
unsaved billable time.

**No user auth** — this is intentional. All data is shared under a single public dataset.
RLS is enabled but fully permissive (`using (true)`). Safe for a personal cross-device tool
with no login requirement.

**First-time DB setup** — run `schema.sql` once in the Supabase SQL Editor. It uses
`create table if not exists`, so it is safe to re-run and never drops billing data. It leaves
the retired memo table `public.alfred_notes` alone (drop statement is commented out).

## Data model
### `alfred_time_entries`
| Column | Type | Notes |
|---|---|---|
| id | text PK | generated client-side via `uid()` (Date.now + random) |
| entry_date | date | calendar date the work was performed |
| start_time | text | `HH:MM`, 24-hour |
| end_time | text | `HH:MM`, 24-hour — **always after `start_time`** (no overnight entries) |
| hours | numeric | derived from start/end, stored for export |
| case_name | text | defendant / matter |
| attorney | text | retaining counsel |
| category | text | one of `CATEGORIES` |
| mode | text | `In-Court` / `Out-of-Court` |
| description | text | narrative shown on the voucher |
| rate | numeric | $/hr in effect for that entry |
| raw_text | text | original dictation, kept for audit |
| created_at | timestamptz | set at insert |

### `alfred_cases`
`name` (PK), `attorney`, `rate`, `cap` — per-case billing settings, editable on the Vouchers tab.

In JS, entries use camelCase (`caseName`, `startTime` → `start`, `end`, `raw`); `entryToRow` /
`rowToEntry` translate at the Supabase boundary.

## Key JS constants
| Constant | Purpose |
|---|---|
| `DEFAULT_RATE` | `250` — $/hr for a new case |
| `DEFAULT_CAP` | `3000` — statutory voucher cap, $ |
| `DELAY_DAYS` | `90` — work older than this triggers a Delay Affirmation |
| `DAY_HOURS_LIMIT` | `8` — hours on one calendar day that trigger Over-Billing |
| `REC_MAX` | `60` — seconds of dictation per entry |
| `CATEGORIES` | Discovery Download, File Review, Extraction Analysis, Phone Call / Conference, Report Writing, Court Testimony, Travel, Other |
| `MODES` | `['Out-of-Court','In-Court']` |
| `CAT_RULES` | Ordered keyword→category scoring table used by the parser |
| `EXAMPLES` | Quick-chip sample phrasings |

## Key JS state variables
| Variable | Purpose |
|---|---|
| `entries` | Array of all time entries |
| `caseBook` | Array of `{name, attorney, rate, cap}` per-case settings |
| `draft` | Entry being reviewed before save (null when the review panel is closed) |
| `editingId` | Id of the row currently in inline-edit mode, else null |
| `filters` | `{caseName, attorney, from, to, conflictsOnly}` for the Entries tab |
| `activeTab` | `'log'` \| `'entries'` \| `'vouchers'` |

## App sections & key functions

### Recording (`startRec`, `doStop`, `toggleRec`, `setRecState`)
- Uses `window.SpeechRecognition` (Chrome/Edge only); 60-second max
- Countdown ring drawn with SVG `stroke-dashoffset`
- On stop the transcript goes straight to `parseEntry()` → `openReview()`
- **This is the one piece carried over from the original memo app — keep its behavior intact.**

### Parser (`parseEntry` and helpers)
Turns free text into a draft entry. Never throws; unknown fields come back empty for the
user to fill in. Sub-parsers: `parseDate`, `parseDuration`, `parseTimeRange`, `parseStartTime`,
`parseCategory`, `parseAttorney`, `parseCase`, `buildNarrative`.
- Known case/attorney names win over regex guesses (`knownMatch` does full-name then
  distinctive-word matching, so "Zimbler" resolves to "Douglas Zimbler")
- The attorney is parsed first and blanked out of the text before case matching, so
  "with attorney Gloria" can't be mistaken for the case name
- `STOPWORDS` guards against capturing filler after a marker word ("attorney regarding …")
- Bare clock hours 1–7 are read as PM (`clockToMin`)
- With no clock reference the block is anchored to END at now (today) or 5:00 PM (past date)

### Overlap engine (`conflictsFor`, `conflictIds`, `nextFreeSlot`)
Two entries conflict when they share a date and their `[start, end)` minute ranges intersect —
**across all cases**, since that is what gets a voucher rejected. `nextFreeSlot` powers the
"Auto-shift to next free slot" button on the conflict banner.

### Caps & affirmations (`caseTotals`, `caseFlags`, `affirmText`, `openAffirm`)
`caseFlags(name)` returns `{overCap, overBilling, delay}`:
- **Over-Cap** — case total amount exceeds its cap
- **Over-Billing** — any single calendar day on that case bills more than `DAY_HOURS_LIMIT`
- **Delay** — oldest service on the case is more than `DELAY_DAYS` old

The modal generates standard affirmation text per trigger, live-updating as you type the
justification, with a copy-to-clipboard button.

### Entries tab (`renderEntries`, `rowHTML`, `editRowHTML`, `saveEdit`)
Table with the 10 voucher columns, metrics row (Total Hours, Gross Amount, Billable Entries,
Overlap Alerts), filters by case/attorney/date range plus a conflicts-only toggle.
Editing is **inline**: `startEdit(id)` re-renders that one `<tr>` as inputs.

### Vouchers tab (`renderVouchers`, `voucherCardHTML`)
One card per case: cap meter (green → amber at 80% → red when over), hours/amount,
editable rate and cap, affirmation badges, and a per-case CSV export.

### Persistence (`persist`, `syncToCloud`, `loadFromCloud`)
- `persist()` → writes both localStorage keys, schedules `syncToCloud()` with 800ms debounce
- `syncToCloud()` → upserts all entries, deletes rows no longer in `entries[]`, upserts `caseBook`
- On init: paints from localStorage first, then `loadFromCloud()` merges (local-only rows are
  kept and pushed up; cloud seeds from local when cloud is empty)

### Export / import
- `exportCSV(caseName?)` — with a case name exports that voucher; without one exports whatever
  the Entries tab is currently filtered to. UTF-8 BOM for Excel, CRLF line endings, RFC-4180
  quoting, TOTAL row appended.
- `exportJSON()` / `importJSON()` — full backup and merge-by-id restore.

### Erase all (`openErase`, `doErase`)
Header button → modal gated on typing `ERASE`. **Deletes the Supabase rows before clearing
localStorage**, because clearing only local state would look like it worked and then
`loadFromCloud()` would restore everything on the next refresh. It also cancels the pending
debounced `syncTimer` first, so a queued sync cannot re-upload what is being deleted.

If the cloud delete fails, the modal says so in red, names the Supabase error, warns that the
data returns on refresh, and offers a retry — it never reports a clean wipe it did not achieve.
On success it sets `alfred-seeded='1'` so a deliberate wipe leaves the app genuinely empty
rather than handing back the demo cases.

### Demo data (`demoData`, `maybeSeed`, `clearDemo`)
Seeds Douglas Zimbler (Gloria Keum, Esq.) and Joaquin Diaz (Chief Vasquez Investigations) on a
genuinely empty first run only, guarded by the `alfred-seeded` localStorage flag. Demo ids are
prefixed `demo-`; a dismissible banner offers `clearDemo()`. Dates are relative to today, so
Zimbler always demonstrates all three affirmation triggers.

## Things to know before editing
- **All CSS is inline** — no stylesheet. Styles use CSS custom properties defined in `:root`
  (light slate/navy legal-tech palette).
- **No module system** — all functions are global, wired via inline `onclick` / `oninput`.
- **`renderAll()` is the render loop** — call it after any state change that affects display;
  `renderEntries()` / `renderVouchers()` repaint a single tab.
- **Cloud sync is fire-and-forget** — errors are logged to console but never surfaced.
- **Speech availability is three-valued, not a boolean** — see `speechSupport()`. Dictation needs
  *both* a secure context and a real engine:
  - **Not HTTPS** → Chrome exposes the constructor but refuses to start, so the button looks dead.
    `window.isSecureContext` is checked first for exactly this reason.
  - **iOS, any non-Safari browser** → Apple requires WKWebView, which does not expose
    `webkitSpeechRecognition`. Chrome on iPhone will *never* dictate, however it is served.
    iOS Safari works.
  - **Otherwise unsupported** → generic message.
  When unavailable, `applySpeechSupport()` hides the mic entirely and promotes the typed path,
  rather than leaving a prominent button that does nothing. Never reintroduce a bare `if (!SR)`
  with a "requires Chrome" message — that is wrong on every one of these paths.
- **Anything that clears data must clear both tiers** — localStorage *and* Supabase — or it
  silently comes back from the cloud on the next load. See `doErase()`.
- **`hours` is always derived** from start/end — never set it independently, or CSV totals and
  cap meters drift apart.
