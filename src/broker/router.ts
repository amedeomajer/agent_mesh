import type WebSocket from 'ws';
import type {
  BrokerInbound,
  DeliverMessage,
  HistoryEntry,
  SendMessage,
  ListAgentsRequest,
  ReadHistoryRequest,
  SystemEventMessage,
} from '../shared/protocol.js';
import type { Registry } from './registry.js';
import type { History } from './history.js';

const MAX_WAIT_SECONDS = 30;

export class Router {
  constructor(
    private registry: Registry,
    private history: History,
  ) {}

  handle(senderName: string, senderWs: WebSocket, msg: BrokerInbound): void {
    switch (msg.type) {
      case 'send':
        this.handleSend(senderName, msg);
        break;
      case 'list_agents':
        this.handleListAgents(senderWs, msg);
        break;
      case 'read_history':
        this.handleReadHistory(senderName, senderWs, msg);
        break;
    }
  }

  /** Called from index.ts when an agent connects/disconnects */
  broadcastSystemEvent(event: 'agent_connected' | 'agent_disconnected', agentName: string): void {
    const msg: SystemEventMessage = {
      type: 'system_event',
      event,
      agentName,
      timestamp: new Date().toISOString(),
      agents: this.registry.list(),
    };
    for (const ws of this.registry.allViewers()) {
      this.send(ws, msg);
    }
  }

  private handleSend(senderName: string, msg: SendMessage): void {
    const delivery: DeliverMessage = {
      type: 'deliver',
      id: msg.id,
      from: msg.from,
      to: msg.to,
      content: msg.content,
      timestamp: msg.timestamp,
    };

    this.history.add({
      id: msg.id,
      from: msg.from,
      to: msg.to,
      content: msg.content,
      timestamp: msg.timestamp,
    });

    if (msg.to === '*') {
      for (const agent of this.registry.allExcept(senderName)) {
        this.send(agent.ws, delivery);
      }
    } else {
      const recipientWs = this.registry.get(msg.to);
      if (recipientWs) {
        this.send(recipientWs, delivery);
      }
    }

    // Forward all messages to viewers
    for (const ws of this.registry.allViewers()) {
      this.send(ws, delivery);
    }
  }

  private handleListAgents(ws: WebSocket, msg: ListAgentsRequest): void {
    this.send(ws, {
      type: 'list_agents_response',
      requestId: msg.requestId,
      agents: this.registry.list(),
    });
  }

  private handleReadHistory(
    agentName: string,
    ws: WebSocket,
    msg: ReadHistoryRequest,
  ): void {
    const filters = { from: msg.from, limit: msg.limit, since: msg.since };
    const messages = this.history.get(filters);

    // If we have messages or no wait requested, respond immediately
    if (messages.length > 0 || !msg.wait) {
      this.send(ws, {
        type: 'read_history_response',
        requestId: msg.requestId,
        messages,
      });
      return;
    }

    // Long-poll: wait for a new message or timeout
    const waitSeconds = Math.min(msg.wait, MAX_WAIT_SECONDS);
    let resolved = false;

    const cleanup = this.history.onNewMessage((entry: HistoryEntry) => {
      // Only resolve if this message is relevant to the requesting agent
      if (entry.to === agentName || entry.to === '*') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          this.send(ws, {
            type: 'read_history_response',
            requestId: msg.requestId,
            messages: [entry],
          });
        }
      }
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        this.send(ws, {
          type: 'read_history_response',
          requestId: msg.requestId,
          messages: [],
        });
      }
    }, waitSeconds * 1000);

    // Clean up if the WebSocket closes while waiting
    ws.once('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanup();
      }
    });
  }

  private send(ws: WebSocket, data: unknown): void {
    ws.send(JSON.stringify(data));
  }
}
