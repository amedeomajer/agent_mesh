import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";
import { writeFileSync, existsSync } from "node:fs";
import { DEFAULT_BROKER_URL } from "../shared/constants.js";
import type { AgentRole, BrokerOutbound } from "../shared/protocol.js";
import { getToolDefinitions, handleToolCall, resolvePending } from "./tools.js";
import { pushChannelNotification } from "./channel.js";

const AGENT_NAME = process.env.AGENT_NAME;
const AGENT_DESCRIPTION = process.env.AGENT_DESCRIPTION;
const AGENT_ROLE = process.env.AGENT_ROLE as AgentRole | undefined;
const BROKER_URL = process.env.BROKER_URL || DEFAULT_BROKER_URL;

if (!AGENT_NAME) {
  process.stderr.write("AGENT_NAME environment variable is required\n");
  process.exit(1);
}

// 1. Create the MCP server with Channel capability
const mcp = new Server(
  { name: "agent-mesh", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions:
      `You are connected to the agent-mesh network as "${AGENT_NAME}"` +
      (AGENT_ROLE ? ` with role "${AGENT_ROLE}"` : '') + '. ' +
      'Messages from other agents arrive as <channel source="agent-mesh" from="...">. ' +
      'Messages from "workflow" sender contain JSON workflow notifications — parse them to get task assignments. ' +
      "Use the send_message tool to reply. Use list_agents to see who is online. " +
      "Use read_history to catch up on messages you may have missed. " +
      "Use start_polling right now so you can participate in the current conversation. " +
      "CRITICAL: When you receive ANY message from the mesh (via <channel> notifications), you MUST ALWAYS reply using the send_message tool. " +
      "NEVER just type your response in plain text — the sender cannot see your terminal output. " +
      "Every reply to a mesh message MUST go through send_message, no exceptions. " +
      "CRITICAL: Do NOT send a message just to confirm or echo what another agent already said. " +
      "Only reply when you have new information, a decision, a question, or an action to report. " +
      "Avoid messages like 'Confirmed!', 'Sounds good!', 'Agreed', or restating the previous agent's conclusion. " +
      "If you have nothing new to add, stay silent.",
  },
);

// 2. Connect to broker via WebSocket
const ws = new WebSocket(BROKER_URL);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "register",
      agentName: AGENT_NAME,
      ...(AGENT_DESCRIPTION ? { description: AGENT_DESCRIPTION } : {}),
      ...(AGENT_ROLE ? { role: AGENT_ROLE } : {}),
    }),
  );
  process.stderr.write(`[agent-mesh] Connected to broker as "${AGENT_NAME}"\n`);
});

ws.on("error", (err) => {
  process.stderr.write(
    `[agent-mesh] Broker connection error: ${err.message}\n` +
      `Is the broker running? Start it with: npm run broker\n`,
  );
});

ws.on("close", () => {
  process.stderr.write("[agent-mesh] Disconnected from broker\n");
});

// 3. Handle incoming messages from the broker
ws.on("message", (raw) => {
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
  if (msg.type === "deliver") {
    pushChannelNotification(mcp, msg);
    try {
      const flagPath = `/tmp/agent-mesh-${AGENT_NAME}.flag`;
      // Only write if no flag exists yet — preserve the earliest timestamp
      // so read_history with since= doesn't miss earlier messages
      if (!existsSync(flagPath)) {
        // Subtract 1ms so read_history(since=flagTimestamp) is inclusive of this message
        const ts = new Date(new Date(msg.timestamp).getTime() - 1).toISOString();
        writeFileSync(flagPath, ts, "utf8");
      }
    } catch {
      // /tmp may be unavailable in sandboxed environments — not fatal
    }
  }
});

// 4. Register MCP tool handlers
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getToolDefinitions(AGENT_ROLE),
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args ?? {}, ws, AGENT_NAME);
});

// 5. Connect to Claude Code over stdio
const transport = new StdioServerTransport();
await mcp.connect(transport);
