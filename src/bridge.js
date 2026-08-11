/**
 * WebSocket bridge to the in-browser connector script (小狸连接器).
 *
 * The MCP server hosts a WS server on 127.0.0.1 (default port 6700). A small
 * Tavern-Helper script running inside SillyTavern connects out to it and
 * executes commands in the browser context — where presets, worldbooks and
 * prompt assembly actually live. This is what enables "playing" a card.
 */
import { WebSocketServer } from 'ws';

export class Bridge {
  constructor(port = Number(process.env.ST_BRIDGE_PORT ?? 6700)) {
    this.port = port;
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
    this.disabled = false;
    this.wss = new WebSocketServer({ host: '127.0.0.1', port });
    this.wss.on('error', (e) => {
      this.disabled = true;
      console.error(`[bridge] WS server error (${e.code ?? e.message}) — play tools disabled. ` +
        'Is another tavern-tanuki instance running on the same port?');
    });
    this.wss.on('connection', (ws) => {
      // Newest connection wins (e.g. after a tavern page reload).
      if (this.socket && this.socket.readyState === 1) this.socket.close();
      this.socket = ws;
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          waiter(msg);
        }
      });
      ws.on('close', () => {
        if (this.socket === ws) this.socket = null;
      });
    });
  }

  get connected() {
    return !!this.socket && this.socket.readyState === 1;
  }

  /** Send a command to the connector script and await its response. */
  call(cmd, args = {}, timeoutMs = 30_000) {
    if (!this.connected) {
      throw new Error(
        'Tavern connector is not connected. Make sure SillyTavern is open in a browser ' +
        'and the 小狸连接器 script is enabled in Tavern-Helper (酒馆助手 → 脚本库).',
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge command "${cmd}" timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.ok) resolve(msg.data);
        else reject(new Error(msg.error ?? 'Unknown bridge error'));
      });
      this.socket.send(JSON.stringify({ id, cmd, args }));
    });
  }
}
