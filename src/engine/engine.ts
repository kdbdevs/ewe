import { randomUUID } from 'node:crypto';
import type { Workflow } from '../model';
import { buildGraph } from './graph';
import { executors } from './executors';
import { resolveExpressions } from './expressions';
import { ExecutionStore } from './store';
import type { Execution, NodeExecution, Data } from './types';
import { getNodeMetadata } from '../nodes/registry';

function log(execution: Execution, event: string, nodeId?: string, message?: string) {
  const timestamp = new Date().toISOString();
  (execution.logs ??= []).push({ timestamp, event, ...(nodeId ? { nodeId } : {}), ...(message ? { message } : {}) });
  const names: Record<string, string> = { 'node.success': 'node.finished', 'node.error': 'node.failed', 'workflow.success': 'workflow.finished', 'workflow.error': 'workflow.failed' };
  execution.sequence = (execution.sequence ?? 0) + 1;
  (execution.events ??= []).push({ id: execution.sequence, executionId: execution.executionId, workflowId: execution.workflowId, timestamp, type: names[event] ?? event, ...(nodeId ? { nodeId } : {}) });
  execution.events = execution.events.slice(-256);
}
function finishNode(record: NodeExecution) {
  record.finishedAt = new Date().toISOString();
  record.duration = record.startedAt ? Date.parse(record.finishedAt) - Date.parse(record.startedAt) : 0;
}
export class ExecutionEngine {
  private active = new Map<string, { controller: AbortController; execution: Execution; done: Promise<void> }>();
  constructor(public readonly history: ExecutionStore) {
    for (const execution of history.list().filter(item => item.status === 'running')) {
      for (const record of execution.nodeExecutions) {
        if (record.status === 'waiting' || record.status === 'running') {
          record.status = 'cancelled'; record.error = 'Backend interrupted'; finishNode(record);
          log(execution, 'node.cancelled', record.nodeId, record.error);
        }
      }
      execution.status = 'cancelled'; execution.finishedAt = new Date().toISOString();
      log(execution, 'workflow.cancelled', undefined, 'Backend interrupted');
      history.put(execution);
    }
  }
  start(workflow: Workflow): Execution {
    const snapshot = structuredClone(workflow);
    const graph = buildGraph(snapshot);
    const execution: Execution = {
      executionId: randomUUID(), workflowId: snapshot.id, startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
      nodeExecutions: snapshot.nodes.map(node => ({ nodeId: node.id, nodeName: node.name, status: 'waiting', input: null, resolvedParameters: null, output: null, startedAt: null, finishedAt: null, duration: 0 })),
      logs: [],
    };
    log(execution, 'workflow.started');
    this.history.put(execution);
    const controller = new AbortController();
    const done = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.execute(graph, execution, controller.signal));
    this.active.set(execution.executionId, { controller, execution, done });
    return execution;
  }
  async cancel(id: string) {
    const active = this.active.get(id);
    if (active) { active.controller.abort(); await active.done; }
    return this.history.get(id);
  }
  private async execute(graph: ReturnType<typeof buildGraph>, execution: Execution, signal: AbortSignal) {
    const records = new Map(execution.nodeExecutions.map(record => [record.nodeId, record]));
    for (const node of graph.ordered) {
      const record = records.get(node.id)!;
      if (signal.aborted) break;
      const incoming = graph.incoming.get(node.id) ?? [];
      const meta = getNodeMetadata(node.type);
      const isTrigger = incoming.length === 0 && meta!.inputs.length === 0;

      if (!isTrigger) {
        if (incoming.length === 0) {
          record.status = 'skipped'; finishNode(record); log(execution, 'node.skipped', node.id); this.history.put(execution); continue;
        }
        const allSatisfied = incoming.every(edge => {
          const source = records.get(edge.source);
          if (!source || source.status !== 'success') return false;
          // Switch in 'all' mode returns comma-separated ports (e.g. 'out1,out2')
          const sourcePorts = String(source.port).split(',');
          return sourcePorts.includes(edge.sourcePort);
        });
        if (!allSatisfied) { record.status = 'skipped'; finishNode(record); log(execution, 'node.skipped', node.id); this.history.put(execution); continue; }
        if (incoming.length === 1) {
          record.input = structuredClone(records.get(incoming[0].source)!.output ?? {});
        } else {
          const fanIn = new Map<string, unknown>();
          for (const edge of incoming) {
            fanIn.set(edge.source, records.get(edge.source)!.output);
          }
          record.input = { _fanIn: Object.fromEntries(fanIn), _fanInArray: [...fanIn.values()] };
        }
      } else {
        record.input = {};
      }
      record.status = 'running'; record.startedAt = new Date().toISOString();
      log(execution, 'node.started', node.id);
      this.history.put(execution);
      try {
        const context = { input: record.input, nodes: graph.ordered.map(previous => ({ name: previous.name, ...records.get(previous.id)! })) };
        const parameters = Object.fromEntries(Object.entries(node.parameters).map(([key, value]) => [key, resolveExpressions(value, context)]));
        record.resolvedParameters = parameters;
        const result = await executors[node.type]({ ...node, parameters }, record.input, signal);
        signal.throwIfAborted();
        record.output = result.output; record.port = result.port;
        if (result.port === 'error') {
          record.status = 'error';
          record.error = String((result.output as Data)?.error ?? 'Code execution error');
        } else {
          record.status = 'success';
        }
      } catch (error) {
        record.status = signal.aborted ? 'cancelled' : 'error';
        record.error = signal.aborted ? 'Execution cancelled' : error instanceof Error ? (error.name === 'TimeoutError' ? 'HTTP request timed out' : error.message) : String(error);
      }
      finishNode(record);
      log(execution, `node.${record.status}`, node.id, record.error);
      this.history.put(execution);
    }
    for (const record of execution.nodeExecutions) {
      if (record.status === 'waiting') { record.status = 'cancelled'; finishNode(record); log(execution, 'node.cancelled', record.nodeId); }
    }
    execution.status = signal.aborted ? 'cancelled' : execution.nodeExecutions.some(record => record.status === 'error') ? 'error' : 'success';
    execution.finishedAt = new Date().toISOString();
    log(execution, `workflow.${execution.status}`);
    this.history.put(execution);
    this.active.delete(execution.executionId);
  }
}
