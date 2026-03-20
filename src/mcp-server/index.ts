import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import { DEFAULT_BROKER_URL } from '../shared/constants.js';
import type { BrokerOutbound } from '../shared/protocol.js';
import { toolDefinitions, handleToolCall, resolvePending } from './tools.js';
import { pushChannelNotification } from './channel.js';

const AGENT_NAME = process.env.AGENT_NAME;
const BROKER_URL = process.env.BROKER_URL || DEFAULT_BROKER_URL;

if (!AGENT_NAME) {
  process.stderr.write('AGENT_NAME environment variable is required\n');
  process.exit(1);
}

// 1. Create the MCP server with Channel capability
const mcp = new Server(
  { name: 'agent-mesh', version: '0.1.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions:
      `You are connected to the agent-mesh network as "${AGENT_NAME}". ` +
      'Messages from other agents arrive as <channel source="agent-mesh" from="...">. ' +
      'Use the send_message tool to reply. Use list_agents to see who is online. ' +
      'Use read_history to catch up on messages you may have missed.',
  },
);

// 2. Connect to broker via WebSocket
const ws = new WebSocket(BROKER_URL);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'register', agentName: AGENT_NAME }));
  process.stderr.write(`[agent-mesh] Connected to broker as "${AGENT_NAME}"\n`);
});

ws.on('error', (err) => {
  process.stderr.write(
    `[agent-mesh] Broker connection error: ${err.message}\n` +
      `Is the broker running? Start it with: npm run broker\n`,
  );
});

ws.on('close', () => {
  process.stderr.write('[agent-mesh] Disconnected from broker\n');
});

// 3. Handle incoming messages from the broker
ws.on('message', (raw) => {
  let msg: BrokerOutbound;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }

  // Check if this is a response to a pending request (list_agents, read_history)
  if (resolvePending(msg)) {
    return;
  }

  // If it's a delivered message, push it to Claude via Channel notification
  if (msg.type === 'deliver') {
    pushChannelNotification(mcp, msg);
  }
});

// 4. Register MCP tool handlers
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args ?? {}, ws, AGENT_NAME);
});

// 5. Connect to Claude Code over stdio
const transport = new StdioServerTransport();
await mcp.connect(transport);
