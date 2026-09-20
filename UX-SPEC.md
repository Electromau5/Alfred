# Alfred — UX Specification

A build-ready description of every screen, state, component and flow, written for
designers and design agents producing prototypes. It describes **what the user sees and
does**, not how the code works.

---

## 1. What the product is

**Alfred is a voice-first time tracker for forensic experts and court-appointed vendors who
bill county and state courts through voucher portals.**

The expert says what they just did — *"spent 45 minutes reviewing phone extractions for the
Douglas Zimbler case with attorney Gloria"* — and Alfred turns it into an itemised, billable
time entry. It then guards the three things that get a voucher **rejected**: overlapping time
intervals, exceeding the statutory cap, and filing outside the submission window.

### Primary user
A digital-forensics expert witness carrying **10–30 simultaneous court-appointed cases**,
switching tasks constantly, billing hourly. Often reconstructing weeks of backlogged work
from memory. Frequently working one-handed on a phone between engagements.

### The three problems it exists to solve
| Problem | How Alfred answers it |
|---|---|
| Time is reconstructed from memory days later | Dictate an entry in seconds, anywhere |
| Overlapping intervals get vouchers rejected | Conflicts detected across **all** cases, with a one-tap fix |
| Caps trigger mandatory affirmations | Live cap meter; affirmation text generated for you |

### Design tone
Professional legal-tech. Calm, dense, factual. This is a financial record that a court
audit clerk will read — it should feel closer to a banking app than a productivity toy.
Never playful. Never celebratory.

---

## 2. Design tokens

Copy these exactly; they are the live values.

### Colour
| Token | Hex | Used for |
|---|---|---|
| `bg` | `#f1f5f9` | Page background |
| `surf` | `#ffffff` | Cards, inputs, table |
| `surf2` | `#f8fafc` | Table header, inset panels, control row |
| `bdr` | `#e2e8f0` | Hairlines, card borders |
| `bdr2` | `#cbd5e1` | Input borders, button borders |
| `txt` | `#0f172a` | Primary text |
| `txt2` | `#334155` | Secondary text, table body |
| `dim` | `#64748b` | Labels, captions |
| `dim2` | `#94a3b8` | Hints, placeholders |
| `accent` | `#1d4ed8` | Primary action, active tab, links |
| `accent2` | `#1e3a8a` | Primary hover |
| `red` | `#dc2626` | Conflicts, destructive, recording |
| `warn` | `#b45309` | Cap warnings, setup required |
| `ok` | `#047857` | Synced, under cap |

Each status colour has an 8%-alpha tint for fills: `rgba(29,78,216,.08)` accent,
`rgba(220,38,38,.07)` red, `rgba(180,83,9,.08)` warn, `rgba(4,120,87,.08)` ok.

### Type
System UI stack. Sizes actually in use: **10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 16,
17, 18, 19, 21, 24, 28, 34 px**. Weights: 400 / 600 / 650 / 700 / 750 / 800.

Recurring patterns:
- **Eyebrow / field label** — 10–11px, 700, `dim`, uppercase, letter-spacing 1–1.3px
- **Body** — 13–14px, 400, `txt2`, line-height 1.55–1.75
- **Metric value** — 24px, 800, letter-spacing −0.6px, tabular numerals
- **Section title** — 17–19px, 750
- **Page title** — 19px, 800, letter-spacing −0.4px

### Shape & spacing
Radii: 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20 (pill). Cards 12px, inputs 8px, buttons 8px,
small buttons 6px, badges 20px.

Layout max-width **1160px**, page padding 20px (14px under 640px). Card padding 20px.

**All numeric values use tabular figures** so columns align.

---

## 3. Global chrome

Present on every screen, in this vertical order:

