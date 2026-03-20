import type { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import type {
  BrokerOutbound,
  ListAgentsResponse,
  ReadHistoryResponse,
} from '../shared/protocol.js';

export const toolDefinitions = [
  {
    name: 'send_message',
    description:
      'Send a message to another agent on the mesh. Use "*" as the recipient to broadcast to all agents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        to: {
          type: 'string',
          description: 'Agent name to send to, or "*" for broadcast',
        },
        content: {
          type: 'string',
          description: 'The message content',
        },
      },
      required: ['to', 'content'],
    },
  },
  {
    name: 'list_agents',
    description: 'List all agents currently connected to the mesh',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'read_history',
    description: 'Read recent message history from the mesh',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'Filter by sender agent name (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max messages to return (default 20)',
        },
      },
    },
  },
];

// Pending request-response tracking
const pending = new Map<
  string,
  { resolve: (value: BrokerOutbound) => void }
>();

export function resolvePending(msg: BrokerOutbound): boolean {
  if ('requestId' in msg && msg.requestId) {
    const entry = pending.get(msg.requestId);
    if (entry) {
      pending.delete(msg.requestId);
      entry.resolve(msg);
      return true;
    }
  }
  return false;
}

function request(ws: WebSocket, data: Record<string, unknown>): Promise<BrokerOutbound> {
  const requestId = uuid();
  return new Promise((resolve) => {
    pending.set(requestId, { resolve });
    ws.send(JSON.stringify({ ...data, requestId }));
  });
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ws: WebSocket,
  agentName: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  switch (toolName) {
    case 'send_message': {
      const to = args.to as string;
      const content = args.content as string;
      ws.send(
        JSON.stringify({
          type: 'send',
          id: uuid(),
          from: agentName,
          to,
          content,
          timestamp: new Date().toISOString(),
        }),
      );
      const target = to === '*' ? 'all agents' : `"${to}"`;
      return text(`Message sent to ${target}.`);
    }

    case 'list_agents': {
      const resp = (await request(ws, {
        type: 'list_agents',
      })) as ListAgentsResponse;

      if (resp.agents.length === 0) {
        return text('No other agents are connected.');
      }
      const lines = resp.agents.map(
        (a) => `- ${a.name} (since ${a.connectedAt})`,
      );
      return text(`Connected agents:\n${lines.join('\n')}`);
    }

    case 'read_history': {
      const resp = (await request(ws, {
        type: 'read_history',
        from: args.from,
        limit: args.limit,
      })) as ReadHistoryResponse;

      if (resp.messages.length === 0) {
        return text('No messages in history.');
      }
      const lines = resp.messages.map(
        (m) => `[${m.timestamp}] ${m.from} -> ${m.to}: ${m.content}`,
      );
      return text(lines.join('\n'));
    }

    default:
      return text(`Unknown tool: ${toolName}`);
  }
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
