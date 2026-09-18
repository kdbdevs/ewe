import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeMetadata } from '../nodes/registry';
import type { WorkflowNode } from '../model';

export default function EweNode({ data }: NodeProps) {
  const node = data.node as WorkflowNode;
  const def = getNodeMetadata(node.type);
  return (
    <div className="ewe-node" data-testid="canvas-node" data-status={String(data.status || '')}>
      {def && def.inputs.map(port => <Handle key={port} id={port} type="target" position={Position.Left} className="ewe-handle-target" />)}
      <div className="ewe-node-icon">{def?.icon ?? '?'}</div>
      <div>
        <div className="ewe-node-name">{node.name}</div>
        <div className="ewe-node-type">{def?.name ?? node.type}</div>
        {data.status ? <div data-testid="node-status">{String(data.status)}</div> : null}
      </div>
      {def && def.outputs.map(port => <Handle key={port} id={port} type="source" position={Position.Right} className="ewe-handle-source" />)}
    </div>
  );
}
