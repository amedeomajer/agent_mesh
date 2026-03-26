import type WebSocket from 'ws';
import type { AgentInfo } from '../shared/protocol.js';

interface RegisteredAgent {
  ws: WebSocket;
  connectedAt: string;
  description?: string;
}

export class Registry {
  private agents = new Map<string, RegisteredAgent>();
  private viewers = new Set<WebSocket>();

  add(name: string, ws: WebSocket, description?: string): boolean {
    if (this.agents.has(name)) {
      return false; // name already taken
    }
    this.agents.set(name, { ws, connectedAt: new Date().toISOString(), description });
    return true;
  }

  remove(name: string): void {
    this.agents.delete(name);
  }

  removeBySocket(ws: WebSocket): string | undefined {
    for (const [name, agent] of this.agents) {
      if (agent.ws === ws) {
        this.agents.delete(name);
        return name;
      }
    }
    return undefined;
  }

  get(name: string): WebSocket | undefined {
    return this.agents.get(name)?.ws;
  }

  list(): AgentInfo[] {
    return Array.from(this.agents.entries()).map(([name, agent]) => ({
      name,
      connectedAt: agent.connectedAt,
      ...(agent.description ? { description: agent.description } : {}),
    }));
  }

  allExcept(name: string): Array<{ name: string; ws: WebSocket }> {
    const result: Array<{ name: string; ws: WebSocket }> = [];
    for (const [agentName, agent] of this.agents) {
      if (agentName !== name) {
        result.push({ name: agentName, ws: agent.ws });
      }
    }
    return result;
  }

  addViewer(ws: WebSocket): void {
    this.viewers.add(ws);
  }

  removeViewer(ws: WebSocket): void {
    this.viewers.delete(ws);
  }

  allViewers(): WebSocket[] {
    return Array.from(this.viewers);
  }
}
