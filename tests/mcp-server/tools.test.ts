import { describe, it, expect } from 'vitest';
import { getToolDefinitions } from '../../src/mcp-server/tools.js';

describe('getToolDefinitions', () => {
  const baseToolNames = ['send_message', 'list_agents', 'read_history', 'start_polling'];

  it('returns only base tools when no role', () => {
    const tools = getToolDefinitions();
    const names = tools.map(t => t.name);
    expect(names).toEqual(baseToolNames);
  });

  it('returns base + orchestrator tools for orchestrator', () => {
    const tools = getToolDefinitions('orchestrator');
    const names = tools.map(t => t.name);
    expect(names).toEqual([
      ...baseToolNames,
      'workflow_create',
      'workflow_assign',
      'workflow_status',
      'workflow_cancel',
    ]);
  });

  it('returns base + worker tools for implementer', () => {
    const tools = getToolDefinitions('implementer');
    const names = tools.map(t => t.name);
    expect(names).toEqual([
      ...baseToolNames,
      'workflow_complete',
      'workflow_status',
    ]);
  });

  it('returns base + worker tools for reviewer', () => {
    const tools = getToolDefinitions('reviewer');
    const names = tools.map(t => t.name);
    expect(names).toEqual([
      ...baseToolNames,
      'workflow_complete',
      'workflow_status',
    ]);
  });

  it('workflow_create has planPath as required param', () => {
    const tools = getToolDefinitions('orchestrator');
    const createTool = tools.find(t => t.name === 'workflow_create');
    expect(createTool?.inputSchema.required).toContain('planPath');
  });

  it('workflow_assign has all required params', () => {
    const tools = getToolDefinitions('orchestrator');
    const assignTool = tools.find(t => t.name === 'workflow_assign');
    expect(assignTool?.inputSchema.required).toEqual(
      expect.arrayContaining(['workflowId', 'taskId', 'phase', 'assignee']),
    );
  });

  it('workflow_complete has all required params', () => {
    const tools = getToolDefinitions('implementer');
    const completeTool = tools.find(t => t.name === 'workflow_complete');
    expect(completeTool?.inputSchema.required).toEqual(
      expect.arrayContaining(['workflowId', 'taskId', 'result', 'summary', 'branch']),
    );
  });
});
