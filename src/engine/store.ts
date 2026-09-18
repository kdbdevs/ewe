import { existsSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Execution } from './types';

// Single backend owner; persist each transition by atomic replacement.
export class ExecutionStore {
  private listeners = new Map<string, Set<(execution: Execution) => void>>();
  subscribe(id: string, listener: (execution: Execution) => void) {
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(listener); this.listeners.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  }
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.list();
  }
  list(): Execution[] {
    if (!existsSync(this.path)) return [];
    const data = JSON.parse(readFileSync(this.path, 'utf8'));
    if (!Array.isArray(data)) throw new Error('Execution storage must contain an array');
    return data;
  }
  get(id: string) { return this.list().find(item => item.executionId === id); }
  put(execution: Execution) {
    const data = [...this.list().filter(item => item.executionId !== execution.executionId), execution];
    const fd = openSync(this.path + '.tmp', 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(data, null, 2)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(this.path + '.tmp', this.path);
    const listeners = this.listeners.get(execution.executionId);
    if (listeners) for (const listener of [...listeners]) listener(execution);
  }
}
