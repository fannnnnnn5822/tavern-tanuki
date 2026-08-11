#!/usr/bin/env node
/**
 * tavern-tanuki 酒馆小狸 — MCP server for a running SillyTavern instance.
 *
 * Lets coding agents read and write characters, worldbooks and chats through
 * SillyTavern's HTTP API. Configure via environment variables:
 *   ST_URL      base URL of the ST server (default http://127.0.0.1:8000)
 *   ST_USER     HTTP Basic Auth username (if ST has basicAuthMode enabled)
 *   ST_PASSWORD HTTP Basic Auth password
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { STClient } from './client.js';
import { Bridge } from './bridge.js';

const st = new STClient();
const bridge = new Bridge();

const server = new McpServer({ name: 'tavern-tanuki', version: '0.2.0' });

/** Wrap a handler: JSON-stringify results, surface errors as tool errors. */
function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      const result = await handler(args ?? {});
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

tool(
  'st_status',
  'Check the SillyTavern connection. Returns version, character count and worldbook count.',
  {},
  async () => {
    const version = await st.get('/version');
    const chars = await st.post('/api/characters/all');
    const settings = await st.post('/api/settings/get');
    return {
      version: version.pkgVersion,
      characters: chars.length,
      worldbooks: (settings.world_names ?? []).length,
    };
  },
);

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

tool(
  'list_characters',
  'List characters (name, avatar filename, tags, chat count/date). Use `filter` to search by name substring. Avatar filename is the ID used by all other character tools.',
  {
    filter: z.string().optional().describe('Case-insensitive substring to match against character name'),
  },
  async ({ filter }) => {
    const all = await st.post('/api/characters/all');
    let list = all.map((c) => ({
      name: c.name,
      avatar: c.avatar,
      tags: c.tags?.length ? c.tags : undefined,
      chat_size: c.chat_size,
      date_last_chat: c.date_last_chat
        ? new Date(c.date_last_chat).toISOString().slice(0, 10)
        : undefined,
    }));
    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(f) || c.avatar.toLowerCase().includes(f));
    }
    return { count: list.length, characters: list };
  },
);

const CHARACTER_DEFAULT_FIELDS = [
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
];

tool(
  'get_character',
  `Read a character card. By default returns ${CHARACTER_DEFAULT_FIELDS.join('/')} plus creator notes, alternate greeting count and embedded-worldbook name. Pass \`fields\` to select specific top-level or data.* fields (e.g. ["data.alternate_greetings", "data.extensions"]).`,
  {
    avatar_url: z.string().describe('Avatar filename from list_characters, e.g. "MyChar.png"'),
    fields: z.array(z.string()).optional().describe('Specific fields to return instead of the default set'),
  },
  async ({ avatar_url, fields }) => {
    const c = await st.post('/api/characters/get', { avatar_url });
    if (fields?.length) {
      const pick = {};
      for (const f of fields) {
        const path = f.split('.');
        let v = c;
        for (const p of path) v = v?.[p];
        pick[f] = v;
      }
      return pick;
    }
    const out = {};
    for (const f of CHARACTER_DEFAULT_FIELDS) out[f] = c[f];
    out.creator_notes = c.data?.creator_notes || undefined;
    out.character_version = c.data?.character_version || undefined;
    out.alternate_greetings_count = c.data?.alternate_greetings?.length ?? 0;
    out.embedded_worldbook = c.data?.character_book?.name;
    out.extensions_keys = c.data?.extensions ? Object.keys(c.data.extensions) : undefined;
    return out;
  },
);

tool(
  'edit_character',
  'Set one prompt field of a character card (description, personality, scenario, first_mes, mes_example...). SillyTavern stores these fields twice (top level + data.*); this tool updates both copies in sync. For nested data (creator_notes, alternate_greetings, extensions, tags) use merge_character_data instead.',
  {
    avatar_url: z.string().describe('Avatar filename, e.g. "MyChar.png"'),
    field: z.string().describe('Field name, e.g. "description" or "first_mes"'),
    value: z.string().describe('New value for the field'),
  },
  async ({ avatar_url, field, value }) => {
    const card = await st.post('/api/characters/get', { avatar_url });
    await st.post('/api/characters/edit-attribute', {
      avatar_url,
      ch_name: card.name,
      field,
      value,
    });
    return { ok: true, field, length: value.length };
  },
);

tool(
  'merge_character_data',
  'Deep-merge a partial card object into a character. Use for nested fields, e.g. {"data": {"creator_notes": "...", "character_version": "1.1"}} or {"tags": [...]}. NOTE: prompt fields (description etc.) exist BOTH at top level and under data.* — when merging those, include both copies, or prefer edit_character which syncs them automatically.',
  {
    avatar_url: z.string().describe('Avatar filename, e.g. "MyChar.png"'),
    edits: z.record(z.any()).describe('Partial card object to deep-merge into the character'),
  },
  async ({ avatar_url, edits }) => {
    await st.post('/api/characters/merge-attributes', { avatar: avatar_url, ...edits });
    return { ok: true, merged_keys: Object.keys(edits) };
  },
);

