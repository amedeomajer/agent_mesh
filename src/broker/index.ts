import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
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

// Uploads directory
const uploadsDir = resolve(__dirname, '..', '..', 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

// HTTP server serves the GUI and uploads
const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(guiHtml);
    return;
  }

  // Serve uploaded images
  if (req.method === 'GET' && req.url?.startsWith('/uploads/')) {
    const filename = req.url.slice('/uploads/'.length);
    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
      res.writeHead(400);
      res.end('Invalid filename');
      return;
    }
    const filePath = resolve(uploadsDir, filename);
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(readFileSync(filePath));
    return;
  }

  // Upload endpoint
  if (req.method === 'POST' && req.url === '/uploads') {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
    };

    const contentType = req.headers['content-type'] || '';
    if (!ALLOWED_TYPES[contentType]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only image files are allowed (png, jpg, gif, webp, svg)' }));
      return;
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_SIZE) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large. Maximum size is 10MB.' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks);

      const ext = ALLOWED_TYPES[contentType];
      const filename = `img-${Date.now()}${ext}`;
      const filePath = resolve(uploadsDir, filename);
      writeFileSync(filePath, body);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ filename, path: filePath, url: `/uploads/${filename}` }));
    });
    return;
  }

  // CORS preflight for uploads
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end('Not found');
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
      const ok = registry.add(msg.agentName, ws, msg.description);
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
