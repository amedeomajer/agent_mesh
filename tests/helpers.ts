import { vi } from 'vitest';

export interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  sent: unknown[];
}

export function createMockWs(): MockWebSocket {
  const sent: unknown[] = [];
  return {
    send: vi.fn((data: string) => { sent.push(JSON.parse(data)); }),
    once: vi.fn(),
    sent,
  };
}

export function lastSent(ws: MockWebSocket): any {
  return ws.sent[ws.sent.length - 1];
}