### 3.1 Header
```
[⚖]  Alfred
     10 entries · 23.25 hrs · $5,812.50        [⇩ Export all] [⇩ Backup] [⇧ Restore] [⌫ Erase all]
     ● Synced 11:42
```
- **Logo** 40×40, 10px radius, `accent` fill, white glyph
- **Title** 19px/800
- **Subtitle** live summary; reads `Voucher time tracker` when empty. Briefly replaced by
  confirmations ("Entry saved to Douglas Zimbler") for ~2.6s, then reverts
- **Sync pill** — see 3.3
- **Actions** — `Erase all` is the only red-outlined button. Under 640px the action row goes
  full width and buttons flex equally

### 3.2 Tabs
Three equal segments in a white pill container, 4px inset padding:
**🎤 Log Time · 📋 Entries · ⚖ Vouchers**
Active = `accent` fill, white text, 650 weight. Inactive = transparent, `dim`.

### 3.3 Sync pill
Small pill under the subtitle with a 7px leading dot. Five states:

| State | Label | Colour |
|---|---|---|
| `off` | Local only | neutral |
| `syncing` | Syncing… | accent |
| `ok` | Synced 11:42 | ok |
| `setup` | Cloud not set up | warn |
| `error` | Sync failed | red |

Tapping it: when synced, shows last-sync detail; otherwise retries.

### 3.4 Global banners
Appear between tabs and content, stacked. Three variants — **info** (accent), **warn**
(amber), **red**. Each is a flex row: 16px icon · body · optional trailing action.
Under 560px the trailing action wraps to its own full-width line.

- **Cloud not set up** (warn) — "Entries are only on this device" + `Copy setup SQL` ·
  `Open SQL editor` · `Retry`
- **Sync failed** (red) — names the error + `Retry now`
- **Demo data loaded** (info) — + `Clear demo data`

---

## 4. Screen: Log Time

The default tab. Two mutually exclusive states.

### 4.1 Capture (idle)
Single centred card:

```
            ╭───────────────╮
            │   ◯  🎤  ◯    │      148×148 ring, 94px button
            ╰───────────────╯
        Tap to dictate a time entry
        Voice language  [English (UK) ▾]

        ──────── or type it ────────
   ┌──────────────────────────────────────┐
   │ e.g. Spent 45 minutes reviewing      │
   │ phone extractions for the Douglas    │
   │ Zimbler case with attorney Gloria    │
   └──────────────────────────────────────┘
                        [ Parse entry → ]

   QUICK EXAMPLES
   [Review phone extraction for Douglas Zimbler with Gloria Keum for 1.5 hrs]
   [Call with attorney regarding Joaquin Diaz discovery download 45 mins]
   [Testified in court on the Zimbler matter from 10am to 12:30pm]
   [Drafted forensic report for Joaquin Diaz yesterday for 2 hours]
```

**Mic button states**
| State | Fill | Glyph | Label | Extras |
|---|---|---|---|---|
| Idle | `accent` | 🎤 | "Tap to dictate a time entry" | — |
| Requesting | `warn` | ⏳ | "Requesting mic access…" | — |
| Recording | `red`, pulsing 1.4s | ⏹ | "Recording — tap to stop" | Countdown **2:00** in 28px/800 red; ring depletes clockwise |

Max recording **2 minutes**. A pause does **not** stop it — only tapping stop or the timer
expiring. While recording, a **Live transcript** panel appears below the ring and fills in
real time.

Quick-example chips are pill-shaped, 16px radius; on hover they take `accent` text and tint.

