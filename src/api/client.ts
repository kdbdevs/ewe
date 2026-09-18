import type { Workflow } from '../model';
import type { Execution } from '../engine/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api/workflows' + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Request failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
export interface WorkflowSummary { id: string; name: string; }
export const api = {
  import: (workflow: Workflow) => request<Workflow>('/import', { method: 'POST', body: JSON.stringify(workflow) }),
  executions: (id: string) => request<Execution[]>(`/${id}/executions`),
  start: (id: string) => request<Execution>(`/${id}/executions`, { method: 'POST' }),
  execution: (id: string, executionId: string) => request<Execution>(`/${id}/executions/${executionId}`),
  cancel: (id: string, executionId: string) => request<Execution>(`/${id}/executions/${executionId}/cancel`, { method: 'POST' }),
  list: () => request<WorkflowSummary[]>(''),
  create: (name: string) => request<Workflow>('', { method: 'POST', body: JSON.stringify({ name }) }),
  get: (id: string) => request<Workflow>('/' + id),
  save: (workflow: Workflow) => request<Workflow>('/' + workflow.id, { method: 'PUT', body: JSON.stringify(workflow) }),
};
