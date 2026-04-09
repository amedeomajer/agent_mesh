import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

export async function startTestBroker(port: number): Promise<ChildProcess> {
  const proc = spawn('npx', ['tsx', 'src/broker/index.ts'], {
    env: { ...process.env, BROKER_PORT: String(port) },
    stdio: 'pipe',
    cwd: process.cwd(),
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Broker failed to start')), 5000);
    proc.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('Broker started')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return proc;
}

export function connectAgent(
  port: number,
  name: string,
  role?: string,
): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const messages: any[] = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'register',
        agentName: name,
        ...(role ? { role } : {}),
      }));
      resolve({ ws, messages });
    });

    ws.on('message', (raw: Buffer) => {
      messages.push(JSON.parse(raw.toString()));
    });

    ws.on('error', reject);
  });
}

export function sendAndWait(
  ws: WebSocket,
  messages: any[],
  msg: Record<string, unknown>,
  responseType: string,
  timeoutMs = 5000,
): Promise<any> {
  const requestId = msg.requestId || `req-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${responseType}`)), timeoutMs);

    const check = () => {
      const match = messages.find(
        (m: any) => (m.type === responseType || m.type === 'workflow:error') && m.requestId === requestId,
      );
      if (match) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(match);
      }
    };

    const interval = setInterval(check, 50);
    ws.send(JSON.stringify({ ...msg, requestId }));

    // Check immediately in case response is already there
    setTimeout(check, 10);
  });
}
