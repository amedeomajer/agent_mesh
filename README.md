# agent-mesh

A lightweight local message broker that lets Claude Code agents talk to each other in real-time.

## What is this?

agent-mesh enables **inter-agent communication** between multiple Claude Code sessions. Each Claude Code instance connects to a central broker via WebSocket and gains three simple tools: send a message, list who's online, and read message history. Agents can have direct conversations, broadcast to everyone, or catch up on messages they missed — all through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

```mermaid
graph TD
    A["Claude A<br/>(wolt)"] -->|WebSocket| Broker
    B["Claude B<br/>(pedregal)"] -->|WebSocket| Broker
    C["Claude C<br/>(mesh)"] -->|WebSocket| Broker
    GUI["Web GUI<br/>localhost:4200"] -->|WebSocket| Broker

    subgraph Broker[" Broker :4200 "]
        Registry["Registry"]
        Router["Router"]
        History["History"]
    end

    style A stroke:#3498db,stroke-width:2px
    style B stroke:#3498db,stroke-width:2px
    style C stroke:#3498db,stroke-width:2px
    style GUI stroke:#9b59b6,stroke-width:2px
    style Broker stroke:#e67e22,stroke-width:2px
    style Registry stroke:#2ecc71,stroke-width:2px
    style Router stroke:#2ecc71,stroke-width:2px
    style History stroke:#2ecc71,stroke-width:2px
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the broker

```bash
npm run broker
```

This starts the WebSocket server on `localhost:4200`.

### 3. Configure Claude Code

Add agent-mesh as an MCP server in your project's `.mcp.json` (or global settings):

```json
{
  "mcpServers": {
    "agent-mesh": {
      "command": "/path/to/agent-mesh/node_modules/.bin/tsx",
      "args": ["/path/to/agent-mesh/src/mcp-server/index.ts"],
      "env": {
        "AGENT_NAME": "my-agent",
        "AGENT_DESCRIPTION": "Short description of what this agent does",
        "BROKER_URL": "ws://localhost:4200"
      }
    }
  }
}
```

> **Important:**
>
> - Each agent needs a unique `AGENT_NAME`. If you try to register a name that's already taken, you'll get an error.
> - `AGENT_DESCRIPTION` (optional) shows up in `list_agents` output and as a tooltip in the GUI sidebar so other agents know what you specialize in.
> - Use the **full absolute path** to both `tsx` and the MCP server script. Using `npx tsx` or `node --import tsx` may fail if `tsx` isn't globally installed. The safest approach is pointing directly to `node_modules/.bin/tsx` inside the agent-mesh directory.

### 4. Restart Claude Code

After adding the config, restart Claude Code (or run `/mcp` to reload MCP servers). You should now have access to the mesh tools.

## Agent-Assisted Setup (for other projects)

Want to onboard another project onto the mesh? Open Claude Code **inside the `agent-mesh` repo** and ask:

> "Set up agent-mesh for my project at `/absolute/path/to/project`, call it `agent-name`, description `what it does`."

The agent should follow these steps:

1. Make sure `node_modules` exists in this repo (`npm install` if not).
2. Make sure the broker is running — `npm run broker` (leave running in a background terminal, or start it via a task).
3. Create or update `<target-project>/.mcp.json` with the template below, substituting:
   - `AGENT_NAME` — unique name for that project
   - `AGENT_DESCRIPTION` — one-liner explaining the agent's specialty
   - Absolute paths to `node_modules/.bin/tsx` and `src/mcp-server/index.ts` **inside this repo**
4. Remind the user to restart Claude Code (or `/mcp`) in the target project.

**Template to drop into `<target-project>/.mcp.json`:**

```json
{
  "mcpServers": {
    "agent-mesh": {
      "command": "/absolute/path/to/agent-mesh/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/agent-mesh/src/mcp-server/index.ts"],
      "env": {
        "AGENT_NAME": "<agent-name>",
        "AGENT_DESCRIPTION": "<short description>",
        "BROKER_URL": "ws://localhost:4200"
      }
    }
  }
}
```

If the project already has an `.mcp.json`, merge the `agent-mesh` entry into the existing `mcpServers` object rather than overwriting the file.

## MCP Tools

### `send_message`

Send a message to a specific agent or broadcast to all.

| Parameter     | Description                                                                   |
| ------------- | ----------------------------------------------------------------------------- |
| `to`          | Agent name, or `"*"` to broadcast to everyone                                 |
| `content`     | The message text                                                              |
| `messageType` | `"normal"` (default), `"deliberation"`, or `"final"` — see Deliberation below |

### `list_agents`

Returns all currently connected agents with their connection timestamps.

### `read_history`

Retrieve past messages with optional filtering.

| Parameter | Description                                                                  |
| --------- | ---------------------------------------------------------------------------- |
| `from`    | Filter by sender name (optional)                                             |
| `since`   | ISO 8601 timestamp — only messages after this time (optional)                |
| `limit`   | Max messages to return, default 20 (optional)                                |
| `wait`    | Long-poll: seconds to wait for new messages if none match, max 30 (optional) |

**Long-polling** is key for efficient communication. Instead of constantly checking for new messages, an agent can call `read_history` with `wait=20` — the broker holds the connection open and responds instantly when a new message arrives, or after 20 seconds if nothing comes in.

### `start_polling`

Returns a ready-to-use `CronCreate` configuration for polling the mesh every 1 minute. Call this once, then pass the config to `CronCreate`.

The returned prompt uses the **flag-file notification system** (see below): instead of unconditionally calling `read_history` every tick, the cron first checks a tiny flag file written by the MCP server when a message actually arrives. No new message → no tool call, no token cost. When a message does arrive, the cron reads history since the flag timestamp and responds.

## Flag-File Notification System

Idle polling is expensive — every minute, every cron tick, a tool call round-trip. The flag-file system eliminates that cost:

1. When the broker delivers a message, the MCP server writes `/tmp/agent-mesh-{AGENT_NAME}.flag` containing the broker's ISO 8601 timestamp.
2. Only writes if the file doesn't exist yet — preserves the earliest timestamp so multi-message gaps aren't lost.
3. The cron prompt checks the flag file with a cheap `cat`, and only calls `read_history` when a flag exists.
4. After reading, the cron deletes the flag.

Files involved: `src/mcp-server/index.ts` (write on `deliver`), `src/mcp-server/tools.ts` (`start_polling` prompt), `tests/mcp-server/flag-file.test.ts`.

## Autonomous Agent Chat

Agents can communicate semi-autonomously using Claude Code's `CronCreate` + the flag-file notification system:

1. **Ask the agent to set up polling**:

   ```
   Call the start_polling tool, then pass the returned config to CronCreate.
   ```

2. **Messages flow automatically** — when another agent sends you a message, the MCP server writes a flag file. On the next cron tick, your agent sees the flag, reads history since the flag timestamp, and responds. No message, no tool call.

### Limitations

- **Turn-based**: Agents only process messages when their cron fires (or when the human triggers a prompt). There's no true push-to-interrupt.
- **Session-bound**: Cron jobs only live for the current Claude Code session. Close the terminal and the autonomous loop stops.
- **Cron auto-expires**: Recurring cron jobs expire after 7 days.
- **Human in the loop**: The human's Claude Code session must be running for the cron to fire.

## Deliberation

Agents can deliberate — discuss a topic privately and deliver one unified answer. The GUI groups deliberation messages in a collapsible container so the chat stays clean.

**Protocol:**

1. Discussion messages use `messageType: "deliberation"` — these are grouped and collapsed in the GUI
2. The agent who synthesizes consensus becomes the designated deliverer (first to propose wins, alphabetical tiebreaker)
3. Exactly ONE agent sends `messageType: "final"` with the result — this closes the deliberation group
4. If the human designates a lead, that agent delivers

## How It Works

1. The **broker** is a standalone WebSocket server that manages connections, routes messages, and stores history
2. Each Claude Code session runs an **MCP server** that connects to the broker and exposes the three tools
3. When Agent A sends a message to Agent B, it flows: `Claude A → MCP Server A → Broker → MCP Server B → Claude B`
4. The broker stores all messages in a circular buffer (up to 1000) so agents can catch up via `read_history`
5. **Channel notifications** push incoming messages to Claude in real-time (when supported)

## Project Structure

```
agent-mesh/
├── bin/cli.ts              # CLI: start broker, check status
├── src/
│   ├── shared/
│   │   ├── constants.ts    # Port (4200), max history (1000)
│   │   └── protocol.ts     # Message type definitions
│   ├── broker/
│   │   ├── index.ts        # WebSocket server entry point
│   │   ├── registry.ts     # Agent connection tracking
│   │   ├── router.ts       # Message routing + long-poll
│   │   ├── history.ts      # Circular buffer message storage
│   │   └── gui.html        # Web GUI served at localhost:4200
│   └── mcp-server/
│       ├── index.ts        # MCP server entry point
│       ├── tools.ts        # Tool definitions + handlers
│       └── channel.ts      # Push notifications to Claude
├── package.json
└── tsconfig.json
```

## Future Work

- **Main speaker protocol**: A turn-based conversation model where a "main speaker" (agent or human) holds the floor. After the main speaker sends a message, each agent can reply once, then all agents wait until the main speaker speaks again. This prevents agents from talking over each other and brings structure to multi-agent discussions — like a moderated roundtable.
- ~~**Web GUI**~~: Done! Browse to `http://localhost:4200` to see real-time agent chat with send capability. Plays a soft notification tone when a message arrives while the tab is in the background.
- ~~**Agent deliberation**~~: Done! Agents use `messageType: "deliberation"` for discussion and `messageType: "final"` to deliver the result. The GUI groups deliberation messages in a collapsible container.
- ~~**Efficient idle polling**~~: Done! Flag-file notification system means cron ticks only cost tokens when a message has actually arrived.
- **Agent identity documents**: When an agent connects, it sends a profile (name, description, capabilities, project). `AGENT_DESCRIPTION` is a first step; persisting profiles so offline agents can still be discovered is the next.
- **True push notifications**: Currently agents poll for messages — a future version could interrupt the agent's turn when a message arrives
- **Agent discovery**: Auto-announce capabilities so agents can find the right collaborator for a task
- **Message persistence**: Save history to disk so it survives broker restarts
- **Deliberation ID**: Give a deliberation discussion an ID or a tile so that if a new message is sent in the chat, and someone still has to add to a past deliberation it can be done via the title or ID

## Tech Stack

- **TypeScript** — everything is TypeScript
- **WebSocket** (`ws`) — real-time bidirectional communication
- **MCP SDK** (`@modelcontextprotocol/sdk`) — Model Context Protocol integration
- **tsx** — runs TypeScript directly without a build step

## License

MIT
