// 酒馆小狸一键发版：重打包 loader JSON → commit+push → 自动切 Supabase 版本指针
// 用法：node 发版.mjs "改了什么的一句话"
// 前提：gh/git 已登录；service key 在工作区根目录 .env.supabase（一行 SUPABASE_SERVICE_KEY=sb_secret_xxx）
// 忘了换指针也不会炸：加载器拉不到指针时退回 @main（jsDelivr 缓存最多捂 12 小时）。
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const msg = process.argv[2] ?? 'update';
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe' }).toString().trim();

// 1) 重打包可导入 JSON（loader 有改动时保持同步）
execSync(`node scripts/build-connector-json.mjs`, { cwd: root, stdio: 'inherit' });

// 2) commit + push（没有变更就跳过 commit，只推指针）
run('git add -A');
try {
  run(`git -c user.name=fannnnnnn5822 -c user.email=dr.weber.zahnarztpraxis@gmail.com commit -m "${msg.replace(/"/g, "'")}\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`);
  console.log('✅ committed:', msg);
} catch {
  console.log('（没有新变更，跳过 commit）');
}
run('git push origin master');
const hash = run('git rev-parse HEAD');
console.log('✅ 已推送。最新提交号:', hash);

// 3) 自动切 Supabase 指针 sb_config.tanuki_script_ref
const envFile = join(root, '..', '.env.supabase');
let svcKey = null;
if (existsSync(envFile)) {
  const m = readFileSync(envFile, 'utf8').match(/^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+?)\s*$/m);
  if (m) svcKey = m[1];
}
if (!svcKey) {
  console.log('⚠️ 没找到 .env.supabase / SUPABASE_SERVICE_KEY。');
  console.log(`→ 手动兜底：Supabase Table Editor 把 sb_config.tanuki_script_ref 换成：${hash}`);
  process.exit(0);
}

const SB = 'https://hieylivlsdmyznviumht.supabase.co/rest/v1/sb_config';
// ⚠️ UA 不能带 Mozilla：Supabase 会判定 secret key 在浏览器里用而 401
const headers = {
  apikey: svcKey,
  Authorization: `Bearer ${svcKey}`,
  'Content-Type': 'application/json',
  'User-Agent': 'tanuki-release/1.0',
  Prefer: 'return=representation',
};

try {
  let res = await fetch(`${SB}?key=eq.tanuki_script_ref`, {
    method: 'PATCH', headers, body: JSON.stringify({ value: hash }),
  });
  let rows = res.ok ? await res.json() : [];
  if (!rows.length) {
    // 行还不存在（首次发版）→ 插入
    res = await fetch(SB, { method: 'POST', headers, body: JSON.stringify({ key: 'tanuki_script_ref', value: hash }) });
    rows = res.ok ? await res.json() : [];
  }
  if (rows.length && rows[0].value === hash) {
    console.log('✅ tanuki_script_ref 已切到新提交号——玩家下次刷新酒馆即新版，发版收工。');
  } else {
    console.log(`⚠️ 指针没写成功（HTTP ${res.status}）。手动：Table Editor 把 sb_config.tanuki_script_ref 换成：${hash}`);
  }
} catch (e) {
  console.log('⚠️ 自动推指针失败：', e.message);
  console.log(`→ 手动兜底：Table Editor 把 sb_config.tanuki_script_ref 换成：${hash}`);
}
