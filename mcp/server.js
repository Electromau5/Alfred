import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Alfred has no server tier — the app talks straight to Supabase PostgREST
// from the browser. This proxies that same HTTP surface with the same publishable
// key, so the table's RLS policy stays the only gatekeeper.
const API_BASE = process.env.ALFRED_API_BASE || 'https://aoiaajghndbvjkkkqbnm.supabase.co/rest/v1';
const ANON_KEY = process.env.ALFRED_ANON_KEY || 'sb_publishable_WbYoILo-3Qocw1XuhK38Hw_fqnj7TpW';

// There is one shared dataset — local and the Vercel deploy both point here.
// Any hosted Supabase target means writes are live.
const IS_PROD = !API_BASE.includes('localhost') && !API_BASE.includes('127.0.0.1');

const ENTRIES = '/alfred_time_entries';
const CASES = '/alfred_cases';
const DEFAULT_RATE = 250;
const DEFAULT_CAP = 3000;
const DELAY_DAYS = 90;
const DAY_HOURS_LIMIT = 8;

const server = new Server(
  { name: 'alfred', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

const apiFetch = async (path, options = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      ...(options.headers || {})
    }
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`API ${options.method || 'GET'} ${path} -> ${res.status}: ${body}`);
  }
  return body ? JSON.parse(body) : null;
};

