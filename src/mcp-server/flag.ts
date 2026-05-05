import { writeFileSync, existsSync } from 'node:fs';

const FLAG_DIR = '/tmp';

export function sanitizeAgentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function flagPath(agentName: string): string {
  return `${FLAG_DIR}/agent-mesh-${sanitizeAgentName(agentName)}.flag`;
}

export function writeFlagIfAbsent(
  agentName: string,
  messageTimestamp: string,
): void {
  const path = flagPath(agentName);
  if (existsSync(path)) return;
  const since = new Date(Date.parse(messageTimestamp) - 1).toISOString();
  try {
    writeFileSync(path, since, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return;
    process.stderr.write(
      `[agent-mesh] Failed to write flag file: ${(err as Error).message}\n`,
    );
  }
}
