// ── MCP Server -> Broker ──

export interface RegisterMessage {
  type: 'register';
  agentName: string;
  description?: string;
}

export interface SendMessage {
  type: 'send';
  id: string;
  from: string;
  to: string; // agent name or "*" for broadcast
  content: string;
  timestamp: string;
}

export interface ListAgentsRequest {
  type: 'list_agents';
  requestId: string;
}

export interface ReadHistoryRequest {
  type: 'read_history';
  requestId: string;
  from?: string;
  limit?: number;
  since?: string; // ISO 8601 — only return messages after this timestamp
  wait?: number;  // seconds to long-poll if no messages match (max 30)
}

export interface RegisterViewerMessage {
  type: 'register_viewer';
}

export type BrokerInbound =
  | RegisterMessage
  | RegisterViewerMessage
  | SendMessage
  | ListAgentsRequest
  | ReadHistoryRequest;

// ── Broker -> MCP Server ──

export interface AgentInfo {
  name: string;
  connectedAt: string;
  description?: string;
}

export interface ListAgentsResponse {
  type: 'list_agents_response';
  requestId: string;
  agents: AgentInfo[];
}

export interface HistoryEntry {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
}

export interface ReadHistoryResponse {
  type: 'read_history_response';
  requestId: string;
  messages: HistoryEntry[];
}

export interface DeliverMessage {
  type: 'deliver';
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
}

export interface ErrorMessage {
  type: 'error';
  requestId?: string;
  message: string;
}

export interface SystemEventMessage {
  type: 'system_event';
  event: 'agent_connected' | 'agent_disconnected';
  agentName: string;
  timestamp: string;
  agents: AgentInfo[];
}

export type BrokerOutbound =
  | ListAgentsResponse
  | ReadHistoryResponse
  | DeliverMessage
  | ErrorMessage
  | SystemEventMessage;
