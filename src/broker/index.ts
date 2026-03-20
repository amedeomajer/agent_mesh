import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { BrokerInbound } from '../shared/protocol.js';
import { DEFAULT_PORT } from '../shared/constants.js';
import { Registry } from './registry.js';
import { History } from './history.js';
import { Router } from './router.js';

const PORT = parseInt(process.env.BROKER_PORT || String(DEFAULT_PORT));

const registry = new Registry();
const history = new History();
const router = new Router(registry, history);

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (ws: WebSocket) => {
  let agentName: string | null = null;

  ws.on('message', (raw) => {
    let msg: BrokerInbound;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

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
    if (agentName) {
      registry.remove(agentName);
      console.log(`[-] ${agentName} disconnected`);
    }
  });
});

console.log(`Broker started on ws://localhost:${PORT}`);
