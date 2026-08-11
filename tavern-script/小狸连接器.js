// ============================================================
// 小狸连接器 v0.2.0
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
      ws.send(JSON.stringify({ type: 'hello', agent: 'tanuki-connector', version: '0.2.0' }));
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
