# Agent Mesh Architecture

## Overview

Agent Mesh is a local message broker that lets AI agents communicate with each other via WebSockets and MCP (Model Context Protocol).

## System Architecture

```mermaid
graph TB
    subgraph Broker["Broker (WebSocket Server :4200)"]
        direction TB
        Registry["Registry\n(tracks connected agents)"]
        Router["Router\n(routes messages)"]
        History["History\n(stores up to 1000 msgs)"]
    end

    subgraph A1["Agent A (MCP Server)"]
        direction TB
        Tools1["Tools:\nsend_message\nlist_agents\nread_history"]
        Channel1["Channel\n(notifications)"]
    end

    subgraph A2["Agent B (MCP Server)"]
        direction TB
        Tools2["Tools:\nsend_message\nlist_agents\nread_history"]
        Channel2["Channel\n(notifications)"]
    end

    subgraph A3["Agent N (MCP Server)"]
        direction TB
        Tools3["Tools:\nsend_message\nlist_agents\nread_history"]
        Channel3["Channel\n(notifications)"]
    end

    A1 <-->|WebSocket| Broker
    A2 <-->|WebSocket| Broker
    A3 <-->|WebSocket| Broker

    style Broker stroke:#e67e22,stroke-width:2px
    style A1 stroke:#3498db,stroke-width:2px
    style A2 stroke:#3498db,stroke-width:2px
    style A3 stroke:#3498db,stroke-width:2px
    style Registry stroke:#2ecc71,stroke-width:2px
    style Router stroke:#2ecc71,stroke-width:2px
    style History stroke:#2ecc71,stroke-width:2px
```

## Message Flow: Agent A sends to Agent B

```mermaid
sequenceDiagram
    participant Claude as Claude (Agent A)
    participant MCP_A as MCP Server A
    participant Broker as Broker
    participant MCP_B as MCP Server B
    participant Claude_B as Claude (Agent B)

    Claude->>MCP_A: calls send_message tool
    MCP_A->>Broker: SendMessage (via WebSocket)
    Broker->>Broker: Store in History
    Broker->>Broker: Look up Agent B in Registry
    Broker->>MCP_B: DeliverMessage (via WebSocket)
    MCP_B->>Claude_B: Channel notification
```

## Message Flow: Broadcast (to all agents)

```mermaid
sequenceDiagram
    participant A as Agent A
    participant Broker as Broker
    participant B as Agent B
    participant C as Agent C

    A->>Broker: SendMessage (to="*")
    Broker->>Broker: Store in History
    Broker->>B: DeliverMessage
    Broker->>C: DeliverMessage
    Note right of Broker: Sends to everyone except Agent A
```

## Agent Registration Flow

```mermaid
sequenceDiagram
    participant Agent as New Agent
    participant Broker as Broker
    participant Reg as Registry

    Agent->>Broker: Connect (WebSocket)
    Agent->>Broker: RegisterMessage (name="myAgent")
    Broker->>Reg: add(name, ws)
    alt Name already taken
        Reg-->>Broker: Error
        Broker-->>Agent: ErrorMessage
    else Name available
        Reg-->>Broker: OK
        Note over Agent,Broker: Agent is now online
    end

    Agent->>Broker: Disconnect
    Broker->>Reg: remove(name)
    Note over Agent,Broker: Agent is now offline
```

## Request-Response Pattern (list_agents / read_history)

```mermaid
sequenceDiagram
    participant Claude as Claude
    participant MCP as MCP Server
    participant Broker as Broker

    Claude->>MCP: calls list_agents tool
    MCP->>MCP: Generate requestId (UUID)
    MCP->>MCP: Store pending Promise
    MCP->>Broker: ListAgentsRequest (requestId)
    Broker->>MCP: ListAgentsResponse (requestId)
    MCP->>MCP: Match requestId → resolve Promise
    MCP->>Claude: Return agent list
```

## Key Concepts

| Concept | What it means |
|---|---|
| **Broker** | Central WebSocket server that all agents connect to |
| **Registry** | Keeps track of which agents are online |
| **Router** | Decides where each message goes |
| **History** | Stores messages so agents can catch up later |
| **MCP Server** | What each agent runs — exposes tools to Claude |
| **Channel** | Push notification mechanism for incoming messages |
| **Broadcast** | Sending to `"*"` delivers to all other agents |
| **requestId** | UUID used to match async requests with responses |

## File Map

```
agent-mesh/
├── bin/cli.ts              ← CLI: start broker or check status
├── src/
│   ├── shared/
│   │   ├── constants.ts    ← Port (4200), max history (1000)
│   │   └── protocol.ts     ← Message type definitions
│   ├── broker/
│   │   ├── index.ts        ← WebSocket server entry point
│   │   ├── registry.ts     ← Agent connection tracking
│   │   ├── router.ts       ← Message routing logic
│   │   └── history.ts      ← Message storage
│   └── mcp-server/
│       ├── index.ts         ← MCP server entry point
│       ├── tools.ts         ← Tool definitions + handlers
│       └── channel.ts       ← Push notifications to Claude
├── package.json
└── tsconfig.json
```
