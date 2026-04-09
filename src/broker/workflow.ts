import type WebSocket from 'ws';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { v4 as uuid } from 'uuid';
import type { Registry } from './registry.js';
import type {
  WorkflowInbound,
  WorkflowCreateRequest,
  WorkflowAssignRequest,
  WorkflowCompleteRequest,
  WorkflowStatusRequest,
  WorkflowCancelRequest,
  WorkflowStatusData,
  WorkflowNotification,
  WorkflowError,
  WorkflowErrorCode,
  DeliverMessage,
} from '../shared/protocol.js';
import { parsePlanYaml, validatePlan } from '../shared/workflow-schema.js';
import { MAX_WORKFLOW_ITERATIONS } from '../shared/constants.js';

interface WorkflowTaskState {
  id: string;
  description: string;
  status: 'pending' | 'producing' | 'reviewing' | 'done' | 'stalled';
  produce: { type: string; role: string; prompt?: string };
  review?: { role: string; prompt?: string };
  assignee?: string;
  iteration: number;
  lastFeedback?: string;
  lastResult?: 'done' | 'approved' | 'changes_requested';
  files?: string[];
  dependsOn?: string[];
}

export interface WorkflowState {
  workflowId: string;
  name: string;
  orchestrator: string;
  config: { onComplete: string; branch?: string; baseBranch?: string };
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  tasks: WorkflowTaskState[];
  createdAt: string;
  updatedAt: string;
}

export class WorkflowManager {
  private workflow: WorkflowState | null = null;
  private workflowsDir: string;

  constructor(
    private registry: Registry,
    workflowsDir?: string,
  ) {
    this.workflowsDir = workflowsDir ?? '.mesh-workflows';
  }

  handle(senderName: string, senderWs: WebSocket, msg: WorkflowInbound): void {
    switch (msg.type) {
      case 'workflow:create':
        return this.handleCreate(senderName, senderWs, msg);
      case 'workflow:assign':
        return this.handleAssign(senderName, senderWs, msg);
      case 'workflow:complete':
        return this.handleComplete(senderName, senderWs, msg);
      case 'workflow:status':
        return this.handleStatus(senderWs, msg);
      case 'workflow:cancel':
        return this.handleCancel(senderName, senderWs, msg);
    }
  }

  handleAgentDisconnect(_agentName: string): void {
    // Implemented in Plan 3
  }

  private handleCreate(senderName: string, senderWs: WebSocket, msg: WorkflowCreateRequest): void {
    const role = this.registry.getRole(senderName);
    if (role !== 'orchestrator') {
      return this.sendError(senderWs, msg.requestId, 'NOT_AUTHORIZED', 'Only orchestrators can create workflows');
    }

    if (this.workflow && this.workflow.status === 'running') {
      return this.sendError(senderWs, msg.requestId, 'WORKFLOW_ALREADY_ACTIVE', 'A workflow is already running');
    }

    let planContent: string;
    try {
      planContent = readFileSync(msg.planPath, 'utf-8');
    } catch {
      return this.sendError(senderWs, msg.requestId, 'INVALID_PLAN', `Cannot read plan file: ${msg.planPath}`);
    }

    let plan: ReturnType<typeof parsePlanYaml>;
    try {
      plan = parsePlanYaml(planContent);
    } catch (e) {
      return this.sendError(senderWs, msg.requestId, 'INVALID_PLAN', `Invalid YAML: ${(e as Error).message}`);
    }

    const validationErrors = validatePlan(plan);
    if (validationErrors.length > 0) {
      return this.sendError(senderWs, msg.requestId, 'INVALID_PLAN', 'Plan validation failed', {
        errors: validationErrors,
      });
    }

    const workflowId = uuid();
    const now = new Date().toISOString();
    this.workflow = {
      workflowId,
      name: plan.name,
      orchestrator: senderName,
      config: plan.config,
      status: 'running',
      tasks: plan.tasks.map(t => ({
        id: t.id,
        description: t.description,
        status: 'pending' as const,
        produce: t.produce,
        review: t.review,
        assignee: undefined,
        iteration: 0,
        files: t.files,
        dependsOn: t.dependsOn,
      })),
      createdAt: now,
      updatedAt: now,
    };

    this.persist();
    this.broadcastStatus();

    this.send(senderWs, {
      type: 'workflow:create_response',
      requestId: msg.requestId,
      workflowId,
      status: this.getStatusData(),
    });
  }

