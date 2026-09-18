import type { Workflow } from './model';
import { validateWorkflow } from './validation';

// Explicit projection excludes execution history and unknown top-level metadata.
export function workflowDocument(value: unknown): Workflow {
  const invalid = validateWorkflow(value);
  if (invalid) throw new Error(invalid);
  const workflow = value as Workflow;
  return {
    id: workflow.id, name: workflow.name, enabled: false,
    nodes: workflow.nodes.map(node => ({ id: node.id, type: node.type, name: node.name, position: { x: node.position.x, y: node.position.y }, parameters: { ...node.parameters }, credentials: {} })),
    connections: workflow.connections.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourcePort: edge.sourcePort, targetPort: edge.targetPort })),
    settings: structuredClone(workflow.settings), createdAt: workflow.createdAt, updatedAt: workflow.updatedAt,
  };
}
