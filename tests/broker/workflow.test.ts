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
});