// Mirrors uid() in index.html so ids generated here match the app's format.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// PostgREST treats , . : ( ) as syntax inside a filter value; quote and escape.
const q = (v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`;

const toMin = (t) => {
  const [h, m] = String(t || '0:00').split(':');
  return Number(h) * 60 + Number(m || 0);
};
const hoursBetween = (s, e) => Math.round(Math.max(0, toMin(e) - toMin(s)) / 60 * 100) / 100;
const daysSince = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(y, m - 1, d).setHours(0, 0, 0, 0)) / 86400000);
};

const WRITABLE = [
  'entry_date', 'start_time', 'end_time', 'case_name', 'attorney',
  'category', 'mode', 'description', 'rate', 'raw_text'
];

const pickFields = (args) => {
  const out = {};
  for (const k of WRITABLE) if (args[k] !== undefined) out[k] = args[k];
  return out;
};

const summarize = (e) => ({
  id: e.id,
  date: e.entry_date,
  time: `${e.start_time}–${e.end_time}`,
  hours: Number(e.hours),
  case: e.case_name,
  attorney: e.attorney,
  category: e.category,
  mode: e.mode,
  amount: Math.round(Number(e.hours) * Number(e.rate) * 100) / 100
});

// Two entries conflict when they share a date and their [start, end) ranges intersect,
// regardless of case. This is what gets a voucher rejected by the audit clerk.
const findOverlaps = (rows, candidate, excludeId) =>
  rows.filter((o) =>
    o.id !== excludeId &&
    o.entry_date === candidate.entry_date &&
    toMin(o.start_time) < toMin(candidate.end_time) &&
    toMin(candidate.start_time) < toMin(o.end_time));

const entryProps = {
  entry_date: { type: 'string', description: 'Date the work was performed, YYYY-MM-DD' },
  start_time: { type: 'string', description: 'Start time, 24-hour HH:MM' },
  end_time: { type: 'string', description: 'End time, 24-hour HH:MM. Must be after start_time.' },
  case_name: { type: 'string', description: 'Defendant / matter, e.g. "Douglas Zimbler"' },
  attorney: { type: 'string', description: 'Retaining counsel, e.g. "Gloria Keum, Esq."' },
  category: { type: 'string', description: 'Discovery Download, File Review, Extraction Analysis, Phone Call / Conference, Report Writing, Court Testimony, Travel, or Other' },
  mode: { type: 'string', description: '"In-Court" or "Out-of-Court" (default Out-of-Court)' },
  description: { type: 'string', description: 'Narrative description that appears on the voucher' },
  rate: { type: 'number', description: `Hourly rate in dollars (default ${DEFAULT_RATE})` },
  raw_text: { type: 'string', description: 'Original dictation, kept for audit' }
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_entries',
      description: 'List billable time entries newest first, each as id, date, time range, hours, case, attorney, category, mode, and amount. Use get_entry for the full record including the narrative.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max entries to return (default 100)' },
          case_name: { type: 'string', description: 'Filter by exact case / defendant name' },
          attorney: { type: 'string', description: 'Filter by exact attorney name' },
          from: { type: 'string', description: 'Only entries on or after this date, YYYY-MM-DD' },
          to: { type: 'string', description: 'Only entries on or before this date, YYYY-MM-DD' }
        },
        required: []
      }
    },
    {
      name: 'get_entry',
      description: 'Get one time entry in full, including its narrative description, rate, and original dictation.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Entry id' } },
        required: ['id']
      }
    },
    {
      name: 'search_entries',
      description: 'Case-insensitive substring search across case name, attorney, and narrative description. Returns summaries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for' },
          limit: { type: 'number', description: 'Max results (default 50)' }
        },
        required: ['query']
      }
    },
    {
      name: 'check_overlap',
      description: 'Check a proposed date and time range against every logged entry across all cases WITHOUT writing anything. Returns the conflicting entries, if any. Overlapping intervals get vouchers rejected, so run this before create_entry when the time slot is uncertain.',
      inputSchema: {
        type: 'object',
        properties: {
          entry_date: { type: 'string', description: 'Date to check, YYYY-MM-DD' },
          start_time: { type: 'string', description: 'Start time, 24-hour HH:MM' },
          end_time: { type: 'string', description: 'End time, 24-hour HH:MM' },
          exclude_id: { type: 'string', description: 'Entry id to ignore, when checking an edit of an existing entry' }
        },
        required: ['entry_date', 'start_time', 'end_time']
      }
    },
    {
      name: 'case_summary',
      description: `Billing position for each case: total hours, gross amount, hourly rate, voucher cap, remaining budget, and which affirmations are required. Flags over-cap (amount above the cap), over-billing (more than ${DAY_HOURS_LIMIT} hours on one calendar day), and delay (oldest service older than ${DELAY_DAYS} days).`,
      inputSchema: {
        type: 'object',
        properties: { case_name: { type: 'string', description: 'Limit to one case; omit for all cases' } },
        required: []
      }
    },
    {
      name: 'create_entry',
      description: IS_PROD
        ? `Create a billable time entry. WRITES DIRECTLY TO THE LIVE SHARED DATASET the Alfred app reads — it appears on every device immediately and counts toward the voucher cap. Confirm with the user before calling. Rejects the write if the time range overlaps an existing entry on any case, unless allow_overlap is true. Defaults: mode Out-of-Court, rate ${DEFAULT_RATE}.`
        : `Create a billable time entry. Rejects the write if the time range overlaps an existing entry on any case, unless allow_overlap is true. Defaults: mode Out-of-Court, rate ${DEFAULT_RATE}.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...entryProps,
          allow_overlap: { type: 'boolean', description: 'Save even though the slot overlaps an existing entry. Only set this when the user has explicitly accepted the conflict.' }
        },
        required: ['entry_date', 'start_time', 'end_time', 'case_name']
      }
    },
    {
      name: 'update_entry',
      description: IS_PROD
        ? 'Update a time entry, merging only the fields you supply. WRITES DIRECTLY TO THE LIVE SHARED DATASET — the change is immediate, hits every device, and there is no undo. Confirm with the user before calling.'
        : 'Update a time entry, merging only the fields you supply into the existing record.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Entry id' }, ...entryProps },
        required: ['id']
      }
    },
    {
      name: 'delete_entry',
      description: IS_PROD
        ? 'Permanently delete a time entry. DESTRUCTIVE AND IRREVERSIBLE against the live shared dataset — it vanishes from every device, changes the voucher total, and there is no undo and no trash. Always confirm the specific entry with the user first and make sure a recent backup exists.'
        : 'Permanently delete a time entry. Cannot be undone.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Entry id' } },
        required: ['id']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === 'list_entries') {
      const p = ['select=*', 'order=entry_date.desc,start_time.desc', `limit=${args.limit || 100}`];
      if (args.case_name) p.push(`case_name=eq.${encodeURIComponent(args.case_name)}`);
      if (args.attorney) p.push(`attorney=eq.${encodeURIComponent(args.attorney)}`);
      if (args.from) p.push(`entry_date=gte.${encodeURIComponent(args.from)}`);
      if (args.to) p.push(`entry_date=lte.${encodeURIComponent(args.to)}`);
      const rows = await apiFetch(`${ENTRIES}?${p.join('&')}`);
      return { content: [{ type: 'text', text: JSON.stringify(rows.map(summarize), null, 2) }] };
    }

    if (name === 'get_entry') {
      const rows = await apiFetch(`${ENTRIES}?id=eq.${encodeURIComponent(args.id)}&select=*`);
      if (!rows.length) throw new Error(`No entry with id ${args.id}`);
      return { content: [{ type: 'text', text: JSON.stringify(rows[0], null, 2) }] };
    }

    if (name === 'search_entries') {
      const term = q(`*${args.query}*`);
      const filter = encodeURIComponent(`(case_name.ilike.${term},attorney.ilike.${term},description.ilike.${term})`);
      const rows = await apiFetch(`${ENTRIES}?or=${filter}&select=*&order=entry_date.desc&limit=${args.limit || 50}`);
      return { content: [{ type: 'text', text: JSON.stringify(rows.map(summarize), null, 2) }] };
    }

    if (name === 'check_overlap') {
      const rows = await apiFetch(`${ENTRIES}?entry_date=eq.${encodeURIComponent(args.entry_date)}&select=*`);
      const hits = findOverlaps(rows, args, args.exclude_id);
      return {
        content: [{
          type: 'text', text: JSON.stringify({
            proposed: `${args.entry_date} ${args.start_time}–${args.end_time}`,
            conflicts: hits.length,
            overlapping: hits.map(summarize)
          }, null, 2)
        }]
      };
    }

    if (name === 'case_summary') {
      const p = ['select=*'];
      if (args.case_name) p.push(`case_name=eq.${encodeURIComponent(args.case_name)}`);
      const [rows, caseRows] = await Promise.all([
        apiFetch(`${ENTRIES}?${p.join('&')}`),
        apiFetch(`${CASES}?select=*`)
      ]);
      const cfgFor = (n) => caseRows.find((c) => c.name === n) || {};
      const names = [...new Set(rows.map((r) => r.case_name).filter(Boolean))].sort();

      const out = names.map((n) => {
        const list = rows.filter((r) => r.case_name === n);
        const cfg = cfgFor(n);
        const cap = cfg.cap != null ? Number(cfg.cap) : DEFAULT_CAP;
        const rate = cfg.rate != null ? Number(cfg.rate) : DEFAULT_RATE;
        const hours = Math.round(list.reduce((s, e) => s + Number(e.hours), 0) * 100) / 100;
        const amount = Math.round(list.reduce((s, e) => s + Number(e.hours) * Number(e.rate), 0) * 100) / 100;
        const byDay = {};
        list.forEach((e) => { byDay[e.entry_date] = (byDay[e.entry_date] || 0) + Number(e.hours); });
        const heavyDays = Object.entries(byDay)
          .filter(([, h]) => h > DAY_HOURS_LIMIT)
          .map(([d, h]) => ({ date: d, hours: Math.round(h * 100) / 100 }));
        const oldest = list.map((e) => e.entry_date).sort()[0] || null;
        const age = oldest ? daysSince(oldest) : 0;
        return {
          case: n,
          attorney: cfg.attorney || (list.find((e) => e.attorney) || {}).attorney || '',
          entries: list.length,
          hours, amount, rate, cap,
          remaining: Math.round((cap - amount) * 100) / 100,
          oldest_service: oldest,
          days_since_oldest: age,
          affirmations_required: [
            ...(amount > cap ? ['Over-Cap'] : []),
            ...(heavyDays.length ? ['Over-Billing'] : []),
            ...(age > DELAY_DAYS ? ['Delay'] : [])
          ],
          days_over_limit: heavyDays
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    }

    if (name === 'create_entry') {
      const fields = pickFields(args);
      if (toMin(fields.end_time) <= toMin(fields.start_time)) {
        throw new Error('end_time must be after start_time');
      }
      if (!args.allow_overlap) {
        const sameDay = await apiFetch(`${ENTRIES}?entry_date=eq.${encodeURIComponent(fields.entry_date)}&select=*`);
        const hits = findOverlaps(sameDay, fields);
        if (hits.length) {
          throw new Error(
            `Time conflict: ${fields.start_time}–${fields.end_time} on ${fields.entry_date} overlaps ` +
            `${hits.length} existing ${hits.length === 1 ? 'entry' : 'entries'} ` +
            `(${hits.map((h) => `${h.case_name} ${h.start_time}–${h.end_time}`).join('; ')}). ` +
            'Overlapping intervals get vouchers rejected. Pick a different slot, or set allow_overlap once the user has accepted the conflict.'
          );
        }
      }
      const row = {
        id: uid(),
        mode: 'Out-of-Court',
        rate: DEFAULT_RATE,
        created_at: new Date().toISOString(),
        ...fields,
        hours: hoursBetween(fields.start_time, fields.end_time)
      };
      const created = await apiFetch(ENTRIES, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(row)
      });
      // Keep the case book in step so the app's cap meter knows about a new case.
      await apiFetch(CASES, {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          name: row.case_name, attorney: row.attorney || '', rate: row.rate, cap: DEFAULT_CAP
        })
      }).catch(() => { /* case already on file */ });
      return { content: [{ type: 'text', text: JSON.stringify(created[0] ?? created, null, 2) }] };
    }

    if (name === 'update_entry') {
      const updates = pickFields(args);
      if (!Object.keys(updates).length) throw new Error('No updatable fields supplied');
      // hours is derived — recompute whenever either end of the range moves.
      if (updates.start_time || updates.end_time) {
        const current = await apiFetch(`${ENTRIES}?id=eq.${encodeURIComponent(args.id)}&select=*`);
        if (!current.length) throw new Error(`No entry with id ${args.id}`);
        const start = updates.start_time || current[0].start_time;
        const end = updates.end_time || current[0].end_time;
        if (toMin(end) <= toMin(start)) throw new Error('end_time must be after start_time');
        updates.hours = hoursBetween(start, end);
      }
      const updated = await apiFetch(`${ENTRIES}?id=eq.${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(updates)
      });
      if (!updated.length) throw new Error(`No entry with id ${args.id}`);
      return { content: [{ type: 'text', text: JSON.stringify(updated[0], null, 2) }] };
    }

    if (name === 'delete_entry') {
      const deleted = await apiFetch(`${ENTRIES}?id=eq.${encodeURIComponent(args.id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' }
      });
      if (!deleted.length) throw new Error(`No entry with id ${args.id}`);
      const d = deleted[0];
      return {
        content: [{
          type: 'text',
          text: `Deleted ${Number(d.hours).toFixed(2)}h entry for ${d.case_name} on ${d.entry_date} ` +
            `(${d.start_time}–${d.end_time}). This cannot be undone.`
        }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
