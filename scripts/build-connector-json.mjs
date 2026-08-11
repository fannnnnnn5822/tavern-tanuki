// Packs tavern-script/loader.js into an importable Tavern-Helper script
// JSON (酒馆助手 → 脚本库 → 导入). The loader pulls dist/connector.js from
// jsDelivr at the commit pinned by Supabase sb_config.tanuki_script_ref, so
// users import ONCE and get every future update automatically.
//   node scripts/build-connector-json.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const content = readFileSync(join(root, 'tavern-script', 'loader.js'), 'utf8');

const script = {
  type: 'script',
  enabled: true,
  name: '🦝 酒馆小狸连接器',
  // Stable id so that re-importing updates instead of duplicating.
  id: 'a7f3c9d2-4b8e-4f1a-9c6d-tanuki000001',
  content,
  info:
    '酒馆小狸 (tavern-tanuki) 的酒馆侧连接器（云端自动更新版）：连接本机 MCP 服务器 (ws://127.0.0.1:6700)，' +
    '让 AI 编程助手能代发消息、触发回复、切预设、切模型。导入一次即可，之后自动获取最新版。' +
    '需要 tavern-tanuki MCP 服务器在本机运行。本体源码与仓库: https://github.com/fannnnnnn5822/tavern-tanuki',
  button: { enabled: false, buttons: [] },
  data: {},
};

const out = join(root, 'tavern-script', '酒馆小狸连接器.json');
writeFileSync(out, JSON.stringify(script, null, 2));
console.log('written:', out, `(${content.length} chars of JS)`);