/* ------------------------------------------------------------------ */
/* Worldbooks                                                          */
/* ------------------------------------------------------------------ */

tool(
  'list_worldbooks',
  'List worldbook (lorebook) names. Use `filter` to search; large installs can have hundreds of books.',
  {
    filter: z.string().optional().describe('Case-insensitive substring filter'),
  },
  async ({ filter }) => {
    const settings = await st.post('/api/settings/get');
    let names = settings.world_names ?? [];
    if (filter) {
      const f = filter.toLowerCase();
      names = names.filter((n) => n.toLowerCase().includes(f));
    }
    return { count: names.length, names };
  },
);

const entrySummary = (e) => ({
  uid: e.uid,
  comment: e.comment,
  key: e.key,
  disable: e.disable,
  constant: e.constant,
  position: e.position,
  order: e.order,
  content_length: e.content?.length ?? 0,
});

tool(
  'get_worldbook',
  'Read a worldbook. mode "summary" (default) lists entries without content; mode "full" includes entry content; pass `uids` to fetch full content of specific entries only.',
  {
    name: z.string().describe('Worldbook name from list_worldbooks'),
    mode: z.enum(['summary', 'full']).optional(),
    uids: z.array(z.number()).optional().describe('Return only these entries (always with full content)'),
  },
  async ({ name, mode = 'summary', uids }) => {
    const wb = await st.post('/api/worldinfo/get', { name });
    const entries = Object.values(wb.entries ?? {});
    if (uids?.length) {
      return { name, entries: entries.filter((e) => uids.includes(e.uid)) };
    }
    if (mode === 'full') return { name, entries };
    return { name, entry_count: entries.length, entries: entries.map(entrySummary) };
  },
);

/** Template matching ST's new-entry defaults. */
const NEW_ENTRY_DEFAULTS = {
  key: [], keysecondary: [], comment: '', content: '', constant: false,
  vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
  order: 100, position: 0, disable: false, excludeRecursion: false,
  preventRecursion: false, delayUntilRecursion: false, probability: 100,
  useProbability: true, depth: 4, group: '', groupOverride: false,
  groupWeight: 100, scanDepth: null, caseSensitive: null,
  matchWholeWords: null, useGroupScoring: null, automationId: '', role: null,
  sticky: 0, cooldown: 0, delay: 0, triggers: [],
};

tool(
  'upsert_worldbook_entry',
  'Create or update a worldbook entry. If `uid` is omitted (or not found), a new entry is created. `entry` holds the fields to set: key (array of trigger words), content, comment, constant (blue light), disable, position, order, probability, etc. Creates the worldbook if it does not exist.',
  {
    name: z.string().describe('Worldbook name'),
    uid: z.number().optional().describe('Entry uid to update; omit to create a new entry'),
    entry: z.record(z.any()).describe('Entry fields to set/merge'),
  },
  async ({ name, uid, entry }) => {
    let wb;
    try {
      wb = await st.post('/api/worldinfo/get', { name });
    } catch {
      wb = { entries: {} };
    }
    const entries = wb.entries ?? {};
    let target = uid;
    let created = false;
    if (target === undefined || !entries[target]) {
      const used = Object.keys(entries).map(Number);
      target = used.length ? Math.max(...used) + 1 : 0;
      entries[target] = { ...NEW_ENTRY_DEFAULTS, uid: target, displayIndex: target };
      created = true;
    }
    entries[target] = { ...entries[target], ...entry, uid: target };
    await st.post('/api/worldinfo/edit', { name, data: { entries } });
    return { ok: true, uid: target, created };
  },
);

tool(
  'delete_worldbook_entry',
  'Delete a single entry from a worldbook by uid.',
  {
    name: z.string().describe('Worldbook name'),
    uid: z.number().describe('Entry uid to delete'),
  },
  async ({ name, uid }) => {
    const wb = await st.post('/api/worldinfo/get', { name });
    const entries = wb.entries ?? {};
    if (!entries[uid]) throw new Error(`Entry uid ${uid} not found in "${name}"`);
    delete entries[uid];
    await st.post('/api/worldinfo/edit', { name, data: { entries } });
    return { ok: true, deleted_uid: uid, remaining: Object.keys(entries).length };
  },
);

tool(
  'delete_worldbook',
  'Delete an ENTIRE worldbook file. Destructive — requires confirm:true.',
  {
    name: z.string().describe('Worldbook name'),
    confirm: z.boolean().describe('Must be true to actually delete'),
  },
  async ({ name, confirm }) => {
    if (!confirm) throw new Error('Set confirm:true to delete the whole worldbook.');
    await st.post('/api/worldinfo/delete', { name });
    return { ok: true, deleted: name };
  },
);

/* ------------------------------------------------------------------ */
/* Chats                                                               */
/* ------------------------------------------------------------------ */

