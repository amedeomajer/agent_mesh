// ── MCP Server -> Broker ──

export interface RegisterMessage {
  type: 'register';
  agentName: string;
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
}

export type BrokerInbound =
  | RegisterMessage
  | SendMessage
  | ListAgentsRequest
  | ReadHistoryRequest;

// ── Broker -> MCP Server ──

export interface AgentInfo {
  name: string;
  connectedAt: string;
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

export type BrokerOutbound =
  | ListAgentsResponse
  | ReadHistoryResponse
  | DeliverMessage
  | ErrorMessage;
