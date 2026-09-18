import { existsSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Workflow } from '../model';

// One backend process owns this file. Synchronous read/modify/rename prevents
// overlapping requests from losing updates; rename never exposes partial JSON.
export class WorkflowStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.read(); // Fail startup on corrupt storage instead of silently overwriting it.
  }
  private read(): Workflow[] {
    if (!existsSync(this.path)) return [];
    const data = JSON.parse(readFileSync(this.path, 'utf8'));
    if (!Array.isArray(data)) throw new Error('Workflow storage must contain an array');
    return data;
  }
  private write(data: Workflow[]) {
    const fd = openSync(this.path + '.tmp', 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(data, null, 2)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(this.path + '.tmp', this.path);
  }
  list() { return this.read(); }
  get(id: string) { return this.read().find(workflow => workflow.id === id); }
  put(workflow: Workflow) {
    const data = this.read().filter(item => item.id !== workflow.id);
    this.write([...data, workflow]);
    return workflow;
  }
  delete(id: string) { this.write(this.read().filter(item => item.id !== id)); }
}
