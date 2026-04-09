import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/broker/registry.js';
import { createMockWs } from '../helpers.js';
import type WebSocket from 'ws';

describe('Registry', () => {
  it('stores role and capabilities on add', () => {
    const registry = new Registry();
    const ws = createMockWs() as unknown as WebSocket;
    registry.add('orch', ws, 'desc', 'orchestrator', ['planning']);

    const agents = registry.list();
    expect(agents[0].role).toBe('orchestrator');
    expect(agents[0].capabilities).toEqual(['planning']);
  });

  it('add works without role (backwards compatible)', () => {
    const registry = new Registry();
    const ws = createMockWs() as unknown as WebSocket;
    registry.add('agent1', ws, 'desc');

    const agents = registry.list();
    expect(agents[0].role).toBeUndefined();
    expect(agents[0].capabilities).toBeUndefined();
  });

  it('list includes role in AgentInfo', () => {
    const registry = new Registry();
    const ws1 = createMockWs() as unknown as WebSocket;
    const ws2 = createMockWs() as unknown as WebSocket;
    registry.add('orch', ws1, undefined, 'orchestrator');
    registry.add('impl', ws2, undefined, 'implementer');

    const agents = registry.list();
    expect(agents.find(a => a.name === 'orch')?.role).toBe('orchestrator');
    expect(agents.find(a => a.name === 'impl')?.role).toBe('implementer');
  });

  it('getRole returns role for registered agent', () => {
    const registry = new Registry();
    const ws = createMockWs() as unknown as WebSocket;
    registry.add('rev', ws, undefined, 'reviewer');

    expect(registry.getRole('rev')).toBe('reviewer');
  });

  it('getRole returns undefined for agent without role', () => {
    const registry = new Registry();
    const ws = createMockWs() as unknown as WebSocket;
    registry.add('norole', ws);

    expect(registry.getRole('norole')).toBeUndefined();
  });

  it('getRole returns undefined for unknown agent', () => {
    const registry = new Registry();
    expect(registry.getRole('nobody')).toBeUndefined();
  });
});
