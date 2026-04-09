import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestBroker, connectAgent, sendAndWait } from '../helpers/broker.js';
import type { ChildProcess } from 'node:child_process';
import type WebSocket from 'ws';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_PORT = 4299;
const TMP_DIR = resolve(import.meta.dirname, '../../.test-integration-tmp');

const PLAN_YAML = `
name: "Integration test workflow"
config:
  onComplete: stop
  branch: test-branch
  baseBranch: main
tasks:
  - id: task1
    description: "First task"
    produce:
      type: implement
      role: implementer
    review:
      role: reviewer
`;

describe('Workflow lifecycle (integration)', () => {
  let broker: ChildProcess;
  let orchConn: { ws: WebSocket; messages: any[] };
  let implConn: { ws: WebSocket; messages: any[] };
  let revConn: { ws: WebSocket; messages: any[] };

  beforeAll(async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(resolve(TMP_DIR, 'plan.yaml'), PLAN_YAML);
    broker = await startTestBroker(TEST_PORT);
    orchConn = await connectAgent(TEST_PORT, 'test-orch', 'orchestrator');
    implConn = await connectAgent(TEST_PORT, 'test-impl', 'implementer');
    revConn = await connectAgent(TEST_PORT, 'test-rev', 'reviewer');
    // Small delay for registrations to settle
    await new Promise(r => setTimeout(r, 200));
  }, 10000);

  afterAll(() => {
    orchConn?.ws.close();
    implConn?.ws.close();
    revConn?.ws.close();
    broker?.kill();
    try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
    try { rmSync('.mesh-workflows', { recursive: true, force: true }); } catch {}
  });

  it('creates a workflow, assigns produce, completes, assigns review, approves', async () => {
    // 1. Create workflow
    const createResp = await sendAndWait(
      orchConn.ws,
      orchConn.messages,
      {
        type: 'workflow:create',
        planPath: resolve(TMP_DIR, 'plan.yaml'),
      },
      'workflow:create_response',
    );
    expect(createResp.type).toBe('workflow:create_response');
    expect(createResp.workflowId).toBeDefined();
    const workflowId = createResp.workflowId;

    // 2. Check status
    const statusResp = await sendAndWait(
      orchConn.ws,
      orchConn.messages,
      { type: 'workflow:status', workflowId },
      'workflow:status_response',
    );
    expect(statusResp.data.status).toBe('running');
    expect(statusResp.data.tasks[0].status).toBe('pending');

    // 3. Assign produce to implementer
    const assignResp = await sendAndWait(
      orchConn.ws,
      orchConn.messages,
      {
        type: 'workflow:assign',
        workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'test-impl',
      },
      'workflow:assign_response',
    );
    expect(assignResp.ok).toBe(true);

    // 4. Implementer should have received a notification
    await new Promise(r => setTimeout(r, 100));
    const notification = implConn.messages.find(
      (m: any) => m.type === 'deliver' && m.from === 'workflow',
    );
    expect(notification).toBeDefined();
    const notifContent = JSON.parse(notification.content);
    expect(notifContent.taskId).toBe('task1');
    expect(notifContent.phase).toBe('produce');

    // 5. Implementer completes
    const completeResp = await sendAndWait(
      implConn.ws,
      implConn.messages,
      {
        type: 'workflow:complete',
        workflowId,
        taskId: 'task1',
        result: 'done',
        summary: 'Implemented the feature',
        branch: 'test-branch',
      },
      'workflow:complete_response',
    );
    expect(completeResp.ok).toBe(true);

    // 6. Assign review
    const reviewAssignResp = await sendAndWait(
      orchConn.ws,
      orchConn.messages,
      {
        type: 'workflow:assign',
        workflowId,
        taskId: 'task1',
        phase: 'review',
        assignee: 'test-rev',
      },
      'workflow:assign_response',
    );
    expect(reviewAssignResp.ok).toBe(true);

    // 7. Reviewer approves
    const approveResp = await sendAndWait(
      revConn.ws,
      revConn.messages,
      {
        type: 'workflow:complete',
        workflowId,
        taskId: 'task1',
        result: 'approved',
        summary: 'LGTM',
        branch: 'test-branch',
      },
      'workflow:complete_response',
    );
    expect(approveResp.ok).toBe(true);

    // 8. Workflow should be completed
    const finalStatus = await sendAndWait(
      orchConn.ws,
      orchConn.messages,
      { type: 'workflow:status', workflowId },
      'workflow:status_response',
    );
    expect(finalStatus.data.status).toBe('completed');
    expect(finalStatus.data.tasks[0].status).toBe('done');
  }, 15000);

  it('returns AGENT_OFFLINE when assigning to disconnected agent', async () => {
    writeFileSync(resolve(TMP_DIR, 'plan2.yaml'), PLAN_YAML.replace('Integration test', 'Offline test'));

    const createResp = await sendAndWait(
      orchConn.ws,
      orchConn.messages,
      {
        type: 'workflow:create',
        planPath: resolve(TMP_DIR, 'plan2.yaml'),
      },
      'workflow:create_response',
    );

    const resp = await sendAndWait(
      orchConn.ws,
      orchConn.messages,
      {
        type: 'workflow:assign',
        workflowId: createResp.workflowId,
        taskId: 'task1',
        phase: 'produce',
        assignee: 'offline-agent',
      },
      'workflow:error',
    );
    expect(resp.code).toBe('AGENT_OFFLINE');
  });
});
