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

**First-time DB setup** — run `schema.sql` once in the Supabase SQL Editor. `SETUP_SQL` in
`index.html` mirrors it so the tables can be created from a phone; keep the two in step. It uses
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
| `ATTORNEYS` | The 11-name attorney roster, alphabetical. Seeded so dictation can match a name on the first entry, before any history exists |
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
  distinctive-word matching, so "Zimbler" resolves to "Douglas Zimbler"). The word-level
  pass filters through `GENERIC_NAME_WORDS` first — **without it a saved case named
  "Defendant Martin" matched every later entry containing the word "defendant"**, silently
  billing new work to the wrong case. Never let a generic term identify a case on its own.
- `cleanName()` trims filler off both ends of a captured name, since a two-word capture
  readily swallows the next preposition ("defendant Martin with ..." → "Martin With")
- `resolveTimes()` resolves start/end in order of confidence: explicit "X to Y" range, then
  two loose clock references (`"start time 3 p.m. ... time 8 p.m."` → 15:00–20:00), then a
  single clock plus duration. `findClockTimes` counts a number as a time only when it has a
  meridiem or a colon, so "1.5 hrs", "45 minutes" and years are never read as clock times.
- `parseDate` handles both "December 25" and the way people actually speak it,
  "25th of December 2025"
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

### Attorney roster (`ATTORNEYS`, `attorneyOptions`, `attorneySelectHTML`)
`ATTORNEYS` is the fixed roster. `attorneyOptions()` returns it unioned with any attorney
found in the data, deduped by `normName` so "Gloria Keum" and "Gloria Keum, Esq." are one
option. The review form renders a `<select>` over those options plus an
**Other / type a name…** entry that reveals a text input; `#r-attorney` remains the single
source of truth that `readReview()` reads, and `setAttorneyValue()` keeps select and input in
step when something else (an accepted suggestion, an adopted case default) sets the name.

Two consequences worth keeping:
- **Seeding the roster improves dictation**, because `parseAttorney` and the fuzzy suggestion
  both match against `attorneyOptions()`. "attorney Malanaphy" resolves on a first-ever entry.
- **The filter dropdown deliberately uses `attorneyNames()`, not the roster** — filtering by
  an attorney with no entries would only ever return nothing.

Adding a name permanently means editing `ATTORNEYS`; anything typed into an entry joins the
options automatically for as long as that entry exists.

### Accent-tolerant name matching (`nameSimilarity`, `bestFuzzyMatch`, `mergeNames`)
Dictation renders the same surname differently between entries, which silently splits one
defendant across several cases, each tracking its own cap. Three layers address it:

1. **`speechLang`** (default `en-GB`, picker on the Log tab, saved per device). `r.lang` was
   hardcoded `en-US`; matching the dialect to the speaker is the single biggest accuracy win.
2. **`nameSimilarity`** scores two names by the better of Levenshtein ratio and `phoneticKey`
   similarity, comparing both the whole string and the last word — surnames carry the
   identity, so "Zimler" stays close to "Douglas Zimbler" while "Douglas Martin" does not
   match merely through a shared first name. `NAME_MATCH_THRESHOLD` (0.72) sits in a measured
   gap: worst true match 0.75, best false match 0.63.
3. **`mergeNames(field, from, into)`** reunites names that already fragmented, surfaced by
   `renderDuplicateBanner()` on the Vouchers tab.

**A suggestion is never applied automatically.** `renderNameSuggestion` offers the existing
name and waits for a tap. A wrong auto-match would bill work to the wrong defendant
unnoticed — the exact failure fixed in `fcf3653`. Keep it suggest-only. Because declining
costs one tap and a miss costs a split voucher, the threshold deliberately errs toward
offering; near-miss surnames (Anderson/Henderson) will be suggested, which is intended.

### Voice editing (`parseEditCommand`, `applyHeardEdit`, `commitHeardEdit`)
Editing by voice is a **diff, not a re-parse**. `parseEditCommand` scans an utterance for
field triggers (`EDIT_FIELDS`), takes the text between one trigger and the next as that
field's value, and returns only the fields actually named — so "change the hours to three"
cannot disturb the case, attorney or date.

`applyHeardEdit` renders a before → after preview and stops. `commitHeardEdit` writes into
the **edit-row inputs only**; Save stays a separate deliberate press. Voice never writes to a
stored entry directly, for the same reason name suggestions don't: a misheard command must
not silently alter a billing record.

Hours is derived, so an hours change moves the **end time**, never `hours` itself.

When no field is named, a fallback infers one from the utterance's shape — and runs in
`strict` mode, because loose thresholds there turn conversational filler into edits. Three
real regressions came from this and are covered by tests: bare `on` as a date cue matched
"hold **on** a second"; `may\w*` matched "**may**be"; and a loose category threshold matched
"right then" to *Other*. Keep the fallback strict.

### Filtering & export (`filteredEntries`, `renderFilterBar`, `exportCSV`)
Filters live in `filters` and are applied by `filteredEntries()`. `renderFilterBar()` prints
what is active and how many rows match, and carries the export button, so the filtered export
sits with the controls that produced it rather than below a long table.

Every export exists in two formats. `exportXLSX(caseName?, all?)` mirrors `exportCSV`'s
selection rules exactly; only the file format differs.

**The .xlsx is written by hand** (`zipStore`, `sheetXML`, `XLSX_STYLES`) rather than via a
spreadsheet library, keeping the app one file with no build and no CDN dependency at export
time. An xlsx is a ZIP of XML parts; entries are stored uncompressed (ZIP method 0) so no
deflate implementation is needed, with a real CRC32 per entry. Dates are serials from
1899-12-30, times are fractions of a day, and the TOTAL row uses live `SUM()` formulas with
cached values so it stays correct if rows are edited in Excel. Validated by CRC check,
XML well-formedness, and rendering through macOS Quick Look.

The xlsx is also the safer format: text cells are `inlineStr`, so a narrative beginning with
`=` is never evaluated. In CSV that had to be guarded explicitly in `csvCell`, which prefixes
an apostrophe to values starting `= + - @` while leaving genuine numbers alone.

`exportCSV` has three modes, and the distinction is deliberate:
| Call | Exports | Used by |
|---|---|---|
| `exportCSV()` | exactly what the Entries tab is showing | filter bar button |
| `exportCSV(null, true)` via `exportAllCSV()` | every entry, filters ignored | header "Export all" |
| `exportCSV(caseName)` | that one case's voucher | Vouchers tab cards |

The file is named after its contents (`voucher-gloria-keum-esq-<date>.csv`), so per-attorney
and per-defendant exports are distinguishable on disk.

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
- `exportCSV(caseName?, all?)` — see the table above. UTF-8 BOM for Excel, CRLF line endings,
  RFC-4180 quoting, TOTAL row appended.
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
**Demo rows never leave the device.** `syncToCloud` filters out any id prefixed `demo-`,
because a fresh device seeds samples before it has ever seen the cloud — without this, opening
Alfred on a new laptop would upload fake billing into the real shared dataset. Conversely,
when `loadFromCloud` returns real entries, local demo rows are dropped so a device never shows
both.

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
- **Sync failure is always visible.** It used to be fire-and-forget, logged only to the
  console — the tables were never created in the live project and nobody could tell, so every
  entry stayed on one device. `setSyncState()` drives a pill under the title
  (`off | syncing | ok | setup | error`) and a banner. `isMissingTable()` separates "tables
  don't exist" (fixable with the embedded SQL, banner offers copy + a deep link to this
  project's SQL editor) from a transient network failure (retry). Never make a sync path
  swallow an error again.
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
