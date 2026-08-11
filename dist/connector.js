// ============================================================
// 小狸连接器 v0.3.0
// 让 AI 编程助手（Claude Code 等）通过 tavern-tanuki MCP 服务器
// 在酒馆里替你跑堂：代发消息、触发回复、切预设、切模型。
//
// 用法：酒馆助手 → 脚本库 → 新建脚本，粘贴本文件内容并启用。
// 要求：tavern-tanuki MCP 服务器在本机运行（它监听 127.0.0.1:6700）。
// 注意：云酒馆(https)因浏览器混合内容限制连不上本机 ws，请用本地酒馆。
// ============================================================

(() => {
  const PORT = 6700;
  const URL = `ws://127.0.0.1:${PORT}`;
  let ws = null;
  let retry = null;
  let announced = false;
  let busy = false;

  // ---------- 工具函数 ----------

  const lastId = () => getLastMessageId();

  function readMessage(id) {
    const m = getChatMessages(id)[0];
    return m ? { id, name: m.name, role: m.role, text: m.message } : null;
  }

  function readRecent(n) {
    const end = lastId();
    const start = Math.max(0, end - n + 1);
    const out = [];
    for (let i = start; i <= end; i++) {
      const m = readMessage(i);
      if (m) out.push(m);
    }
    return { total: end + 1, messages: out };
  }

  /** 等待一次生成结束（含用户手动中止），返回最后一条消息 */
  function waitGeneration(timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, err) => {
        if (done) return;
        done = true;
        eventRemoveListener(tavern_events.GENERATION_ENDED, onEnd);
        eventRemoveListener(tavern_events.GENERATION_STOPPED, onEnd);
        clearTimeout(timer);
        if (ok) setTimeout(() => resolve(readMessage(lastId())), 300);
        else reject(err);
      };
      const onEnd = () => finish(true);
      const timer = setTimeout(
        () => finish(false, new Error('生成超时（可能酒馆没在生成，或模型太慢）')),
        timeoutMs,
      );
      eventOn(tavern_events.GENERATION_ENDED, onEnd);
      eventOn(tavern_events.GENERATION_STOPPED, onEnd);
    });
  }

  // ---------- 提示词捕获（X光机） ----------
  // 监听酒馆"提示词就绪"事件，抓下每次真正发给 LLM 的完整组装结果。
  // dryRun（token 计数）跳过；聊天补全和文本补全两种模式都接。
  let lastPrompt = null;

  eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, (data) => {
    try {
      if (!data || data.dryRun) return;
      lastPrompt = {
        kind: 'chat_completion',
        at: new Date().toISOString(),
        messages: JSON.parse(JSON.stringify(data.messages ?? [])),
      };
    } catch (e) { console.warn('[小狸] 提示词捕获失败', e); }
  });

  eventOn(tavern_events.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
    try {
      if (!data || data.dryRun) return;
      lastPrompt = {
        kind: 'text_completion',
        at: new Date().toISOString(),
        messages: [{ role: 'combined', content: String(data.prompt ?? '') }],
      };
    } catch (e) { console.warn('[小狸] 提示词捕获失败', e); }
  });

  // ---------- 指令处理 ----------

  const handlers = {
    async status() {
      const char = await triggerSlash('/pass {{char}}');
      const user = await triggerSlash('/pass {{user}}');
      return { character: char, persona: user, last_message_id: lastId() };
    },

    async send({ text, trigger = true }, timeoutMs) {
      if (busy) throw new Error('上一条还在生成中');
      busy = true;
      try {
        await createChatMessages([{ role: 'user', content: text }]);
        if (!trigger) return { sent: true, message_id: lastId() };
        const wait = waitGeneration(timeoutMs - 2000);
        await triggerSlash('/trigger');
        return await wait;
      } finally {
        busy = false;
      }
    },

    async trigger(_args, timeoutMs) {
      if (busy) throw new Error('上一条还在生成中');
      busy = true;
      try {
        const wait = waitGeneration(timeoutMs - 2000);
        await triggerSlash('/trigger');
        return await wait;
      } finally {
        busy = false;
      }
    },

    async last_messages({ n = 4 }) {
      return readRecent(Math.min(n, 50));
    },

    async preset({ name }) {
      await triggerSlash(`/preset ${name}`);
      const now = await triggerSlash('/preset');
      return { active_preset: now };
    },

    async model({ name }) {
      await triggerSlash(`/model ${name}`);
      return { ok: true, model: name };
    },

    async stscript({ script }) {
      const pipe = await triggerSlash(script);
      return { pipe: pipe ?? null };
    },

    async prompt({ mode = 'summary', search, index }) {
      if (!lastPrompt) {
        throw new Error('还没捕获到提示词——先生成一次（play_send，或你自己在酒馆里发一条消息）');
      }
      const { kind, at, messages } = lastPrompt;
      const total_chars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
      const base = { kind, captured_at: at, message_count: messages.length, total_chars };

      if (typeof index === 'number') {
        const m = messages[index];
        if (!m) throw new Error(`没有第 ${index} 条消息（共 ${messages.length} 条）`);
        return { ...base, index, role: m.role, name: m.name, content: m.content };
      }
      if (search) {
        const matches = [];
        messages.forEach((m, i) => {
          const c = m.content ?? '';
          let pos = c.indexOf(search);
          while (pos !== -1 && matches.length < 10) {
            matches.push({ index: i, role: m.role, pos, context: c.slice(Math.max(0, pos - 100), pos + search.length + 100) });
            pos = c.indexOf(search, pos + 1);
          }
        });
        return { ...base, search, match_count: matches.length, matches };
      }
      if (mode === 'full') {
        return { ...base, messages };
      }
      return {
        ...base,
        messages: messages.map((m, i) => ({
          i, role: m.role, name: m.name || undefined,
          chars: m.content?.length ?? 0,
          head: (m.content ?? '').slice(0, 120),
        })),
      };
    },
  };

  // ---------- WebSocket 连接 ----------

  function connect() {
    try {
      ws = new WebSocket(URL);
    } catch (e) {
      scheduleRetry();
      return;
    }

    ws.onopen = () => {
      if (!announced) {
        toastr.success('已连接 AI 编程助手', '酒馆小狸');
        announced = true;
      }
      ws.send(JSON.stringify({ type: 'hello', agent: 'tanuki-connector', version: '0.3.0' }));
    };

    ws.onmessage = async (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg.cmd || msg.id === undefined) return;
      const timeoutMs = msg.args?.__timeout_ms ?? 180000;
      try {
        const handler = handlers[msg.cmd];
        if (!handler) throw new Error(`未知指令: ${msg.cmd}`);
        const data = await handler(msg.args ?? {}, timeoutMs);
        ws.send(JSON.stringify({ id: msg.id, ok: true, data }));
      } catch (e) {
        ws.send(JSON.stringify({ id: msg.id, ok: false, error: String(e?.message ?? e) }));
      }
    };

    ws.onclose = () => {
      ws = null;
      scheduleRetry();
    };
    ws.onerror = () => {
      try { ws?.close(); } catch {}
    };
  }

  function scheduleRetry() {
    if (retry) return;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, 5000);
  }

  connect();

  // 页面卸载时自己收拾（防监听器/连接残留）
  window.addEventListener('pagehide', () => {
    try { ws?.close(); } catch {}
    if (retry) clearTimeout(retry);
  });
})();
