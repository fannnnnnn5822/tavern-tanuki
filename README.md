# 酒馆小狸 tavern-tanuki

把你的 AI 编程助手（Claude Code / Cursor / Codex…）变成酒馆跑堂：**直接读写正在运行的酒馆**（角色卡、世界书、聊天记录），还能**替你玩卡/陪你玩卡**（代发消息、触发回复、切预设、切模型）。

An MCP server that lets coding agents manage **and play** a running SillyTavern instance.

## 两件套结构（谁装在哪）

| 部件 | 装在哪 | 作用 |
|---|---|---|
| **MCP 服务器**（本仓库） | AI 编程助手侧（如 Claude Code 的 `.mcp.json`） | 读写卡/世界书/聊天，全走酒馆 HTTP API |
| **小狸连接器**（`tavern-script/酒馆小狸连接器.json`，可选） | 酒馆侧：酒馆助手 → 脚本库 → **导入**此 JSON 文件 | 陪玩功能：代发消息/触发生成/切预设切模型 |

不装连接器也能用全部读写功能；装了连接器才解锁 `play_*` 陪玩工具。

## 工具一览（21 个）

**管理组**：`st_status` `list_characters` `get_character` `edit_character`（自动同步顶层+data.* 两份副本）`merge_character_data` `list_worldbooks` `get_worldbook`（summary 模式省 token）`upsert_worldbook_entry` `delete_worldbook_entry` `delete_worldbook`（需 confirm）`list_chats` `get_chat`

**陪玩组**：`play_status` `play_send`（以用户身份发消息并等回复，完整走预设/世界书/正则管线）`play_trigger` `play_recent_messages` `play_get_prompt`（⭐**提示词 X 光机**：捕获每次真正发给 LLM 的完整组装提示词——含用户手动生成的——验证世界书激活/插入顺序/标签结构；summary 模式省 token，search 定位条目，index 取单条全文）`play_list_presets` `play_set_preset` `play_set_model` `play_stscript`（STScript 万能后门）

## 安装

要求：Node ≥ 18，本地运行的 SillyTavern（默认 `http://127.0.0.1:8000`）。

1. clone 本仓库，`npm install`
2. 在 AI 编程助手的 MCP 配置里加：

```json
{
  "mcpServers": {
    "sillytavern": {
      "command": "node",
      "args": ["<path-to>/st-mcp/src/server.js"],
      "env": {
        "ST_URL": "http://127.0.0.1:8000",
        "ST_USER": "basic auth用户名（酒馆没开验证就删掉）",
        "ST_PASSWORD": "basic auth密码"
      }
    }
  }
}
```

3. （可选，陪玩用）在酒馆助手 → 脚本库 → 导入，选择 `tavern-script/酒馆小狸连接器.json`。连接成功酒馆会弹「已连接 AI 编程助手」。

导入的是一个轻量加载器：真正的连接器本体托管在本仓库 `dist/connector.js`，由 jsDelivr 分发、Supabase 版本指针控制——**导入一次，之后每次更新自动生效**，不用重新导入。想审代码就看 `dist/connector.js`（这就是实际在你酒馆里运行的全部代码）。

环境变量：`ST_BRIDGE_PORT` 可改陪玩桥端口（默认 6700，只监听 127.0.0.1）。

## 陪玩原理

酒馆的提示词组装（预设/世界书/正则）都发生在浏览器侧，纯服务器 API 触发不了完整生成。所以连接器脚本在酒馆里开一条 WebSocket 连到本机 MCP 服务器，agent 的 `play_send` → 浏览器里 `createChatMessages` + `/trigger` → 等 `GENERATION_ENDED` → 把回复带回来。**生成走的是你正常游玩的完整管线。**

⚠️ 云酒馆（https）因浏览器混合内容限制连不上本机 ws，陪玩功能仅限本地酒馆；管理组工具不受影响（ST_URL 指向哪就管哪）。

## 开发

```bash
ST_USER=... ST_PASSWORD=... node smoke.mjs   # 端到端冒烟测试（写操作只碰临时世界书和复制卡，测完清理）
node 发版.mjs "改动说明"                      # 维护者发版：打包→push→切 Supabase 版本指针，玩家刷新即新版
```

连接器结构：`tavern-script/loader.js`（加载器，打包成可导入 JSON）→ 按 Supabase `sb_config.tanuki_script_ref` 指针从 jsDelivr 拉取 `dist/connector.js`（本体）。指针指向具体提交号，`@提交号` 是全新 URL 必定回源，绕开 CDN 12 小时缓存实现发版秒切；指针失联时退回 `@main`。

## 安全性

- 只监听/连接 localhost；凭据放 MCP 配置 `env`，别提交真实密码到公开仓库。
- `play_stscript` 等于让 agent 拥有你在输入框里的全部权力，只在自己信任的本机使用。
- 删整本世界书需要显式 `confirm:true`。

## License

MIT
