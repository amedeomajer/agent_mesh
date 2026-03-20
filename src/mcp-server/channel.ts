import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { DeliverMessage } from '../shared/protocol.js';

export async function pushChannelNotification(
  mcp: Server,
  msg: DeliverMessage,
): Promise<void> {
  try {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: msg.content,
        meta: {
          from: msg.from,
          message_id: msg.id,
          timestamp: msg.timestamp,
        },
      },
    });
  } catch {
    // Channel notifications may not be supported on older Claude Code versions.
    // The message is still in history and can be retrieved via read_history.
  }
}
