import type { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import type {
  AgentRole,
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

const orchestratorTools = [
  {
    name: 'workflow_create',
    description: 'Create a new workflow from a YAML plan file. Validates the plan, creates workflow state, and returns the workflow ID with initial status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        planPath: {
          type: 'string',
          description: 'Absolute path to the YAML workflow plan file',
        },
      },
      required: ['planPath'],
    },
  },
  {
    name: 'workflow_assign',
    description: 'Assign a workflow task to an agent for either produce or review phase. The broker validates role match and delivers a context-rich notification to the assignee.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'The workflow ID' },
        taskId: { type: 'string', description: 'The task ID to assign' },
        phase: {
          type: 'string',
          enum: ['produce', 'review'],
          description: 'Which phase to assign: produce (create output) or review (check output)',
        },
        assignee: { type: 'string', description: 'Name of the agent to assign to' },
      },
      required: ['workflowId', 'taskId', 'phase', 'assignee'],
    },
  },
  {
    name: 'workflow_status',
    description: 'Get the current status of a workflow including all task states, assignees, and iteration counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'The workflow ID' },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'workflow_cancel',
    description: 'Cancel a running workflow. In-progress tasks are stalled. A cancelled workflow allows creating a new one.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'The workflow ID' },
        reason: { type: 'string', description: 'Optional reason for cancellation' },
      },
      required: ['workflowId'],
    },
  },
];

const workerStatusTool = {
  name: 'workflow_status',
  description: 'Get the current status of a workflow including all task states, assignees, and iteration counts.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      workflowId: { type: 'string', description: 'The workflow ID' },
    },
    required: ['workflowId'],
  },
};

const workerTools = [
  {
    name: 'workflow_complete',
    description:
      'Report completion of an assigned workflow task. Use result "done" after producing output, "approved" after reviewing acceptable work, or "changes_requested" with specific actionable feedback.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'The workflow ID' },
        taskId: { type: 'string', description: 'The task ID being completed' },
        result: {
          type: 'string',
          enum: ['done', 'approved', 'changes_requested'],
          description: 'done = production complete, approved = review passed, changes_requested = needs revision',
        },
        summary: { type: 'string', description: 'Summary of what was done or specific feedback' },
        branch: { type: 'string', description: 'Git branch where work was committed' },
      },
      required: ['workflowId', 'taskId', 'result', 'summary', 'branch'],
    },
  },
  workerStatusTool,
];

export function getToolDefinitions(role?: AgentRole) {
  if (!role) return [...toolDefinitions];
  if (role === 'orchestrator') return [...toolDefinitions, ...orchestratorTools];
  return [...toolDefinitions, ...workerTools];
}

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
      if (!rawContent || typeof rawContent !== 'string') {
        return text('Error: content must be a non-empty string.');
      }
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
      const flagPath = `/tmp/agent-mesh-${agentName}.flag`;
      const cronConfig = {
        cron: '* * * * *',
        prompt: `Check for new agent-mesh messages using this exact sequence:

1. Run this bash command to check for the flag file:
   \`\`\`bash
   cat "${flagPath}" 2>/dev/null && echo "FLAG_EXISTS" || echo "NO_FLAG"
   \`\`\`

2. If the output contains "NO_FLAG": stop here, do nothing.

3. If the output contains "FLAG_EXISTS":
   a. The output line before "FLAG_EXISTS" is an ISO 8601 timestamp (e.g. 2026-04-10T12:34:56.789Z). Save it as SINCE_TS.
   b. Delete the flag file:
      \`\`\`bash
      rm -f "${flagPath}"
      \`\`\`
   c. Call read_history with since=SINCE_TS to fetch new messages.
   d. If there are new messages relevant to you or broadcast to everyone, respond appropriately. Be concise.

4. Fallback: if step 1 fails for any reason, call read_history with no arguments as a safety net.`,
        recurring: true,
      };
      return text(
        `To start polling, call CronCreate with this config:\n\n` +
        `cron: "${cronConfig.cron}"\n` +
        `prompt: "${cronConfig.prompt}"\n` +
        `recurring: ${cronConfig.recurring}\n\n` +
        `This will check for new messages every 1 minute, but only call read_history when a message has actually arrived.`,
      );
    }

    case 'workflow_create': {
      const resp = await request(ws, {
        type: 'workflow:create',
        planPath: args.planPath as string,
      });
      if (resp.type === 'workflow:error') {
        const err = resp as any;
        return text(`Workflow creation failed: [${err.code}] ${err.message}`);
      }
      const createResp = resp as any;
      const tasks = createResp.status.tasks.map(
        (t: any) => `  - ${t.id}: ${t.status}`,
      ).join('\n');
      return text(
        `Workflow created: ${createResp.workflowId}\n` +
        `Status: ${createResp.status.status}\n` +
        `Tasks:\n${tasks}`,
      );
    }

    case 'workflow_assign': {
      const resp = await request(ws, {
        type: 'workflow:assign',
        workflowId: args.workflowId as string,
        taskId: args.taskId as string,
        phase: args.phase as string,
        assignee: args.assignee as string,
      });
      if (resp.type === 'workflow:error') {
        const err = resp as any;
        return text(`Assignment failed: [${err.code}] ${err.message}`);
      }
      return text(`Task "${args.taskId}" assigned to "${args.assignee}" for ${args.phase}.`);
    }

    case 'workflow_complete': {
      const resp = await request(ws, {
        type: 'workflow:complete',
        workflowId: args.workflowId as string,
        taskId: args.taskId as string,
        result: args.result as string,
        summary: args.summary as string,
        branch: args.branch as string,
      });
      if (resp.type === 'workflow:error') {
        const err = resp as any;
        return text(`Completion failed: [${err.code}] ${err.message}`);
      }
      return text(`Task "${args.taskId}" completed with result: ${args.result}.`);
    }

    case 'workflow_status': {
      const resp = await request(ws, {
        type: 'workflow:status',
        workflowId: args.workflowId as string,
      });
      if (resp.type === 'workflow:error') {
        const err = resp as any;
        return text(`Status query failed: [${err.code}] ${err.message}`);
      }
      const statusResp = resp as any;
      const d = statusResp.data;
      const tasks = d.tasks.map(
        (t: any) => {
          let line = `  - ${t.id}: ${t.status}`;
          if (t.assignee) line += ` (assigned: ${t.assignee})`;
          if (t.iteration > 0) line += ` [iter ${t.iteration}]`;
          if (t.lastResult) line += ` last: ${t.lastResult}`;
          return line;
        },
      ).join('\n');
      return text(
        `Workflow: ${d.name}\n` +
        `ID: ${d.workflowId}\n` +
        `Status: ${d.status}\n` +
        `Tasks:\n${tasks}`,
      );
    }

    case 'workflow_cancel': {
      const resp = await request(ws, {
        type: 'workflow:cancel',
        workflowId: args.workflowId as string,
        ...(args.reason ? { reason: args.reason as string } : {}),
      });
      if (resp.type === 'workflow:error') {
        const err = resp as any;
        return text(`Cancel failed: [${err.code}] ${err.message}`);
      }
      return text(`Workflow cancelled.`);
    }

    default:
      return text(`Unknown tool: ${toolName}`);
  }
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
