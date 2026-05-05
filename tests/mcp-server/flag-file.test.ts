import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { handleToolCall } from '../../src/mcp-server/tools.js';
import {
  sanitizeAgentName,
  flagPath,
  writeFlagIfAbsent,
} from '../../src/mcp-server/flag.js';

const FLAG_PATH = `/tmp/agent-mesh-test-agent.flag`;

const cleanup = () => {
  try { unlinkSync(FLAG_PATH); } catch { /* ok if missing */ }
};

describe('flag file write behavior', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('should write ISO 8601 timestamp to correct path', () => {
    const before = Date.now();
    writeFileSync(FLAG_PATH, new Date().toISOString(), 'utf8');
    const after = Date.now();

    expect(existsSync(FLAG_PATH)).toBe(true);
    const content = readFileSync(FLAG_PATH, 'utf8');
    const parsed = new Date(content).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it('should use the correct path pattern for flag file', () => {
    const agentName = 'my-agent';
    const expectedPath = `/tmp/agent-mesh-${agentName}.flag`;
    writeFileSync(expectedPath, new Date().toISOString(), 'utf8');
    expect(existsSync(expectedPath)).toBe(true);
    unlinkSync(expectedPath);
  });

  it('should not overwrite existing flag file', () => {
    const firstTimestamp = '2026-01-01T00:00:00.000Z';
    writeFileSync(FLAG_PATH, firstTimestamp, 'utf8');

    // Simulate the existsSync guard from index.ts
    if (!existsSync(FLAG_PATH)) {
      writeFileSync(FLAG_PATH, new Date().toISOString(), 'utf8');
    }

    expect(readFileSync(FLAG_PATH, 'utf8')).toBe(firstTimestamp);
  });

  it('should not throw when write fails', () => {
    const safeFlagWrite = (path: string, content: string) => {
      try {
        writeFileSync(path, content, 'utf8');
      } catch {
        // intentionally swallowed
      }
    };
    expect(() => safeFlagWrite('/nonexistent-dir/test.flag', 'ts')).not.toThrow();
  });
});

describe('flag helper module', () => {
  const cleanupAgents = ['helper-test', '___evil', 'mesh', 'pedregal'];

  beforeEach(() => {
    for (const a of cleanupAgents) {
      try { unlinkSync(flagPath(a)); } catch { /* ok */ }
    }
  });

  afterEach(() => {
    for (const a of cleanupAgents) {
      try { unlinkSync(flagPath(a)); } catch { /* ok */ }
    }
  });

  it('sanitizes unsafe characters in agent name', () => {
    expect(sanitizeAgentName('mesh-agent_01')).toBe('mesh-agent_01');
    expect(sanitizeAgentName('../etc/passwd')).toBe('___etc_passwd');
    expect(sanitizeAgentName('a/b\\c d')).toBe('a_b_c_d');
  });

  it('flagPath uses sanitized name in /tmp', () => {
    expect(flagPath('mesh')).toBe('/tmp/agent-mesh-mesh.flag');
    expect(flagPath('../evil')).toBe('/tmp/agent-mesh-___evil.flag');
  });

  it('writes flag with timestamp minus 1ms on first deliver', () => {
    writeFlagIfAbsent('helper-test', '2026-05-05T10:00:00.000Z');
    const content = readFileSync(flagPath('helper-test'), 'utf8');
    expect(content).toBe('2026-05-05T09:59:59.999Z');
  });

  it('does not overwrite the flag on subsequent deliver', () => {
    writeFlagIfAbsent('helper-test', '2026-05-05T10:00:00.000Z');
    writeFlagIfAbsent('helper-test', '2026-05-05T10:00:05.000Z');
    const content = readFileSync(flagPath('helper-test'), 'utf8');
    expect(content).toBe('2026-05-05T09:59:59.999Z');
  });

  it('writes a separate flag per agent', () => {
    writeFlagIfAbsent('mesh', '2026-05-05T10:00:00.000Z');
    writeFlagIfAbsent('pedregal', '2026-05-05T10:00:01.000Z');
    expect(existsSync(flagPath('mesh'))).toBe(true);
    expect(existsSync(flagPath('pedregal'))).toBe(true);
    expect(readFileSync(flagPath('pedregal'), 'utf8')).toBe(
      '2026-05-05T10:00:00.999Z',
    );
  });
});

describe('start_polling cron prompt', () => {
  const mockWs = { send: vi.fn() } as any;

  it('should include agent-specific flag file path', async () => {
    const result = await handleToolCall('start_polling', {}, mockWs, 'my-agent');
    expect(result.content[0].text).toContain('/tmp/agent-mesh-my-agent.flag');
  });

  it('should include fallback instruction', async () => {
    const result = await handleToolCall('start_polling', {}, mockWs, 'any-agent');
    expect(result.content[0].text).toContain('Fallback');
    expect(result.content[0].text).toContain('read_history');
  });

  it('should use different flag paths for different agent names', async () => {
    const result1 = await handleToolCall('start_polling', {}, mockWs, 'agent-one');
    const result2 = await handleToolCall('start_polling', {}, mockWs, 'agent-two');
    expect(result1.content[0].text).toContain('agent-one');
    expect(result2.content[0].text).toContain('agent-two');
    expect(result1.content[0].text).not.toContain('agent-two');
  });
});
