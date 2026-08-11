// End-to-end smoke test: spawns the MCP server over stdio and exercises the
// management tools against a live SillyTavern. Writes touch only a scratch
// worldbook and a duplicated scratch card (cleaned up afterwards).
//
// Usage:  ST_USER=... ST_PASSWORD=... node smoke.mjs
// Optional: SMOKE_CHAR=MyChar.png to pick the test character (default: the
// character with the most recent chat).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { STClient } from './src/client.js';

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ['src/server.js'], env: process.env }),
);

let failures = 0;
async function call(name, args, expect, { expectError = false } = {}) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.[0]?.text ?? '';
    const bad = expectError ? !res.isError : (res.isError || (expect && !text.includes(expect)));
    if (bad) failures++;
    console.log(`${bad ? 'FAIL' : ' ok '} ${name} ${JSON.stringify(args).slice(0, 60)}`);
    console.log(`      ${text.replace(/\s+/g, ' ').slice(0, 220)}`);
    return text;
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
    return '';
  }
}

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '), '\n');

// Pick a test character: SMOKE_CHAR env var, or the most recently played one.
const st = new STClient();
const allChars = await st.post('/api/characters/all');
if (!allChars.length) {
  console.log('No characters in this SillyTavern instance — aborting.');
  process.exit(1);
}
const testChar =
  process.env.SMOKE_CHAR ??
  [...allChars].sort((a, b) => (b.date_last_chat ?? 0) - (a.date_last_chat ?? 0))[0].avatar;
console.log('test character:', testChar, '\n');

await call('st_status', {}, '"version"');
await call('list_characters', { filter: testChar.slice(0, 2) }, '"avatar"');
await call('get_character', { avatar_url: testChar }, '"name"');
await call('get_character', { avatar_url: testChar, fields: ['data.character_version'] }, 'character_version');
await call('list_worldbooks', {}, '"count"');
await call('play_status', {}, '"connected"');
await call('play_list_presets', {}, 'presets');

// worldbook write cycle on scratch book
const WB = '__tanuki_smoke_test__';
await call('upsert_worldbook_entry', {
  name: WB,
  entry: { comment: 'entry A', key: ['alpha'], content: 'content A' },
}, '"created": true');
await call('upsert_worldbook_entry', { name: WB, uid: 0, entry: { content: 'content A v2' } }, '"created": false');
await call('get_worldbook', { name: WB }, 'entry A');
await call('get_worldbook', { name: WB, uids: [0] }, 'content A v2');
await call('upsert_worldbook_entry', { name: WB, entry: { comment: 'entry B' } }, '"uid": 1');
await call('delete_worldbook_entry', { name: WB, uid: 1 }, '"deleted_uid": 1');
await call('delete_worldbook', { name: WB, confirm: false }, undefined, { expectError: true });
await call('delete_worldbook', { name: WB, confirm: true }, '"ok": true');

// chats (read-only)
const chatsText = await call('list_chats', { avatar_url: testChar }, 'file_id');
try {
  const fileId = JSON.parse(chatsText)[0]?.file_id;
  if (fileId) {
    await call('get_chat', { avatar_url: testChar, file_id: fileId, last: 2 }, 'total_messages');
  }
} catch {
  console.log('      (skipping get_chat — no chats)');
}

// edit_character / merge_character_data on a duplicated scratch card
try {
  const dup = await st.post('/api/characters/duplicate', { avatar_url: testChar });
  const scratch = dup.path.split(/[\\/]/).pop();
  console.log('\nscratch card:', scratch);
  await call('edit_character', {
    avatar_url: scratch,
    field: 'personality',
    value: 'SMOKE_TEST_MARKER',
  }, '"ok": true');
  const check = await call('get_character', { avatar_url: scratch, fields: ['personality', 'data.personality'] }, 'SMOKE_TEST_MARKER');
  if (!check.includes('"personality": "SMOKE_TEST_MARKER"') || !check.includes('"data.personality": "SMOKE_TEST_MARKER"')) {
    failures++;
    console.log('FAIL both-copies sync check');
  }
  await call('merge_character_data', {
    avatar_url: scratch,
    edits: { data: { character_version: 'SMOKE_9.9.9' } },
  }, '"ok": true');
  await call('get_character', { avatar_url: scratch, fields: ['data.character_version'] }, 'SMOKE_9.9.9');
  await st.post('/api/characters/delete', { avatar_url: scratch, delete_chats: true });
  console.log('scratch card deleted');
} catch (e) {
  failures++;
  console.log('FAIL edit_character cycle:', e.message);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
await client.close();
process.exit(failures ? 1 : 0);
