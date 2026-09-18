export interface ExecutionLog { timestamp: string; event: string; nodeId?: string; message?: string; }
export type NodeStatus = 'waiting' | 'running' | 'success' | 'error' | 'skipped' | 'cancelled';
export type Data = Record<string, unknown>;
export interface NodeExecution {
  nodeId: string;
  nodeName?: string;
  status: NodeStatus;
  input: Data | null;
  output: Data | null;
  startedAt: string | null;
  finishedAt: string | null;
  duration: number;
  error?: string;
  port?: string;
  resolvedParameters?: Data | null;
}
export interface ExecutionEvent {
  id: number;
  executionId: string;
  workflowId: string;
  timestamp: string;
  type: string;
  nodeId?: string;
}
export interface ExecutionSnapshot { sequence: number; execution: Execution; }
export interface Execution {
  executionId: string;
  workflowId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error' | 'cancelled';
  nodeExecutions: NodeExecution[];
  logs?: ExecutionLog[];
  sequence?: number;
  events?: ExecutionEvent[];
}
