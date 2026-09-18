import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, Panel, ReactFlow, addEdge,
  useEdgesState, useNodesState, type Connection, type Edge, type Node, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { api, type WorkflowSummary } from './api/client';
import { defaultParameters, getNodeMetadata, registry } from './nodes/registry';
import type { Workflow, WorkflowNode } from './model';
import { validateWorkflow } from './validation';
import EweNode from './editor/EweNode';
import ConfigPanel from './editor/ConfigPanel';
import ActivityPanel from './editor/ActivityPanel';
import ExecutionInspector from './editor/ExecutionInspector';
import WorkflowTransfer from './editor/WorkflowTransfer';
import { useExecution } from './editor/useExecution';
import KeyboardHelp from './editor/KeyboardHelp';

const nodeTypes = { ewe: EweNode };
type AppNode = Node<{ node: WorkflowNode }, 'ewe'>;
const initialViewport = { x: 30, y: 50, zoom: 0.85 };
const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  className: 'ewe-edge',
};
const toFlow = (workflow: Workflow) => ({
  nodes: workflow.nodes.map(node => ({ id: node.id, type: 'ewe' as const, position: node.position, data: { node } })),
  edges: workflow.connections.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort })),
});
const serialise = (nodes: AppNode[], edges: Edge[], workflow: Workflow, viewport: Viewport): Workflow => ({
  ...workflow,
  settings: { ...workflow.settings, viewport },
  nodes: nodes.map(({ id, position, data }) => ({ ...data.node, id, position })),
  connections: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourcePort: edge.sourceHandle || 'main', targetPort: edge.targetHandle || 'main' })),
});

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function App() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const suppressViewportDirty = useRef(false);
  const { execution, events: activityEvents, error: executionError, start, stop } = useExecution(workflow?.id);
  const executing = execution?.status === 'running';
  const busy = saving || executing;
  const executionByNode = useMemo(() => new Map(execution?.nodeExecutions.map(record => [record.nodeId, record]) ?? []), [execution]);
  const displayNodes = useMemo(() => nodes.map(node => {
    const record = executionByNode.get(node.id);
    return { ...node, data: { ...node.data, status: record?.status, duration: record?.duration, port: record?.port } };
  }), [nodes, executionByNode]);
  const displayEdges = useMemo(() => edges.map(edge => {
    const sourceStatus = executionByNode.get(edge.source)?.status;
    const targetStatus = executionByNode.get(edge.target)?.status;
    const status =
      sourceStatus === 'running' || targetStatus === 'running' ? 'running' :
      sourceStatus === 'error' || targetStatus === 'error' || sourceStatus === 'cancelled' || targetStatus === 'cancelled' ? 'error' :
      sourceStatus === 'success' && targetStatus === 'success' ? 'success' :
      targetStatus === 'skipped' ? 'skipped' : 'idle';
    return {
      ...edge,
      animated: status === 'running',
      className: `ewe-edge ewe-edge-${status}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    };
  }), [edges, executionByNode]);

  // ─── Keyboard shortcuts ────────────────────────────────────────
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // Don't capture when typing in inputs/textareas/selects
    if (target.matches('input, textarea, select')) return;

    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key === 's') { event.preventDefault(); save(); return; }
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      if (!busy && workflow && nodes.some(n => n.data.node.type === 'manualTrigger')) execute();
      return;
    }
    if (event.key === 'Escape') { setSelectedNodeId(undefined); return; }
    if (event.key === '?') { setHelpOpen(current => !current); return; }
  }, [busy, workflow, nodes, selectedNodeId]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const execute = () => {
    if (!workflow) return;
    void run(async () => {
      const saved = await api.save(serialise(nodes, edges, workflow, viewport));
      setWorkflow(saved); setDirty(false); await refreshList(); await start(saved.id);
    });
  };

  const refreshList = useCallback(async () => setWorkflows(await api.list()), []);
  useEffect(() => { refreshList().then(() => setLoaded(true)).catch(error => setMessage(String(error))); }, [refreshList]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const changed = () => { if (workflow) { setDirty(true); setMessage('Unsaved changes'); } };
  const mayLeave = () => !dirty || window.confirm('Discard unsaved changes?');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const load = (next: Workflow) => {
    suppressViewportDirty.current = true;
    setWorkflow(next);
    const flow = toFlow(next);
    setNodes(flow.nodes); setEdges(flow.edges);
    setViewport(next.settings.viewport || initialViewport);
    setSelectedNodeId(undefined); setMessage(''); setDirty(false);
  };
  const open = (id: string) => {
    if (mayLeave()) void run(async () => load(await api.get(id)));
  };
  const create = () => {
    if (mayLeave()) void run(async () => {
      const created = await api.create(`Workflow ${workflows.length + 1}`);
      await refreshList(); load(created);
    });
  };
  const save = () => {
    if (!workflow) return;
    const snapshot = serialise(nodes, edges, workflow, viewport);
    const invalid = validateWorkflow(snapshot);
    if (invalid) { setMessage(invalid); return; }
    void run(async () => {
      const saved = await api.save(snapshot);
      setWorkflow(saved); await refreshList(); setDirty(false); setMessage('Saved');
    });
  };
  const addNode = (type: string) => {
    if (!workflow) return;
    const def = getNodeMetadata(type)!;
    const node: WorkflowNode = {
      id: uid(), type, name: def.name,
      position: { x: 30 + (nodes.length % 3) * 260, y: 100 + Math.floor(nodes.length / 3) * 160 },
      parameters: defaultParameters(def), credentials: {},
    };
    setNodes(current => [...current, { id: node.id, type: 'ewe', position: node.position, data: { node } }]);
    setSelectedNodeId(node.id); changed();
  };
  const deleteSelected = () => {
    if (!selectedNodeId) return;
    setNodes(current => current.filter(node => node.id !== selectedNodeId));
    setEdges(current => current.filter(edge => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setSelectedNodeId(undefined); changed();
  };
  const onConnect = (connection: Connection) => {
    if (connection.source === connection.target) return;
    setEdges(current => addEdge({ ...connection, id: uid() }, current));
    changed();
  };
  const selectedNode = useMemo(() => nodes.find(item => item.id === selectedNodeId)?.data.node, [nodes, selectedNodeId]);
  const patchNode = (patch: Partial<WorkflowNode>) => {
    setNodes(current => current.map(node => node.id === selectedNodeId ? { ...node, data: { node: { ...node.data.node, ...patch } } } : node));
    changed();
  };

  return (
    <div className="ewe-app" aria-busy={busy}>
      <nav className="ewe-sidebar" aria-label="Workflows">
        <h1><span className="brand-mark">e</span> eWe</h1>
        <p className="ewe-tagline">VISUAL WORKFLOW AUTOMATION</p>
        <button type="button" data-testid="create-workflow" disabled={!loaded || busy} onClick={create}>+ New workflow</button>
        <WorkflowTransfer workflow={workflow} disabled={busy}
          mayLeave={mayLeave} onMessage={setMessage} onImported={async next => { await refreshList(); load(next); }} />
        <h2 className="section-label">WORKSPACE</h2>
        <ul data-testid="workflow-list">
          {workflows.map(item => <li key={item.id} className={item.id === workflow?.id ? 'ewe-active' : ''}>
            <button type="button" disabled={busy} onClick={() => open(item.id)}>{item.name}</button>
          </li>)}
        </ul>
        <div className="sidebar-foot">LOCAL WORKSPACE<br /><span>Phase 7 · Polish</span></div>
      </nav>
      <main className="ewe-main">
        <header className="ewe-toolbar">
          <span className="section-label">EDITOR /</span>
          <input aria-label="Workflow name" maxLength={120} data-testid="workflow-name" disabled={!workflow || busy}
            placeholder="Choose a workflow" value={workflow?.name ?? ''}
            onChange={event => { if (workflow) { setWorkflow({ ...workflow, name: event.target.value }); changed(); } }} />
          <span className={`draft-badge${dirty ? ' is-dirty' : ''}`}>{dirty ? 'UNSAVED' : 'DRAFT'}</span>
          {executing ? <button type="button" className="ewe-stop" data-testid="stop-workflow" onClick={() => void run(stop)}>Stop</button> : null}
          <button type="button" data-testid="run-workflow" disabled={!workflow || busy || !nodes.some(node => node.data.node.type === 'manualTrigger')} onClick={execute}>Run</button>
          <button className="primary" type="button" data-testid="save-workflow" disabled={!workflow || busy} onClick={save}>{busy ? 'Working…' : 'Save'}</button>
          <button type="button" aria-label="Keyboard shortcuts" className="ewe-help-btn" data-testid="keyboard-help-toggle" onClick={() => setHelpOpen(current => !current)}>?</button>
        </header>
        <div className={`ewe-notice${executionError ? ' is-error' : ''}${execution && execution.status !== 'running' && execution.status !== 'success' ? ' is-result' : ''}`}>
          {executionError ? `Error: ${executionError}` :
           executing ? 'Executing — node status updates as nodes run. Stop cancels the active execution.' :
           execution && execution.status !== 'running' ? `Execution ${execution.status}` :
           message || 'Ready to edit'}
        </div>
        <div className="ewe-workspace" ref={element => { element?.toggleAttribute('inert', busy); }}>
          <div className="ewe-canvas" data-testid="canvas">
            {(!loaded) && (
              <div className="ewe-skeleton" data-testid="canvas-skeleton">
                <div className="skeleton-shelf" />
                <div className="skeleton-list"><div className="skeleton-item" /><div className="skeleton-item" /><div className="skeleton-item" /></div>
              </div>
            )}
            {loaded && workflow && nodes.length === 0 && (
              <div className="empty-state">
                <span className="empty-state-icon">＋</span>
                <h2>Start with a trigger.</h2>
                <p>Add a Manual Trigger, Webhook, or Schedule node from the library, then connect actions to build the automation.</p>
              </div>
            )}
            {loaded && !workflow && (
              <div className="empty-state">
                <span className="empty-state-icon">↯</span>
                <h2>Your next workflow starts here.</h2>
                <p>Create or import a workflow to open the automation canvas.</p>
              </div>
            )}
            <ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              onNodesChange={changes => {
                onNodesChange(changes);
                const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id));
                if (removed.size) setEdges(current => current.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)));
                if (changes.some(change => change.type === 'remove' || change.type === 'position')) changed();
              }}
              onEdgesChange={changes => { onEdgesChange(changes); if (changes.some(change => change.type === 'remove')) changed(); }}
              onConnect={onConnect} isValidConnection={connection => connection.source !== connection.target}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)} onPaneClick={() => setSelectedNodeId(undefined)}
              viewport={viewport} onViewportChange={setViewport} onMoveEnd={event => {
                if (!event) return;
                if (suppressViewportDirty.current) { suppressViewportDirty.current = false; return; }
                changed();
              }}
              minZoom={0.18} maxZoom={2.2} snapToGrid snapGrid={[16, 16]}
              panOnScroll zoomOnPinch zoomOnScroll selectionOnDrag
              deleteKeyCode={['Backspace', 'Delete']} colorMode="dark">
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.25} color="#2d2634" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                pannable zoomable
                position="bottom-right"
                nodeBorderRadius={10}
                nodeColor={node => executionByNode.get(node.id)?.status === 'running' ? '#ff6d00' : '#3a3342'}
                nodeStrokeColor={node => executionByNode.get(node.id)?.status === 'error' ? '#ff5a6a' : '#665d72'}
                maskColor="rgba(12, 9, 16, .72)"
              />
              <Panel position="top-left" className="canvas-hud">
                <strong>{workflow?.name || 'Workflow'}</strong>
                <span>{nodes.length} nodes</span>
                <span>{edges.length} edges</span>
                {execution?.status ? <em data-state={execution.status}>{execution.status}</em> : null}
              </Panel>
            </ReactFlow>
          </div>
          <div className="ewe-inspector">
            {workflow && <ActivityPanel items={activityEvents} status={execution?.status} />}
            {workflow && <ExecutionInspector workflowId={workflow.id} current={execution} />}
            <aside className="ewe-palette">
              <h2>Node library</h2>
              <input aria-label="Search nodes" placeholder="Search nodes…" value={query} onChange={event => setQuery(event.target.value)} />
              {registry.filter(def => def.name.toLowerCase().includes(query.toLowerCase())).map(def => <button key={def.type} type="button" data-testid={`add-${def.type}`} disabled={!workflow} onClick={() => addNode(def.type)} title={def.description}>
                <span>{def.icon}</span> {def.name}<small>+</small>
              </button>)}
            </aside>
            {selectedNode ? <ConfigPanel node={selectedNode} def={getNodeMetadata(selectedNode.type)!}
              onParameterChange={(key, value) => patchNode({ parameters: { ...selectedNode.parameters, [key]: value } })}
              onNameChange={name => patchNode({ name })} onDelete={deleteSelected} /> : <p className="config-hint">Select a node to configure it.<br /><br />Connect: click an output, then an input.<br />Disconnect: select an edge, press <kbd>Delete</kbd>.<br />Pan: drag the canvas. Zoom: scroll.</p>}
          </div>
        </div>
        <footer className="ewe-bottom">
          <span>{nodes.length} nodes · {edges.length} connections</span>
          {execution && execution.status !== 'running' ? <span data-testid="execution-result" className={`result-${execution.status}`}>Execution {execution.status}</span> : null}
          <span data-testid="status" role="status">{executionError ? `Error: ${executionError}` : message || 'Ready to edit'}</span>
          <button type="button" className="ewe-kbd-help" onClick={() => setHelpOpen(true)} aria-label="Show keyboard shortcuts"><kbd>?</kbd> Shortcuts</button>
        </footer>
      </main>
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
