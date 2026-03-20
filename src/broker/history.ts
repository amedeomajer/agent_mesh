import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { HistoryEntry } from '../shared/protocol.js';
import { MAX_HISTORY_SIZE } from '../shared/constants.js';

type Listener = (entry: HistoryEntry) => void;

const HISTORY_FILE = '.mesh-history.json';

export class History {
  private entries: HistoryEntry[] = [];
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.load();
  }

  add(entry: HistoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_HISTORY_SIZE) {
      this.entries.shift();
    }
    this.save();
    // Notify all waiting long-poll listeners
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  get(filters?: { from?: string; limit?: number; since?: string }): HistoryEntry[] {
    let result = this.entries;

    if (filters?.from) {
      result = result.filter((e) => e.from === filters.from);
    }

    if (filters?.since) {
      const since = filters.since;
      result = result.filter((e) => e.timestamp > since);
    }

    const limit = filters?.limit ?? 20;
    return result.slice(-limit);
  }

  onNewMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private load(): void {
    try {
      if (existsSync(HISTORY_FILE)) {
        const data = readFileSync(HISTORY_FILE, 'utf-8');
        this.entries = JSON.parse(data);
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(HISTORY_FILE, JSON.stringify(this.entries));
    } catch {
      // Silently fail — persistence is best-effort
    }
  }
}
