// ── Workflow types ──

export type AgentRole = 'orchestrator' | 'implementer' | 'reviewer';

export type WorkflowErrorCode =
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_ALREADY_ACTIVE'
  | 'TASK_NOT_FOUND'
  | 'AGENT_OFFLINE'
  | 'AGENT_ROLE_MISMATCH'
  | 'INVALID_PLAN'
  | 'INVALID_STATE_TRANSITION'
  | 'NOT_AUTHORIZED';

// ── MCP Server -> Broker ──

export interface RegisterMessage {
  type: 'register';
  agentName: string;
  description?: string;
  role?: AgentRole;
  capabilities?: string[];
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

// ── Workflow requests (MCP Server -> Broker) ──

export interface WorkflowCreateRequest {
  type: 'workflow:create';
  requestId: string;
  planPath: string;
}

export interface WorkflowAssignRequest {
  type: 'workflow:assign';
  requestId: string;
  workflowId: string;
  taskId: string;
  phase: 'produce' | 'review';
  assignee: string;
}

export interface WorkflowCompleteRequest {
  type: 'workflow:complete';
  requestId: string;
  workflowId: string;
  taskId: string;
  result: 'done' | 'approved' | 'changes_requested';
  summary: string;
  branch: string;
}

export interface WorkflowStatusRequest {
  type: 'workflow:status';
  requestId: string;
  workflowId: string;
}

export interface WorkflowCancelRequest {
  type: 'workflow:cancel';
  requestId: string;
  workflowId: string;
  reason?: string;
}

export type WorkflowInbound =
  | WorkflowCreateRequest
  | WorkflowAssignRequest
  | WorkflowCompleteRequest
  | WorkflowStatusRequest
  | WorkflowCancelRequest;

export type BrokerInbound =
  | RegisterMessage
  | RegisterViewerMessage
  | SendMessage
  | ListAgentsRequest
  | ReadHistoryRequest
  | WorkflowCreateRequest
  | WorkflowAssignRequest
  | WorkflowCompleteRequest
  | WorkflowStatusRequest
  | WorkflowCancelRequest;

// ── Broker -> MCP Server ──

export interface AgentInfo {
  name: string;
  connectedAt: string;
  description?: string;
  role?: AgentRole;
  capabilities?: string[];
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

// ── Workflow responses (Broker -> MCP Server) ──

export interface WorkflowStatusData {
  workflowId: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  tasks: Array<{
    id: string;
    status: 'pending' | 'producing' | 'reviewing' | 'done' | 'stalled';
    assignee?: string;
    iteration: number;
    lastResult?: 'done' | 'approved' | 'changes_requested';
  }>;
}

export interface WorkflowCreateResponse {
  type: 'workflow:create_response';
  requestId: string;
  workflowId: string;
  status: WorkflowStatusData;
}

export interface WorkflowAssignResponse {
  type: 'workflow:assign_response';
  requestId: string;
  ok: boolean;
}

export interface WorkflowCompleteResponse {
  type: 'workflow:complete_response';
  requestId: string;
  ok: boolean;
}

export interface WorkflowStatusResponse {
  type: 'workflow:status_response';
  requestId: string;
  data: WorkflowStatusData;
}

export interface WorkflowCancelResponse {
  type: 'workflow:cancel_response';
  requestId: string;
  ok: boolean;
}

export interface WorkflowNotification {
  type: 'workflow:notification';
  workflowId: string;
  taskId: string;
  phase: 'produce' | 'review';
  iteration: number;
  context: {
    branch: string;
    baseBranch: string;
    description: string;
    produceType: 'plan' | 'implement';
    prompt?: string;
    priorFeedback?: string;
    files?: string[];
  };
}

export interface WorkflowError {
  type: 'workflow:error';
  requestId: string;
  code: WorkflowErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type BrokerOutbound =
  | ListAgentsResponse
  | ReadHistoryResponse
  | DeliverMessage
  | ErrorMessage
  | SystemEventMessage
  | WorkflowCreateResponse
  | WorkflowAssignResponse
  | WorkflowCompleteResponse
  | WorkflowStatusResponse
  | WorkflowCancelResponse
  | WorkflowError;