### 4.2 Speech unavailable
When dictation is impossible the **mic block is hidden entirely** and an info banner takes
its place, with the typed path promoted (divider reads "log an entry" instead of "or type
it"). Three distinct messages:

| Cause | Headline |
|---|---|
| Page not HTTPS | "Voice input needs a secure (HTTPS) connection" |
| iOS, non-Safari browser | "On iPhone and iPad, only Safari can dictate" |
| Browser has no engine | "This browser cannot do voice input" |

This matters: **Chrome on iOS can never dictate** — Apple forbids it. Design the typed path
as a first-class route, not a fallback.

### 4.3 Review & confirm
Replaces the capture card once an entry is parsed. This is the most important screen in the
product — it is where a machine guess becomes a billing record.

```
REVIEW & CONFIRM ENTRY

⚠  Time conflict on 09/19/2026                [Auto-shift to next free slot]
   This block overlaps 1 existing entry: Douglas Zimbler · 9:30 PM–11:30 PM.
   Court audit clerks reject vouchers with overlapping intervals.

⚑  Saving this puts Douglas Zimbler over its voucher cap
   $4,875.00 billed against a $3,000.00 cap ($1,875.00 over).

CASE / DEFENDANT
[ Zimler                                    ]
   ⚡ Did you mean Douglas Zimbler?
      You already have a case by that name. Dictation often spells the same
      name differently, which would split the voucher across two cases.
      [Use Douglas Zimbler]  [Keep "Zimler"]

ATTORNEY / RETAINING COUNSEL   [ — Select attorney — ▾ ]
DATE [09/19/2026]   START [09:00]   END [12:00]   HOURS [3.00]
ACTIVITY TYPE [File Review ▾]   LOCATION [Out-of-Court ▾]
RATE ($/HR) [250]   AMOUNT [$750.00]
NARRATIVE DESCRIPTION (APPEARS ON THE VOUCHER)
[ multi-line ]

                                    [Discard]  [Save entry]

WHAT YOU SAID
"spent 45 minutes reviewing phone extractions for the Douglas Zimbler case…"
```

Field grid is responsive: `minmax(180px, 1fr)`, collapsing to one column on a phone.
**Hours** and **Amount** are read-only readouts (grey inset, 700 weight) — both derived.

**Attorney** is a dropdown over an 11-name roster plus anyone previously used, ending in
*Other / type a name…*, which reveals a text input beneath.

Everything recalculates live on any change.

---

## 5. Screen: Entries

### 5.1 Metrics row
Four cards, auto-fit `minmax(160px, 1fr)`:
**Total hours · Gross amount · Billable entries · Overlap alerts**
Label 10.5px/700 uppercase `dim`; value 24px/800. Overlap alerts turns **red** when > 0.

### 5.2 Filters card
```
FILTERS
[Case / defendant ▾]  [Attorney ▾]  [From date]  [To date]  [Clear filters]
☐ Show only entries with time conflicts
────────────────────────────────────────────────────────────
Showing 7 of 10  [Attorney: Gloria Keum, Esq.]   [↓ Export these 7 to Excel] [CSV]
```
The bottom bar is separated by a hairline. It names **every active filter as a chip**, states
matched-against-total, and carries the export buttons — so what an export will contain is
visible before pressing it. With zero matches both buttons disable and the primary reads
**"Nothing to export"**.

### 5.3 Table
Ten columns: **Date · Time · Hours · Case · Attorney · Category · Court · Description ·
Amount · (actions)**

- Header 10.5px/700 uppercase on `surf2`, hairline beneath
- Time cell stacks start over end, end in `dim`
- Hours bold; Amount shows rate beneath in 11px `dim`
- Category → accent badge. Court → amber badge if **In-Court**, neutral if Out-of-Court
- **Conflicted rows** take a red tint and a `⚠ conflict` badge beside the date
- Row actions: `Edit` · `Delete` (red outline)
- Horizontally scrollable below ~1100px; on wide screens both actions sit side by side

Empty states: *"No time logged yet. Tap the mic on the **Log Time** tab and say what you
worked on."* — or, when filters exclude everything, *"No entries match these filters."*

### 5.4 Inline edit — with voice
Pressing **Edit** turns that row into inputs **and adds a second full-width row beneath it**
(spanning all ten columns, `surf2` fill, 2px accent bottom border):

```
[🎤 Say a change]  e.g. "change the hours to three"…        [Cancel] [Save]
```

While listening the button turns red and reads **⏹ Stop & apply · 1:47**.

After speaking, a change preview appears:
```
┌──────────────────────────────────────────────┐
│ Hours      1̶.̶0̶0̶  →  3.00                     │
│ Attorney   G̶l̶o̶r̶i̶a̶ ̶K̶e̶u̶m̶  →  Toni Messina      │
│ "change the hours to 3 and the attorney to…" │
│ [Apply 2 changes]  [Discard]                 │
└──────────────────────────────────────────────┘
```
Old value struck through in `dim`; new value `accent`/650. What was heard is quoted in
italic 12px beneath. **Apply writes into the form fields only — Save is still separate.**

If nothing usable was heard: *"No change picked up"* plus phrasing examples.

---

## 6. Screen: Vouchers

One card per case, plus a duplicate-name banner when relevant.

```
⚠ These look like the same name spelled two ways
  Each one bills as a separate voucher with its own cap. Pick the spelling to keep.
  Zimbla (1)  ↔  Douglas Zimbler (2)
  [Keep "Douglas Zimbler"]  [Keep "Zimbla"]

┌────────────────────────────────────────────────────────────────────┐
│ Douglas Zimbler  [Over-Cap] [Over-Billing] [Delay]                 │
│ Gloria Keum, Esq. · 7 entries · oldest 05/22/2026 (120 days ago)   │
│                        [⚑ Affirmations required] [↓ Export] [CSV]  │
│ ████████████████████████████████████████████████████  (red, 100%)  │
│ $4,875.00 billed                    $1,875.00 over cap of $3,000   │
│                                                                    │
│ HOURS 19.50   AMOUNT $4,875.00   RATE [250]   CAP [3000]          │
│                                                                    │
│ ⚠ Days billed over 8 hours — 09/10/2026 — 8.50 hrs                │
│ ⏱ Outside the 90-day submission window                            │
└────────────────────────────────────────────────────────────────────┘
```

**Cap meter** — 9px tall, 5px radius, bordered track. Green under 80%, **amber at ≥80%**,
**red when over**. Caption row: amount billed (left) against remaining-or-over (right); when
over, the right side is red and bold.

Rate and Cap are **editable inputs inside the stat row**, saving on change.

Empty state: *"No cases yet. Log time on the Log Time tab and each case will appear here with
its own cap meter."*

### 6.1 Affirmations modal
Opens from the red badge button. One block per applicable affirmation:

| Affirmation | Trigger |
|---|---|
| **Over-Cap** | case total exceeds its cap |
| **Over-Billing** | more than 8 hours billed on any one calendar day |
| **Delay** | oldest service older than 90 days |

Each block: title, why it fired, a justification textarea, and generated affirmation text in
a **monospace inset panel** that updates live as you type, plus **Copy text** (→ "Copied ✓"
for 1.8s).

---

## 7. Destructive flow: Erase all

Modal, max-width 560px:

1. Title **Erase all data** + "deletes … from this browser **and from the cloud**, so it
   disappears from every device. It cannot be undone."
2. **Red summary banner** — "About to delete 10 entries across 2 cases — 23.25 billable
   hours worth $5,812.50"
3. **Take a backup first** panel — `⇩ Download JSON backup` · `⇩ Export CSV`
4. **Type ERASE to confirm** — the confirm button stays disabled until it matches
5. `[Cancel]` `[Erase everything]`

On failure the modal stays open and turns red: *"This device is cleared, the cloud is not"*
with the error and **Retry erase**. On success: green confirmation, auto-closes after 1.4s.

---

## 8. Flows

### 8.1 Create by voice (primary)
```
Log Time → tap mic → [permission prompt, first time]
  → recording, live transcript, 2:00 countdown
  → tap stop
  → parse
  → Review & confirm
      ├ conflict banner?  → Auto-shift to next free slot
      ├ cap warning?      → informational only
      └ name near-miss?   → Use <existing> / Keep <heard>
  → Save entry
  → lands on Entries, header flashes "Entry saved to <case>"
```

### 8.2 Create by typing
Identical from the parse step onward. The only route on iOS Chrome.

### 8.3 Edit by voice
```
Entries → Edit on a row → row becomes inputs + control row
  → 🎤 Say a change → speak (pauses are fine, up to 2:00) → Stop & apply
  → change preview (before → after per field)
  → Apply  → values land in the form
  → Save   → committed
```
Only the fields you name change. Cancel discards everything, including applied-but-unsaved
voice changes.

### 8.4 Filter and export
```
Entries → choose Case and/or Attorney (+ optional date range, conflicts-only)
  → table, metrics and filter bar all update
  → Export these N to Excel  (or CSV)
  → file named after the filter, e.g. voucher-gloria-keum-esq-2026-09-20.xlsx
```
Header **Export all** deliberately ignores filters. Voucher cards export a single case.

### 8.5 First-run / cloud setup
```
Open on a new device → demo data seeds (banner offers Clear demo data)
  → if tables missing: warn banner
      → Copy setup SQL → Open SQL editor → Run → Retry
  → pill turns green; entries appear on every device
```

---

## 9. Data model as displayed

| Field | Control | Notes |
|---|---|---|
| Case / defendant | text + autocomplete | Required |
| Attorney | dropdown + Other | 11-name roster |
| Date | date picker | |
| Start / End | time pickers | End must be after start |
| Hours | **read-only** | Derived from the range |
| Activity type | dropdown | 8 options |
| Location | dropdown | In-Court / Out-of-Court |
| Rate | number | Default $250/hr |
| Amount | **read-only** | hours × rate |
| Description | textarea | Appears on the voucher |

**Activity types:** Discovery Download · File Review · Extraction Analysis ·
Phone Call / Conference · Report Writing · Court Testimony · Travel · Other

**Attorney roster:** Adam Silverstein · Danielle Von Lehman · David Breschel · Eric Renfroe ·
Glenn Abolafia · Gloria Keum · Howard Weiner · Jin Lee · Liam Malanaphy · Nicole Guliano ·
Toni Messina

**Defaults:** rate $250/hr · cap $3,000 · delay threshold 90 days · over-billing threshold
8 hrs/day · recording window 2 minutes

---

## 10. Component inventory

| Component | Variants |
|---|---|
| Button | primary, default, danger, small, disabled |
| Badge | category (accent), conflict (red), In-Court (amber), Out-of-Court (neutral), affirmation (red) |
| Banner | info, warn, red — each with optional trailing action |
| Metric card | normal, alert |
| Cap meter | ok / warn / over |
| Suggestion prompt | amber, two actions |
| Change preview | strike-through old → accent new |
| Pill | sync status ×5 |
| Field | text, select, date, time, textarea, read-only readout |
| Modal | affirmations, erase |
| Table row | normal, conflicted, editing (+ control row) |

---

## 11. Responsive behaviour

Breakpoints at **1100px**, **640px**, **560px**.

- Header actions become full-width and flex equally under 640px
- Entries table scrolls horizontally; row actions stack under 1100px
- Banner trailing actions drop to their own full-width row under 560px
- Filter export buttons go full width under 560px
- Field grids collapse to a single column

**Design mobile-first.** The real user is one-handed on a phone between court appearances.
Every flow must complete at 390px wide.

---

## 12. Principles to preserve in any redesign

1. **Never auto-apply a machine guess to a billing record.** Name suggestions and voice edits
   are *offered* and wait for a tap. A wrong silent match bills work to the wrong defendant.
2. **Always show what an action will affect before it happens** — entry counts on exports,
   totals before erasing, before → after on edits.
3. **Conflicts and caps are the product.** They are why this beats a notes app; give them
   prominence.
4. **Typing is never a second-class path.** It is the only route on iOS Chrome.
5. **State is always visible** — sync status, active filters, what was heard.
6. **Money and time are tabular and exact.** Two decimals, aligned, never abbreviated.
