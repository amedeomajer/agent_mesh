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
      'Send a message to another agent on the mesh. Use "*" as the recipient to broadcast to all agents. When deliberating with other agents, set messageType to "deliberation" for thinking/discussion messages and "final" when delivering the agreed-upon answer.',
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
        messageType: {
          type: 'string',
          enum: ['normal', 'deliberation', 'final'],
          description:
            'Message type. Use "deliberation" when discussing/thinking with other agents (these are shown collapsed in the UI). Use "final" to deliver the concluded answer to the user. Defaults to "normal".',
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
        since: {
          type: 'string',
          description:
            'ISO 8601 timestamp — only return messages after this time (optional)',
        },
        wait: {
          type: 'number',
          description:
            'Seconds to wait for new messages if none available (long-poll, max 30). Returns immediately when a message arrives.',
        },
      },
    },
  },
  {
    name: 'start_polling',
    description:
      'Returns the ready-to-use CronCreate configuration for polling the mesh every 1 minute. Call this tool once, then pass the returned config to CronCreate to start automatic polling.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
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
      const rawContent = args.content as string;
      const messageType = (args.messageType as string) || 'normal';
      const content =
        messageType === 'deliberation' ? `[deliberation] ${rawContent}` :
        messageType === 'final' ? `[final] ${rawContent}` :
        rawContent;
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
        (a) => a.description
          ? `- ${a.name}: ${a.description} (since ${a.connectedAt})`
          : `- ${a.name} (since ${a.connectedAt})`,
      );
      return text(`Connected agents:\n${lines.join('\n')}`);
    }

    case 'read_history': {
      const resp = (await request(ws, {
        type: 'read_history',
        from: args.from,
        limit: args.limit,
        since: args.since,
        wait: args.wait,
      })) as ReadHistoryResponse;

      if (resp.messages.length === 0) {
        return text('No messages in history.');
      }
      const lines = resp.messages.map(
        (m) => `[${m.timestamp}] ${m.from} -> ${m.to}: ${m.content}`,
      );
      return text(lines.join('\n'));
    }

    case 'start_polling': {
      const cronConfig = {
        cron: '* * * * *',
        prompt: `Check the agent mesh for new messages using read_history. If there are new messages that are relevant to you or broadcast to everyone, respond appropriately. Be concise.`,
        recurring: true,
      };
      return text(
        `To start polling, call CronCreate with this config:\n\n` +
        `cron: "${cronConfig.cron}"\n` +
        `prompt: "${cronConfig.prompt}"\n` +
        `recurring: ${cronConfig.recurring}\n\n` +
        `This will check for new messages every 1 minute.`,
      );
    }

    default:
      return text(`Unknown tool: ${toolName}`);
  }
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