tool(
  'list_chats',
  'List chat files of a character (file id, message count, size). Pass the file id to get_chat to read messages.',
  {
    avatar_url: z.string().describe('Avatar filename, e.g. "MyChar.png"'),
  },
  async ({ avatar_url }) => {
    const chats = await st.post('/api/characters/chats', { avatar_url });
    if (chats.error) throw new Error('No chats found for this character.');
    return Object.values(chats).map((c) => ({
      file_id: c.file_id,
      chat_items: c.chat_items,
      file_size: c.file_size,
    }));
  },
);

tool(
  'get_chat',
  'Read messages from a chat file. Returns the last `last` messages (default 10) with name/is_user/send_date/mes.',
  {
    avatar_url: z.string().describe('Avatar filename, e.g. "MyChar.png"'),
    file_id: z.string().describe('Chat file id from list_chats (with or without .jsonl)'),
    last: z.number().optional().describe('How many trailing messages to return (default 10)'),
  },
  async ({ avatar_url, file_id, last = 10 }) => {
    const ch_name = avatar_url.replace(/\.png$/i, '');
    const file_name = file_id.replace(/\.jsonl$/i, '');
    const data = await st.post('/api/chats/get', { ch_name, file_name, avatar_url });
    const [meta, ...messages] = data;
    const slice = messages.slice(-last);
    return {
      total_messages: messages.length,
      returned: slice.length,
      user_name: meta?.user_name,
      character_name: meta?.character_name,
      messages: slice.map((m) => ({
        name: m.name,
        is_user: m.is_user,
        send_date: m.send_date,
        mes: m.mes,
      })),
    };
  },
);

/* ------------------------------------------------------------------ */
/* Play — requires the 小狸连接器 Tavern-Helper script in the browser  */
/* ------------------------------------------------------------------ */

tool(
  'play_status',
  'Check whether the in-browser tavern connector is online, and which character/chat is currently open. All play_* tools need the 小狸连接器 script running inside SillyTavern (酒馆助手 → 脚本库).',
  {},
  async () => {
    if (!bridge.connected) {
      return { connected: false, hint: 'Open SillyTavern in a browser with the 小狸连接器 script enabled.' };
    }
    const info = await bridge.call('status');
    return { connected: true, ...info };
  },
);

tool(
  'play_send',
  'Play the currently open chat as the user: sends `text` as a user message, triggers the AI reply (full prompt assembly — preset, worldbook, regex all apply) and returns the reply. Set trigger:false to only add the message without generating.',
  {
    text: z.string().describe('Message to send as the user'),
    trigger: z.boolean().optional().describe('Trigger an AI reply and wait for it (default true)'),
    timeout_s: z.number().optional().describe('Max seconds to wait for the reply (default 180)'),
  },
  async ({ text, trigger = true, timeout_s = 180 }) => {
    return bridge.call('send', { text, trigger }, (timeout_s + 5) * 1000);
  },
);

tool(
  'play_trigger',
  'Trigger an AI reply in the currently open chat without adding a user message (e.g. to let the character continue), and return the reply.',
  {
    timeout_s: z.number().optional().describe('Max seconds to wait (default 180)'),
  },
  async ({ timeout_s = 180 }) => bridge.call('trigger', {}, (timeout_s + 5) * 1000),
);

tool(
  'play_recent_messages',
  'Read the last N messages of the CURRENTLY OPEN chat (live, via the browser). For closed/other chats use get_chat instead.',
  {
    n: z.number().optional().describe('How many messages (default 4)'),
  },
  async ({ n = 4 }) => bridge.call('last_messages', { n }),
);

tool(
  'play_list_presets',
  'List available completion preset names (current API mode). Use play_set_preset to switch.',
  {},
  async () => {
    const settings = await st.post('/api/settings/get');
    return { openai_presets: settings.openai_setting_names ?? [] };
  },
);

tool(
  'play_set_preset',
  'Switch the active completion preset in the open tavern (like picking a different 预设 in the UI). Affects the next generation.',
  {
    name: z.string().describe('Preset name from play_list_presets'),
  },
  async ({ name }) => bridge.call('preset', { name }),
);

tool(
  'play_set_model',
  'Switch the model within the currently selected API backend (STScript /model). Pass the model id/name as shown in the ST model dropdown.',
  {
    name: z.string().describe('Model name/id'),
  },
  async ({ name }) => bridge.call('model', { name }),
);

tool(
  'play_stscript',
  'Run a raw /STScript command in the open tavern and return its pipe result. Escape hatch for anything the other play tools do not cover (e.g. "/swipes-count", "/api"). The agent has the same power as a user typing into the ST input box — be careful with destructive commands.',
  {
    script: z.string().describe('STScript command, e.g. "/preset | /echo {{pipe}}"'),
  },
  async ({ script }) => {
    const result = await bridge.call('stscript', { script }, 60_000);
    return { pipe: result?.pipe ?? null };
  },
);

/* ------------------------------------------------------------------ */

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`sillytavern-api-mcp connected (target: ${st.baseUrl})`);
