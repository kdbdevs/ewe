import type { Workflow, WorkflowNode, Connection } from '../model';
import { validateWorkflow } from '../validation';
import { getNodeMetadata } from '../nodes/registry';

export class ExecutionValidationError extends Error {}

// Nodes that legitimately accept multiple incoming edges.
const MULTI_INPUT_TYPES = new Set(['merge', 'loop']);

export interface Graph {
  ordered: WorkflowNode[];
  /** All incoming edges per node (one entry per edge). */
  incoming: Map<string, Connection[]>;
  /** Outgoing edges per node (one entry per edge). */
  outgoing: Map<string, Connection[]>;
  /** Trigger nodes: nodes with no incoming edges. */
  triggers: WorkflowNode[];
}

export function buildGraph(workflow: Workflow): Graph {
  const invalid = validateWorkflow(workflow);
  if (invalid) throw new ExecutionValidationError(invalid);

  const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));
  const incoming = new Map<string, Connection[]>();
  const outgoing = new Map<string, Connection[]>();

  for (const node of workflow.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }

  for (const edge of workflow.connections) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      throw new ExecutionValidationError('Dangling connection');
    }
    const target = nodeMap.get(edge.target)!;
    const existing = incoming.get(edge.target)!;
    if (existing.length > 0 && !MULTI_INPUT_TYPES.has(target.type)) {
      throw new ExecutionValidationError(
        `Multiple inputs to "${target.name}" require a Merge or Loop node`
      );
    }
    existing.push(edge);
    outgoing.get(edge.source)!.push(edge);
  }

  // Topological sort: a node is ready when all its sources have been visited.
  const pending = [...workflow.nodes];
  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();

  while (pending.length) {
    const index = pending.findIndex(node =>
      incoming.get(node.id)!.every(edge => visited.has(edge.source))
    );
    if (index < 0) throw new ExecutionValidationError('Cycles are not supported');
    const [node] = pending.splice(index, 1);
    ordered.push(node);
    visited.add(node.id);
  }

  const triggers = ordered.filter(node => {
    const meta = getNodeMetadata(node.type);
    return incoming.get(node.id)!.length === 0 && meta!.inputs.length === 0;
  });
  if (triggers.length === 0) {
    throw new ExecutionValidationError('Workflow has no trigger node');
  }
  if (triggers.length > 1) {
    throw new ExecutionValidationError('Workflow can only have one trigger node');
  }

  return { ordered, incoming, outgoing, triggers };
}
