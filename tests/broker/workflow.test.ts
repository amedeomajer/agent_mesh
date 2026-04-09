import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkflowManager } from '../../src/broker/workflow.js';
import { Registry } from '../../src/broker/registry.js';
import { createMockWs, lastSent, type MockWebSocket } from '../helpers.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type WebSocket from 'ws';

const TMP_DIR = resolve(import.meta.dirname, '../../.test-tmp');
const TMP_PLANS = resolve(TMP_DIR, 'plans');
const TMP_WORKFLOWS = resolve(TMP_DIR, 'workflows');

const VALID_PLAN_YAML = `
name: "Test workflow"
config:
  onComplete: pr
  branch: feat/test
tasks:
  - id: task1
    description: "Do something"
    produce:
      type: implement
      role: implementer
    review:
      role: reviewer
  - id: task2
    description: "Do another thing"
    produce:
      type: implement
      role: implementer
    dependsOn:
      - task1
`;

function writePlan(filename: string, content: string): string {
  const path = resolve(TMP_PLANS, filename);
  writeFileSync(path, content);
  return path;
}

describe('WorkflowManager', () => {
  let registry: Registry;
  let manager: WorkflowManager;
  let orchWs: MockWebSocket;

  beforeEach(() => {
    mkdirSync(TMP_PLANS, { recursive: true });
    mkdirSync(TMP_WORKFLOWS, { recursive: true });
    registry = new Registry();
    orchWs = createMockWs();
    registry.add('orch', orchWs as unknown as WebSocket, undefined, 'orchestrator');
    manager = new WorkflowManager(registry, TMP_WORKFLOWS);
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  describe('workflow:create', () => {
    it('creates a workflow from a valid plan', () => {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:create_response');
      expect(resp.requestId).toBe('req1');
      expect(resp.workflowId).toBeDefined();
      expect(resp.status.name).toBe('Test workflow');
      expect(resp.status.status).toBe('running');
      expect(resp.status.tasks).toHaveLength(2);
      expect(resp.status.tasks[0].status).toBe('pending');
      expect(resp.status.tasks[0].iteration).toBe(0);
    });

    it('rejects non-orchestrator', () => {
      const implWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);

      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const resp = lastSent(implWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('NOT_AUTHORIZED');
    });

    it('rejects when a workflow is already running', () => {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req2',
        planPath,
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('WORKFLOW_ALREADY_ACTIVE');
    });

    it('rejects missing plan file', () => {
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath: '/nonexistent/plan.yaml',
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('INVALID_PLAN');
    });

    it('rejects invalid plan (duplicate IDs)', () => {
      const badPlan = `
name: "Bad plan"
config:
  onComplete: pr
tasks:
  - id: dup
    description: "A"
    produce:
      type: plan
      role: orchestrator
  - id: dup
    description: "B"
    produce:
      type: plan
      role: orchestrator
`;
      const planPath = writePlan('bad.yaml', badPlan);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('INVALID_PLAN');
    });

    it('persists workflow state to disk', () => {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const resp = lastSent(orchWs);
      const filePath = resolve(TMP_WORKFLOWS, `${resp.workflowId}.json`);
      expect(existsSync(filePath)).toBe(true);
    });

    it('broadcasts status to viewers', () => {
      const viewerWs = createMockWs();
      registry.addViewer(viewerWs as unknown as WebSocket);
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const viewerMsg = lastSent(viewerWs);
      expect(viewerMsg.type).toBe('workflow:status_response');
      expect(viewerMsg.data.status).toBe('running');
    });
  });

  describe('workflow:status', () => {
    it('returns current workflow status', () => {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const createResp = lastSent(orchWs);
      const queryWs = createMockWs();
      registry.add('querier', queryWs as unknown as WebSocket, undefined, 'implementer');

      manager.handle('querier', queryWs as unknown as WebSocket, {
        type: 'workflow:status',
        requestId: 'req2',
        workflowId: createResp.workflowId,
      });

      const resp = lastSent(queryWs);
      expect(resp.type).toBe('workflow:status_response');
      expect(resp.data.workflowId).toBe(createResp.workflowId);
      expect(resp.data.tasks).toHaveLength(2);
    });

    it('returns error for unknown workflow', () => {
      const queryWs = createMockWs();
      registry.add('querier', queryWs as unknown as WebSocket);

      manager.handle('querier', queryWs as unknown as WebSocket, {
        type: 'workflow:status',
        requestId: 'req1',
        workflowId: 'nonexistent',
      });

      const resp = lastSent(queryWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('WORKFLOW_NOT_FOUND');
    });
  });

  describe('workflow:cancel', () => {
    it('cancels a running workflow', () => {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const createResp = orchWs.sent.find((m: any) => m.type === 'workflow:create_response') as any;
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:cancel',
        requestId: 'req2',
        workflowId: createResp.workflowId,
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:cancel_response');
      expect(resp.ok).toBe(true);

      const state = manager.getWorkflow();
      expect(state?.status).toBe('cancelled');
    });

    it('rejects cancel from non-orchestrator', () => {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });

      const createResp = orchWs.sent.find((m: any) => m.type === 'workflow:create_response') as any;
      const implWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');

      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:cancel',
        requestId: 'req2',
        workflowId: createResp.workflowId,
      });

      const resp = lastSent(implWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('NOT_AUTHORIZED');
    });

    it('allows creating new workflow after cancel', () => {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req1',
        planPath,
      });
      const createResp = orchWs.sent.find((m: any) => m.type === 'workflow:create_response') as any;

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:cancel',
        requestId: 'req2',
        workflowId: createResp.workflowId,
      });

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'req3',
        planPath,
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:create_response');
      expect(resp.workflowId).not.toBe(createResp.workflowId);
    });
  });

  describe('workflow:assign', () => {
    function createWorkflow(): string {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'create-req',
        planPath,
      });
      const resp = orchWs.sent.find((m: any) => m.type === 'workflow:create_response') as any;
      return resp.workflowId;
    }

    it('assigns a task to an agent and delivers notification', () => {
      const workflowId = createWorkflow();
      const implWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'assign-req',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:assign_response');
      expect(resp.ok).toBe(true);

      const delivery = lastSent(implWs);
      expect(delivery.type).toBe('deliver');
      expect(delivery.from).toBe('workflow');
      expect(delivery.to).toBe('impl');

      const notification = JSON.parse(delivery.content);
      expect(notification.type).toBe('workflow:notification');
      expect(notification.taskId).toBe('task1');
      expect(notification.phase).toBe('produce');
      expect(notification.iteration).toBe(1);
      expect(notification.context.description).toBe('Do something');
      expect(notification.context.branch).toBe('feat/test');
      expect(notification.context.baseBranch).toBe('main');
      expect(notification.context.produceType).toBe('implement');
    });

    it('sets task status to producing', () => {
      const workflowId = createWorkflow();
      const implWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'assign-req',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      const status = manager.getStatusData();
      const task = status.tasks.find(t => t.id === 'task1');
      expect(task?.status).toBe('producing');
      expect(task?.assignee).toBe('impl');
      expect(task?.iteration).toBe(1);
    });

    it('rejects assignment to offline agent', () => {
      const workflowId = createWorkflow();

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'assign-req',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'offline-agent',
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('AGENT_OFFLINE');
    });

    it('rejects role mismatch', () => {
      const workflowId = createWorkflow();
      const revWs = createMockWs();
      registry.add('rev', revWs as unknown as WebSocket, undefined, 'reviewer');

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'assign-req',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'rev',
      });

      const resp = lastSent(orchWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('AGENT_ROLE_MISMATCH');
    });

    it('rejects non-orchestrator assigning', () => {
      const workflowId = createWorkflow();
      const implWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');

      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'assign-req',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      const resp = lastSent(implWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('NOT_AUTHORIZED');
    });

    it('hydrates priorFeedback in context on reassignment', () => {
      const workflowId = createWorkflow();
      const implWs = createMockWs();
      const revWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');
      registry.add('rev', revWs as unknown as WebSocket, undefined, 'reviewer');

      // Assign produce
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a1',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      // Complete produce
      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Implemented it',
        branch: 'feat/test',
      });

      // Assign review
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a2',
        workflowId,
        taskId: 'task1',
        phase: 'review',
        assignee: 'rev',
      });

      // Reviewer requests changes
      manager.handle('rev', revWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c2',
        workflowId,
        taskId: 'task1',
        result: 'changes_requested',
        summary: 'Fix the null check on line 42',
        branch: 'feat/test',
      });

      // Re-assign produce — should have priorFeedback
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a3',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      const delivery = lastSent(implWs);
      const notification = JSON.parse(delivery.content);
      expect(notification.context.priorFeedback).toBe('Fix the null check on line 42');
      expect(notification.iteration).toBe(2);
    });
  });

  describe('workflow:complete', () => {
    function setupWorkflow(): { workflowId: string; implWs: MockWebSocket; revWs: MockWebSocket } {
      const planPath = writePlan('plan.yaml', VALID_PLAN_YAML);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'create-req',
        planPath,
      });
      const resp = orchWs.sent.find((m: any) => m.type === 'workflow:create_response') as any;
      const implWs = createMockWs();
      const revWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');
      registry.add('rev', revWs as unknown as WebSocket, undefined, 'reviewer');
      return { workflowId: resp.workflowId, implWs, revWs };
    }

    it('marks task done when no review phase', () => {
      const noReviewPlan = `
name: "No review"
config:
  onComplete: stop
tasks:
  - id: task1
    description: "Do something"
    produce:
      type: implement
      role: implementer
`;
      const planPath = writePlan('no-review.yaml', noReviewPlan);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'cr',
        planPath,
      });
      const cr = orchWs.sent.find((m: any) => m.type === 'workflow:create_response') as any;
      const implWs = createMockWs();
      registry.add('impl', implWs as unknown as WebSocket, undefined, 'implementer');

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a1',
        workflowId: cr.workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId: cr.workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Done',
        branch: 'main',
      });

      const resp = lastSent(implWs);
      expect(resp.type).toBe('workflow:complete_response');
      expect(resp.ok).toBe(true);

      const task = manager.getStatusData().tasks[0];
      expect(task.status).toBe('done');
      expect(task.lastResult).toBe('done');
    });

    it('sets task to pending when produce done and review exists', () => {
      const { workflowId, implWs } = setupWorkflow();

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a1',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Implemented',
        branch: 'feat/test',
      });

      const task = manager.getStatusData().tasks.find(t => t.id === 'task1');
      expect(task?.status).toBe('pending');
      expect(task?.lastResult).toBe('done');
      expect(task?.assignee).toBeUndefined();
    });

    it('marks task done on review approved', () => {
      const { workflowId, implWs, revWs } = setupWorkflow();

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a1',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });
      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Done',
        branch: 'feat/test',
      });

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a2',
        workflowId,
        taskId: 'task1',
        phase: 'review',
        assignee: 'rev',
      });
      manager.handle('rev', revWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c2',
        workflowId,
        taskId: 'task1',
        result: 'approved',
        summary: 'LGTM',
        branch: 'feat/test',
      });

      const task = manager.getStatusData().tasks.find(t => t.id === 'task1');
      expect(task?.status).toBe('done');
      expect(task?.lastResult).toBe('approved');
    });

    it('stores feedback and increments iteration on changes_requested', () => {
      const { workflowId, implWs, revWs } = setupWorkflow();

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a1',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });
      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Done',
        branch: 'feat/test',
      });

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a2',
        workflowId,
        taskId: 'task1',
        phase: 'review',
        assignee: 'rev',
      });
      manager.handle('rev', revWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c2',
        workflowId,
        taskId: 'task1',
        result: 'changes_requested',
        summary: 'Fix the bug',
        branch: 'feat/test',
      });

      const task = manager.getStatusData().tasks.find(t => t.id === 'task1');
      expect(task?.status).toBe('pending');
      expect(task?.iteration).toBe(2);
      expect(task?.lastResult).toBe('changes_requested');
    });

    it('rejects done from non-producing task', () => {
      const { workflowId, implWs } = setupWorkflow();

      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Done',
        branch: 'feat/test',
      });

      const resp = lastSent(implWs);
      expect(resp.type).toBe('workflow:error');
      expect(resp.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('marks workflow completed when all tasks done', () => {
      const singleTaskPlan = `
name: "Single"
config:
  onComplete: stop
tasks:
  - id: only
    description: "The only task"
    produce:
      type: implement
      role: implementer
`;
      const planPath = writePlan('single.yaml', singleTaskPlan);
      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:create',
        requestId: 'cr',
        planPath,
      });
      const cr = orchWs.sent.find((m: any) => m.type === 'workflow:create_response') as any;
      const implWs = createMockWs();
      registry.add('impl2', implWs as unknown as WebSocket, undefined, 'implementer');

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a1',
        workflowId: cr.workflowId,
        taskId: 'only',
        phase: 'produce',
        assignee: 'impl2',
      });

      manager.handle('impl2', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId: cr.workflowId,
        taskId: 'only',
        result: 'done',
        summary: 'All done',
        branch: 'main',
      });

      expect(manager.getWorkflow()?.status).toBe('completed');
    });

    it('notifies orchestrator on completion', () => {
      const { workflowId, implWs } = setupWorkflow();

      manager.handle('orch', orchWs as unknown as WebSocket, {
        type: 'workflow:assign',
        requestId: 'a1',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'impl',
      });

      const orchSentBefore = orchWs.sent.length;
      manager.handle('impl', implWs as unknown as WebSocket, {
        type: 'workflow:complete',
        requestId: 'c1',
        workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Done',
        branch: 'feat/test',
      });

      const newMsgs = orchWs.sent.slice(orchSentBefore);
      const notification = newMsgs.find((m: any) => m.type === 'deliver' && m.from === 'workflow');
      expect(notification).toBeDefined();
    });
  });
});
