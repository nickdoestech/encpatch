/**
 * WsHub — broadcasts live events to all connected UI clients.
 *
 * Events sent:
 *   { type: 'event',    payload: { direction, transport, event, mapping? } }
 *   { type: 'mappings', payload: [...mappings] }
 *   { type: 'config',   payload: {...config} }
 *   { type: 'log',      payload: { source, message, ts } }
 */

const { WebSocketServer } = require('ws');

class WsHub {
  constructor() {
    this.clients = new Set();
    this.recentEvents = [];
    this.MAX_RECENT = 200;
  }

  attach(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', payload: { recent: this.recentEvents.slice(-50) } }));
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  // v0.13.20: graceful shutdown — close every client socket then the
  // server socket. Without this the WebSocket server's listener stays
  // bound after app quit, leaking a port and (more importantly) keeping
  // the Node event loop alive so the app can't terminate cleanly.
  close() {
    try {
      for (const ws of this.clients) {
        try { ws.terminate(); } catch (_) {}
      }
      this.clients.clear();
    } catch (_) {}
    try { if (this.wss) this.wss.close(); } catch (_) {}
    this.wss = null;
  }

  broadcast(msg) {
    if (msg && msg.type === 'event') {
      this.recentEvents.push({ ...msg.payload, ts: Date.now() });
      if (this.recentEvents.length > this.MAX_RECENT) this.recentEvents.shift();
    }
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(data); } catch (_) {}
      }
    }
  }

  log(source, message) {
    const payload = { source, message, ts: Date.now() };
    // In a packaged Electron app stdout may be closed — console.log can
    // throw EPIPE which crashes the process. Swallow it.
    try { console.log(`[${source}] ${message}`); } catch (_) {}
    this.broadcast({ type: 'log', payload });
  }
}

module.exports = WsHub;
