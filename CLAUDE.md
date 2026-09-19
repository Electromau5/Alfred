# Alfred — Claude Code Reference

## What it is
A **single-file, no-build voice memo app** (`index.html`). No framework, no bundler. All logic lives in one HTML file with inline CSS and a `<script>` block. Backed by Supabase for optional cloud sync; falls back to `localStorage` if cloud is unavailable.

## File structure
```
index.html     — the entire app (HTML + CSS + JS, ~1400 lines)
schema.sql     — Supabase table definitions for `alfred_notes` (run once to set up the DB)
mcp/server.js  — optional MCP server exposing the memos as tools (reads the same table)
```

## Tech stack
- **Frontend:** Vanilla JS, Web Speech API (recording + wizard voice input), CSS custom properties
- **Storage:** `localStorage` (primary cache) + Supabase (cloud sync, upsert on save)
- **Cloud:** Supabase JS SDK loaded via CDN (`@supabase/supabase-js@2`)
- **Deploy:** not linked yet — run `vercel link` to create a deployment (no `.vercel/` config in this repo)

## Supabase setup
Credentials are hardcoded at the top of the `<script>` block (~line 580):
```js
const SUPABASE_URL = 'https://aoiaajghndbvjkkkqbnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';
```
The table is `alfred_notes`. Alfred shares a Supabase *project* with VoiceDraft but uses its
own table, so the two apps never touch each other's rows. localStorage key is `alfred-notes`.

**No user auth** — this is intentional. All data is shared under a single public dataset. RLS is enabled but fully permissive (`using (true)`). Safe for a personal cross-device app with no login requirement.

## Data model
### `alfred_notes` table
| Column | Type | Notes |
|---|---|---|
| id | text PK | generated client-side via `uid()` (Date.now + random) |
| name | text | memo title |
| content | text | raw voice transcript |
| priority | text | High / Medium / Low |
| difficulty | text | Hard / Medium / Easy |
| blocker | text | Yes / No |
| blocker_reason | text | only set when blocker = Yes |
| project | text | one of 12 Notion project options |
| sub_project | text | one of 67 Notion sub-project options |
| status | text | To Do / Doing / Scheduled / On Hold / Done |
| recurring_frequency | text | Daily / Recurring / One-time / Sporadic / Iterative |
| created_at | timestamptz | set at insert, never updated |

## Key JS constants
| Constant | Purpose |
|---|---|
| `PROJECTS` | Array of 12 project name strings (from Notion) |
| `SUB_PROJECTS` | Array of 67 sub-project name strings (from Notion) |
| `STATUS_OPTIONS` | `['To Do','Doing','Scheduled','On Hold','Done']` |
| `STATUS_ORDER` | Sort weight map for status values |
| `RECUR_OPTIONS` | `['Daily','Recurring','One-time','Sporadic','Iterative']` |
| `DIMS` | Array of `{key, label}` objects for browse grouping dimensions |

## Key JS state variables
| Variable | Purpose |
|---|---|
| `notes` | Array of all memo objects (loaded from localStorage, synced from Supabase) |
| `draft` | In-progress memo during the record wizard (`{ name, content, project, subProject, status, recurringFrequency }`) |
| `filters` | Active multi-select filter state per dimension |
| `browseDim` | Which dimension the Browse tab groups by (default: `'project'`) |
| `browseSort` | Current sort mode (`'date-desc'` default) |

## App sections & key functions

### Recording (`startRec`, `doStop`, `toggleRec`)
- Uses `window.SpeechRecognition` (Chrome/Edge only)
- 30-second max; countdown ring drawn with SVG `stroke-dashoffset`
- On stop: saves transcript to `draft.content`, hides idle view, shows wizard

### Wizard (`showStep`, `nextStep`)
2 steps: **Name (Step 1 of 2) → Confirm (Step 2 of 2)**
- Step 1 has a voice input button (`wizVoice('name')`) for hands-free naming
- `renderConfirm()` shows draft name and transcript content
- `saveMemo()` commits to `notes[]`, calls `persist()`, switches to Browse tab
- New memos default to `priority: 'Medium'`, `difficulty: 'Medium'`, `blocker: 'No'`, `status: 'To Do'`

### Browse (`renderBrowse`, `makeCard`)
- Single-level grouping by `browseDim` (project, status, priority, difficulty, blocker, recurringFrequency, subProject)
- Multi-select dropdowns (`.ms` / `.ms-panel`) built without any library
- `matchesFilters(n)` — memo must match ALL active filter dimensions

### Edit modal (`openEdit`, `saveEdit`)
- Full property editing: name, content, project, sub-project, status, priority, difficulty, blocker, recurring frequency
- Project and Sub-Project use `<select>` elements populated from `PROJECTS` / `SUB_PROJECTS` constants via `initSelects()`

### Persistence (`persist`, `syncToCloud`, `loadFromCloud`)
- `persist()` → writes to localStorage, schedules `syncToCloud()` with 800ms debounce
- `syncToCloud()` → upserts all notes, deletes rows no longer in `notes[]`
- On init: paints from localStorage first, then calls `loadFromCloud()` which overwrites if cloud has data; seeds cloud from local if cloud is empty

### Import / Export
- `exportMemos()` — downloads `{ app: 'Alfred', version: 1, notes }` as JSON
- `importMemos()` — merges by ID (skips duplicates)

## Things to know before editing
- **All CSS is inline** — there is no stylesheet. Styles use CSS custom properties defined in `:root`.
- **No module system** — all functions are global. Order matters only where functions call each other at parse time (there are none; all calls are event-driven).
- **`renderBrowse()` is the render loop** — it repaints the entire Browse view. Call it after any state change that affects what's displayed.
- **Cloud sync is fire-and-forget** — errors are logged to console but never surfaced to the user.
- **Speech API is Chrome/Edge only** — Firefox will show an error message; Safari is unsupported.
- **First-time DB setup** — run `schema.sql` once in the Supabase SQL Editor to create
  `public.alfred_notes` with its RLS policy. It drops and recreates only that table.
