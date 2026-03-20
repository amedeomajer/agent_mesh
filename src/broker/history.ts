import type { HistoryEntry } from '../shared/protocol.js';
import { MAX_HISTORY_SIZE } from '../shared/constants.js';

export class History {
  private entries: HistoryEntry[] = [];

  add(entry: HistoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_HISTORY_SIZE) {
      this.entries.shift();
    }
  }

  get(filters?: { from?: string; limit?: number }): HistoryEntry[] {
    let result = this.entries;

    if (filters?.from) {
      result = result.filter((e) => e.from === filters.from);
    }

    const limit = filters?.limit ?? 20;
    return result.slice(-limit);
  }
}
