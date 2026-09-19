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

const server = new Server(
  { name: 'alfred', version: '1.0.0' },
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

// Mirrors uid() in index.html:863 so ids generated here match the app's format.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// PostgREST treats , . : ( ) as syntax inside a filter value; quote and escape.
const q = (v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`;

// Fields the app writes today, plus the legacy pair still present in the live table.
// Only keys actually supplied are sent, so this keeps working across the schema
// migration in either direction. A missing column surfaces as a PGRST204 error.
const WRITABLE = [
  'name', 'content', 'priority', 'difficulty', 'blocker', 'blocker_reason',
  'project', 'sub_project', 'status', 'recurring_frequency',
  'category', 'subcategory'
];

const pickFields = (args) => {
  const out = {};
  for (const k of WRITABLE) if (args[k] !== undefined) out[k] = args[k];
  return out;
};

const summarize = (n) => ({
  id: n.id,
  name: n.name,
  priority: n.priority,
  status: n.status ?? null,
  project: n.project ?? n.category ?? null,
  created_at: n.created_at
});

const memoProps = {
  name: { type: 'string', description: 'Memo title' },
  content: { type: 'string', description: 'Body / transcript text' },
  priority: { type: 'string', description: 'High, Medium, or Low' },
  difficulty: { type: 'string', description: 'Hard, Medium, or Easy' },
  blocker: { type: 'string', description: 'Yes or No' },
  blocker_reason: { type: 'string', description: 'Only meaningful when blocker is Yes' },
  project: { type: 'string', description: 'One of the 12 Notion project names' },
  sub_project: { type: 'string', description: 'One of the 67 Notion sub-project names' },
  status: { type: 'string', description: 'To Do, Doing, Scheduled, On Hold, or Done' },
  recurring_frequency: { type: 'string', description: 'Daily, Recurring, One-time, Sporadic, or Iterative' },
  category: { type: 'string', description: 'Legacy column, still present in the live table' },
  subcategory: { type: 'string', description: 'Legacy column, still present in the live table' }
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_memos',
      description: 'List Alfred memos newest first, each as id, name, priority, status, project, and created_at. Use get_memo for a full record including the transcript.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max memos to return (default 100)' },
          status: { type: 'string', description: 'Filter by exact status, e.g. "To Do"' },
          project: { type: 'string', description: 'Filter by exact project name' },
          priority: { type: 'string', description: 'Filter by exact priority: High, Medium, or Low' }
        },
        required: []
      }
    },
    {
      name: 'get_memo',
      description: 'Get one memo in full, including its complete transcript content and every property.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Memo id' } },
        required: ['id']
      }
    },
    {
      name: 'search_memos',
      description: 'Case-insensitive substring search across memo names and transcript content. Returns summaries.',
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
      name: 'create_memo',
      description: IS_PROD
        ? 'Create a new memo. WRITES DIRECTLY TO THE LIVE SHARED DATASET the Alfred app reads — it appears on every device immediately. Confirm with the user before calling. Defaults match the app: priority Medium, difficulty Medium, blocker No, status To Do.'
        : 'Create a new memo. Defaults match the app: priority Medium, difficulty Medium, blocker No, status To Do.',
      inputSchema: {
        type: 'object',
        properties: { ...memoProps },
        required: ['name']
      }
    },
    {
      name: 'update_memo',
      description: IS_PROD
        ? 'Update a memo, merging only the fields you supply. WRITES DIRECTLY TO THE LIVE SHARED DATASET — the change is immediate, hits every device, and there is no undo. Confirm with the user before calling.'
        : 'Update a memo, merging only the fields you supply into the existing record.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Memo id' }, ...memoProps },
        required: ['id']
      }
    },
    {
      name: 'delete_memo',
      description: IS_PROD
        ? 'Permanently delete a memo. DESTRUCTIVE AND IRREVERSIBLE against the live shared dataset — it vanishes from every device and there is no undo and no trash. Always confirm the specific memo with the user first and make sure a recent backup exists.'
        : 'Permanently delete a memo. Cannot be undone.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Memo id' } },
        required: ['id']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === 'list_memos') {
      const p = ['select=*', 'order=created_at.desc', `limit=${args.limit || 100}`];
      if (args.status) p.push(`status=eq.${encodeURIComponent(args.status)}`);
      if (args.project) p.push(`project=eq.${encodeURIComponent(args.project)}`);
      if (args.priority) p.push(`priority=eq.${encodeURIComponent(args.priority)}`);
      const rows = await apiFetch(`/alfred_notes?${p.join('&')}`);
      return { content: [{ type: 'text', text: JSON.stringify(rows.map(summarize), null, 2) }] };
    }

    if (name === 'get_memo') {
      const rows = await apiFetch(`/alfred_notes?id=eq.${encodeURIComponent(args.id)}&select=*`);
      if (!rows.length) throw new Error(`No memo with id ${args.id}`);
      return { content: [{ type: 'text', text: JSON.stringify(rows[0], null, 2) }] };
    }

    if (name === 'search_memos') {
      const term = q(`*${args.query}*`);
      const filter = encodeURIComponent(`(name.ilike.${term},content.ilike.${term})`);
      const rows = await apiFetch(`/alfred_notes?or=${filter}&select=*&order=created_at.desc&limit=${args.limit || 50}`);
      return { content: [{ type: 'text', text: JSON.stringify(rows.map(summarize), null, 2) }] };
    }

    if (name === 'create_memo') {
      const row = {
        id: uid(),
        priority: 'Medium',
        difficulty: 'Medium',
        blocker: 'No',
        status: 'To Do',
        created_at: new Date().toISOString(),
        ...pickFields(args)
      };
      const created = await apiFetch('/alfred_notes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(row)
      });
      return { content: [{ type: 'text', text: JSON.stringify(created[0] ?? created, null, 2) }] };
    }

    if (name === 'update_memo') {
      const updates = pickFields(args);
      if (!Object.keys(updates).length) throw new Error('No updatable fields supplied');
      const updated = await apiFetch(`/alfred_notes?id=eq.${encodeURIComponent(args.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(updates)
      });
      if (!updated.length) throw new Error(`No memo with id ${args.id}`);
      return { content: [{ type: 'text', text: JSON.stringify(updated[0], null, 2) }] };
    }

    if (name === 'delete_memo') {
      const deleted = await apiFetch(`/alfred_notes?id=eq.${encodeURIComponent(args.id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' }
      });
      if (!deleted.length) throw new Error(`No memo with id ${args.id}`);
      return { content: [{ type: 'text', text: `Deleted memo ${args.id} ("${deleted[0].name}"). This cannot be undone.` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
