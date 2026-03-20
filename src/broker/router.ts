import type WebSocket from 'ws';
import type {
  BrokerInbound,
  DeliverMessage,
  SendMessage,
  ListAgentsRequest,
  ReadHistoryRequest,
} from '../shared/protocol.js';
import type { Registry } from './registry.js';
import type { History } from './history.js';

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
        this.handleReadHistory(senderWs, msg);
        break;
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
      // broadcast to all except sender
      for (const agent of this.registry.allExcept(senderName)) {
        this.send(agent.ws, delivery);
      }
    } else {
      const recipientWs = this.registry.get(msg.to);
      if (recipientWs) {
        this.send(recipientWs, delivery);
      }
      // if recipient not found, message is still stored in history
    }
  }

  private handleListAgents(ws: WebSocket, msg: ListAgentsRequest): void {
    this.send(ws, {
      type: 'list_agents_response',
      requestId: msg.requestId,
      agents: this.registry.list(),
    });
  }

  private handleReadHistory(ws: WebSocket, msg: ReadHistoryRequest): void {
    this.send(ws, {
      type: 'read_history_response',
      requestId: msg.requestId,
      messages: this.history.get({ from: msg.from, limit: msg.limit }),
    });
  }

  private send(ws: WebSocket, data: unknown): void {
    ws.send(JSON.stringify(data));
  }
}