  private handleAssign(senderName: string, senderWs: WebSocket, msg: WorkflowAssignRequest): void {
    if (!this.workflow || this.workflow.workflowId !== msg.workflowId) {
      return this.sendError(senderWs, msg.requestId, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
    }

    const role = this.registry.getRole(senderName);
    if (role !== 'orchestrator') {
      return this.sendError(senderWs, msg.requestId, 'NOT_AUTHORIZED', 'Only orchestrators can assign tasks');
    }

    const task = this.workflow.tasks.find(t => t.id === msg.taskId);
    if (!task) {
      return this.sendError(senderWs, msg.requestId, 'TASK_NOT_FOUND', `Task not found: ${msg.taskId}`);
    }

    const assigneeWs = this.registry.get(msg.assignee);
    if (!assigneeWs) {
      return this.sendError(senderWs, msg.requestId, 'AGENT_OFFLINE', `Agent is offline: ${msg.assignee}`);
    }

    const assigneeRole = this.registry.getRole(msg.assignee);
    const requiredRole = msg.phase === 'produce' ? task.produce.role : task.review?.role;
    if (assigneeRole !== requiredRole) {
      return this.sendError(senderWs, msg.requestId, 'AGENT_ROLE_MISMATCH',
        `Agent "${msg.assignee}" has role "${assigneeRole}", task requires "${requiredRole}"`);
    }

    task.status = msg.phase === 'produce' ? 'producing' : 'reviewing';
    task.assignee = msg.assignee;
    if (msg.phase === 'produce' && task.iteration === 0) {
      task.iteration = 1;
    }

    this.workflow.updatedAt = new Date().toISOString();
    this.persist();

    const notification: WorkflowNotification = {
      type: 'workflow:notification',
      workflowId: this.workflow.workflowId,
      taskId: task.id,
      phase: msg.phase,
      iteration: task.iteration,
      context: {
        branch: this.workflow.config.branch || 'main',
        baseBranch: this.workflow.config.baseBranch || 'main',
        description: task.description,
        produceType: task.produce.type as 'plan' | 'implement',
        prompt: msg.phase === 'produce' ? task.produce.prompt : task.review?.prompt,
        priorFeedback: task.lastFeedback,
        files: task.files,
      },
    };

    const delivery: DeliverMessage = {
      type: 'deliver',
      id: uuid(),
      from: 'workflow',
      to: msg.assignee,
      content: JSON.stringify(notification),
      timestamp: new Date().toISOString(),
    };

    this.send(assigneeWs, delivery);
    this.broadcastStatus();

    this.send(senderWs, {
      type: 'workflow:assign_response',
      requestId: msg.requestId,
      ok: true,
    });
  }

  private handleComplete(_senderName: string, senderWs: WebSocket, msg: WorkflowCompleteRequest): void {
    if (!this.workflow || this.workflow.workflowId !== msg.workflowId) {
      return this.sendError(senderWs, msg.requestId, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
    }

    const task = this.workflow.tasks.find(t => t.id === msg.taskId);
    if (!task) {
      return this.sendError(senderWs, msg.requestId, 'TASK_NOT_FOUND', `Task not found: ${msg.taskId}`);
    }

    if (msg.result === 'done' && task.status !== 'producing') {
      return this.sendError(senderWs, msg.requestId, 'INVALID_STATE_TRANSITION',
        `Cannot complete with 'done': task is '${task.status}', expected 'producing'`);
    }
    if ((msg.result === 'approved' || msg.result === 'changes_requested') && task.status !== 'reviewing') {
      return this.sendError(senderWs, msg.requestId, 'INVALID_STATE_TRANSITION',
        `Cannot complete with '${msg.result}': task is '${task.status}', expected 'reviewing'`);
    }

    task.assignee = undefined;
    task.lastResult = msg.result;

    if (msg.result === 'done') {
      task.status = task.review ? 'pending' : 'done';
      task.lastFeedback = undefined;
    } else if (msg.result === 'approved') {
      task.status = 'done';
    } else if (msg.result === 'changes_requested') {
      task.status = 'pending';
      task.lastFeedback = msg.summary;
      task.iteration++;
    }

    this.workflow.updatedAt = new Date().toISOString();

    if (this.workflow.tasks.every(t => t.status === 'done')) {
      this.workflow.status = 'completed';
    }

    if (task.iteration >= MAX_WORKFLOW_ITERATIONS) {
      this.broadcastEscalation(task);
    }

    this.persist();
    this.broadcastStatus();
    this.notifyOrchestrator(
      `Task "${task.id}" completed: ${msg.result}. Summary: ${msg.summary}`,
    );

    this.send(senderWs, {
      type: 'workflow:complete_response',
      requestId: msg.requestId,
      ok: true,
    });
  }

  private handleStatus(senderWs: WebSocket, msg: WorkflowStatusRequest): void {
    if (!this.workflow || this.workflow.workflowId !== msg.workflowId) {
      return this.sendError(senderWs, msg.requestId, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
    }

    this.send(senderWs, {
      type: 'workflow:status_response',
      requestId: msg.requestId,
      data: this.getStatusData(),
    });
  }

  private handleCancel(senderName: string, senderWs: WebSocket, msg: WorkflowCancelRequest): void {
    if (!this.workflow || this.workflow.workflowId !== msg.workflowId) {
      return this.sendError(senderWs, msg.requestId, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
    }

    const role = this.registry.getRole(senderName);
    if (role !== 'orchestrator') {
      return this.sendError(senderWs, msg.requestId, 'NOT_AUTHORIZED', 'Only orchestrators can cancel workflows');
    }

    this.workflow.status = 'cancelled';
    for (const task of this.workflow.tasks) {
      if (task.status === 'producing' || task.status === 'reviewing') {
        task.status = 'stalled';
      }
    }
    this.workflow.updatedAt = new Date().toISOString();
    this.persist();
    this.broadcastStatus();

    this.send(senderWs, {
      type: 'workflow:cancel_response',
      requestId: msg.requestId,
      ok: true,
    });
  }

  getStatusData(): WorkflowStatusData {
    if (!this.workflow) throw new Error('No active workflow');
    return {
      workflowId: this.workflow.workflowId,
      name: this.workflow.name,
      status: this.workflow.status,
      tasks: this.workflow.tasks.map(t => ({
        id: t.id,
        status: t.status,
        assignee: t.assignee,
        iteration: t.iteration,
        lastResult: t.lastResult,
      })),
    };
  }

  /** Exposed for testing */
  getWorkflow(): WorkflowState | null {
    return this.workflow;
  }

  private persist(): void {
    if (!this.workflow) return;
    if (!existsSync(this.workflowsDir)) {
      mkdirSync(this.workflowsDir, { recursive: true });
    }
    const filePath = resolve(this.workflowsDir, `${this.workflow.workflowId}.json`);
    writeFileSync(filePath, JSON.stringify(this.workflow, null, 2));
  }

  private broadcastStatus(): void {
    if (!this.workflow) return;
    const msg = {
      type: 'workflow:status_response',
      requestId: '',
      data: this.getStatusData(),
    };
    for (const ws of this.registry.allViewers()) {
      this.send(ws, msg);
    }
  }

  sendError(ws: WebSocket, requestId: string, code: WorkflowErrorCode, message: string, details?: Record<string, unknown>): void {
    const error: WorkflowError = {
      type: 'workflow:error',
      requestId,
      code,
      message,
      ...(details ? { details } : {}),
    };
    this.send(ws, error);
  }

  private broadcastEscalation(task: WorkflowTaskState): void {
    const msg = {
      type: 'system_event',
      event: 'workflow_escalation',
      agentName: '',
      timestamp: new Date().toISOString(),
      agents: this.registry.list(),
      details: {
        taskId: task.id,
        iteration: task.iteration,
        message: `Task "${task.id}" stuck in review loop (${task.iteration} iterations). Intervene?`,
      },
    };
    for (const ws of this.registry.allViewers()) {
      this.send(ws, msg);
    }
  }

  private notifyOrchestrator(message: string): void {
    if (!this.workflow) return;
    const orchestratorWs = this.registry.get(this.workflow.orchestrator);
    if (!orchestratorWs) return;
    const delivery: DeliverMessage = {
      type: 'deliver',
      id: uuid(),
      from: 'workflow',
      to: this.workflow.orchestrator,
      content: JSON.stringify({
        type: 'workflow:task_update',
        workflowId: this.workflow.workflowId,
        message,
        status: this.getStatusData(),
      }),
      timestamp: new Date().toISOString(),
    };
    this.send(orchestratorWs, delivery);
  }

  private send(ws: WebSocket, data: unknown): void {
    ws.send(JSON.stringify(data));
  }
}
