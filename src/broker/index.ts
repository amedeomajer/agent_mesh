import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { BrokerInbound } from '../shared/protocol.js';
import { DEFAULT_PORT } from '../shared/constants.js';
import { Registry } from './registry.js';
import { History } from './history.js';
import { Router } from './router.js';
import { v4 as uuid } from 'uuid';

const PORT = parseInt(process.env.BROKER_PORT || String(DEFAULT_PORT));

const registry = new Registry();
const history = new History();
const router = new Router(registry, history);

// Load the GUI HTML file
const __dirname = dirname(fileURLToPath(import.meta.url));
const guiHtml = readFileSync(resolve(__dirname, 'gui.html'), 'utf-8');

// HTTP server serves the GUI
const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(guiHtml);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// WebSocket server attaches to HTTP server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  let agentName: string | null = null;
  let isViewer = false;

  ws.on('message', (raw) => {
    let msg: BrokerInbound;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    // Viewer registration
    if (msg.type === 'register_viewer') {
      isViewer = true;
      registry.addViewer(ws);
      console.log('[+] Viewer connected');
      // Send current agent list immediately
      ws.send(JSON.stringify({
        type: 'system_event',
        event: 'agent_connected',
        agentName: '',
        timestamp: new Date().toISOString(),
        agents: registry.list(),
      }));
      return;
    }

    // Agent registration
    if (msg.type === 'register') {
      const ok = registry.add(msg.agentName, ws);
      if (!ok) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Agent name "${msg.agentName}" is already taken`,
          }),
        );
        return;
      }
      agentName = msg.agentName;
      console.log(`[+] ${agentName} connected`);
      router.broadcastSystemEvent('agent_connected', agentName);
      return;
    }

    // Viewer sending a message or reading history
    if (isViewer && (msg.type === 'send' || msg.type === 'read_history')) {
      router.handle(msg.from || 'human', ws, msg);
      return;
    }

    if (!agentName) {
      ws.send(
        JSON.stringify({ type: 'error', message: 'Must register first' }),
      );
      return;
    }

    router.handle(agentName, ws, msg);
  });

  ws.on('close', () => {
    if (isViewer) {
      registry.removeViewer(ws);
      console.log('[-] Viewer disconnected');
    }
    if (agentName) {
      registry.remove(agentName);
      console.log(`[-] ${agentName} disconnected`);
      router.broadcastSystemEvent('agent_disconnected', agentName);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Broker started on http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Web GUI:   http://localhost:${PORT}`);
});
