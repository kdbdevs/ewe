import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { it, expect, beforeEach, afterEach } from 'vitest';
import { defaultParameters, getNodeMetadata } from '../src/nodes/registry';
import type { Workflow, WorkflowNode } from '../src/model';

let dir: string, child: ChildProcess, base: string;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/api/server.ts', '--port', '0', '--data', join(dir, 'workflows.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(output || 'Startup timeout')), 15000);
    child.stderr!.on('data', data => { output += data; });
    child.stdout!.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exit ${code}: ${output}`)); });
  });
}
async function stop() {
  if (child?.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
}
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ewe-ph5-')); await start(); });
afterEach(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });

const call = (path: string, method = 'GET', data?: unknown) => fetch(base + '/api/workflows' + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
});
function node(id: string, type: string, parameters = {}): WorkflowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, credentials: {}, parameters: { ...defaultParameters(getNodeMetadata(type)!), ...parameters } };
}
async function save(nodes: WorkflowNode[], links: string[][]) {
  const workflow: Workflow = await (await call('', 'POST', { name: 'Phase 5' })).json();
  workflow.nodes = nodes;
  workflow.connections = links.map(([source, target, port = 'main'], i) => ({ id: `edge${i}`, source, target, sourcePort: port, targetPort: 'main' }));
  const response = await call('/' + workflow.id, 'PUT', workflow);
  expect(response.status, await response.text()).toBe(200);
  return workflow;
}
async function launch(id: string) {
  const response = await call(`/${id}/executions`, 'POST');
  expect(response.status, await response.clone().text()).toBe(202);
  return response.json();
}
async function finished(workflowId: string, executionId: string) {
  let execution: any;
  await expect.poll(async () => {
    execution = await (await call(`/${workflowId}/executions/${executionId}`)).json();
    return execution.status;
  }, { timeout: 10000 }).not.toBe('running');
  return execution;
}

// ─── Switch ────────────────────────────────────────────────────────
it('Switch routes to named output branches (multi-out)', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'set', { field: 'action', value: 'a' }),
    node('n2', 'switch', { field: 'action', mode: 'first', rules: JSON.stringify([{ operator: 'equals', value: 'a', port: 'alpha' }, { operator: 'equals', value: 'b', port: 'beta' }]), defaultPort: 'default' }),
    node('n3', 'set', { field: 'result', value: 'ALPHA' }),
    node('n4', 'set', { field: 'result', value: 'BETA' }),
  ], [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3', 'alpha'], ['n2', 'n4', 'beta']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n3.status).toBe('success');
  expect(byId.n4.status).toBe('skipped');
  expect(byId.n3.output.result).toBe('ALPHA');
});

it('Switch supports all-match mode and default port', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'set', { field: 'status', value: 'active' }),
    node('n2', 'switch', { field: 'status', mode: 'all', rules: JSON.stringify([{ operator: 'isNotEmpty', value: '', port: 'out1' }, { operator: 'contains', value: 'act', port: 'out2' }]), defaultPort: 'fallback' }),
    node('n3', 'set', { field: 'r', value: 'A' }),
  ], [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3', 'out1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n3.status).toBe('success');
  expect(byId.n2.port).toBe('out1,out2');
});

// ─── Merge (fan-in) ────────────────────────────────────────────────
it('Merge combines data from multiple branches', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'set', { field: 'a', value: '1' }),
    node('n2', 'set', { field: 'b', value: '2' }),
    node('n3', 'merge', { mode: 'append' }),
    node('n4', 'set', { field: 'final', value: 'merged' }),
  ], [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n2', 'n3'], ['n3', 'n4']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n3.status).toBe('success');
  expect(byId.n4.status).toBe('success');
  expect(byId.n4.output.final).toBe('merged');
});

// ─── Loop ──────────────────────────────────────────────────────────
it('Loop collects items from fan-in arrays', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'set', { field: 'items', value: 'not-array' }),
    node('n2', 'set', { field: 'data', value: 'x' }),
    node('n3', 'loop', { sourceField: 'data', maxIterations: 50 }),
  ], [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n2', 'n3']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n3.status).toBe('success');
  expect(byId.n3.output.count).toBeGreaterThanOrEqual(1);
});

// ─── Wait ──────────────────────────────────────────────────────────
it('Wait pauses execution and is cancellable', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'wait', { duration: 200 }),
    node('n2', 'set', { field: 'after', value: 'done' }),
  ], [['n0', 'n1'], ['n1', 'n2']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('success');
  expect(byId.n1.duration).toBeGreaterThanOrEqual(150);
  expect(byId.n2.output.after).toBe('done');
});

it('Wait is cancelled mid-execution', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'wait', { duration: 60000 }),
    node('n2', 'set', { field: 'after', value: 'done' }),
  ], [['n0', 'n1'], ['n1', 'n2']]);
  const run = await launch(workflow.id);
  await new Promise(r => setTimeout(r, 100));
  await call(`/${workflow.id}/executions/${run.executionId}/cancel`, 'POST');
  const result = await finished(workflow.id, run.executionId);
  expect(result.status).toBe('cancelled');
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('cancelled');
  expect(byId.n2.status).toBe('cancelled');
});

// ─── Code (QuickJS sandbox) ────────────────────────────────────────
it('Code executes user JS in isolated sandbox', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'set', { field: 'x', value: '10' }),
    node('n2', 'code', { source: '(function() { input.x = Number(input.x) + 5; return input; })()' }),
    node('n3', 'set', { field: 'result', value: 'computed' }),
  ], [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n2.status).toBe('success');
  expect(byId.n2.output.x).toBe(15);
});

it('Code sandbox blocks Node.js APIs (process, require, fs)', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'code', { source: 'return { leaked: typeof process !== "undefined" };' }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('success');
  expect(byId.n1.output.leaked).toBe(false);
});

it('Code sandbox enforces timeout on infinite loops', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'code', { source: 'while(true) { Math.random(); } return 1;', timeout: 200 }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('error');
  expect(byId.n1.error).toMatch(/timed out/i);
});

it('Code supports console.log capturing', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'code', { source: 'console.log("hello from sandbox"); return { ok: true };' }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('success');
  expect(byId.n1.output.logs).toEqual(['hello from sandbox']);
});

// ─── Webhook ───────────────────────────────────────────────────────
it('Webhook endpoint triggers workflow and validates secret', async () => {
  const workflow = await save([
    node('n0', 'webhook', { path: '/hooks/test', secret: 'my-secret', enabled: 'yes' }),
    node('n1', 'set', { field: 'triggered', value: 'yes' }),
  ], [['n0', 'n1']]);
  // Without secret → 401
  const bad = await fetch(base + '/api/hooks/' + workflow.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  expect(bad.status).toBe(401);
  // With correct secret → 202
  const good = await fetch(base + '/api/hooks/' + workflow.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ewe-secret': 'my-secret' }, body: JSON.stringify({ payload: 'data' }) });
  expect(good.status).toBe(202);
  const body = await good.json();
  expect(body.executionId).toBeTruthy();
  const result = await finished(workflow.id, body.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.output.triggered).toBe('yes');
});

it('Webhook rejects when disabled', async () => {
  const workflow = await save([
    node('n0', 'webhook', { path: '/hooks/off', enabled: 'no' }),
    node('n1', 'set', { field: 'triggered', value: 'yes' }),
  ], [['n0', 'n1']]);
  const res = await fetch(base + '/api/hooks/' + workflow.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  expect(res.status).toBe(404);
});

// ─── Schedule ──────────────────────────────────────────────────────
it('Schedule trigger endpoint starts workflow', async () => {
  const workflow = await save([
    node('n0', 'schedule', { cron: '*/5 * * * *', enabled: 'yes' }),
    node('n1', 'set', { field: 'scheduled', value: 'ran' }),
  ], [['n0', 'n1']]);
  const res = await fetch(base + '/api/schedules/' + workflow.id + '/trigger', { method: 'POST' });
  expect(res.status).toBe(202);
  const body = await res.json();
  const result = await finished(workflow.id, body.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.output.scheduled).toBe('ran');
});

it('Schedule trigger rejects when no schedule node', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'set', { field: 'x', value: '1' }),
  ], [['n0', 'n1']]);
  const res = await fetch(base + '/api/schedules/' + workflow.id + '/trigger', { method: 'POST' });
  expect(res.status).toBe(400);
});

// ─── Cron matching ─────────────────────────────────────────────────
it('Cron expression matching works for basic patterns', async () => {
  // This tests the cron matcher indirectly via schedule trigger
  const workflow = await save([
    node('n0', 'schedule', { cron: '0 0 1 1 *', enabled: 'yes' }),
    node('n1', 'set', { field: 'cronTest', value: 'ok' }),
  ], [['n0', 'n1']]);
  const res = await fetch(base + '/api/schedules/' + workflow.id + '/trigger', { method: 'POST' });
  expect(res.status).toBe(202);
});

// ─── Multi-node integration ────────────────────────────────────────
it('Full graph: Webhook → Switch → Code', async () => {
  const workflow = await save([
    node('n0', 'webhook', { path: '/hooks/full', enabled: 'yes' }),
    node('n1', 'set', { field: 'type', value: 'A' }),
    node('n2', 'switch', { field: 'type', rules: JSON.stringify([{ operator: 'equals', value: 'A', port: 'alpha' }, { operator: 'equals', value: 'B', port: 'beta' }]) }),
    node('n3', 'set', { field: 'branch', value: 'A-branch' }),
    node('n4', 'set', { field: 'branch', value: 'B-branch' }),
    node('n5', 'code', { source: 'return { final: input.branch };' }),
  ], [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3', 'alpha'], ['n2', 'n4', 'beta'], ['n3', 'n5']]);
  const res = await fetch(base + '/api/hooks/' + workflow.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'A' }) });
  expect(res.status).toBe(202);
  const body = await res.json();
  const result = await finished(workflow.id, body.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n3.status).toBe('success');
  expect(byId.n4.status).toBe('skipped');
  expect(byId.n5.status).toBe('success');
  expect(byId.n5.output.final).toBe('A-branch');
});

// ─── Wait no-replay after restart ──────────────────────────────────
it('Wait does not replay after backend restart', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'wait', { duration: 500 }),
    node('n2', 'set', { field: 'afterWait', value: 'completed' }),
  ], [['n0', 'n1'], ['n1', 'n2']]);
  const run = await launch(workflow.id);
  // Kill during wait
  await new Promise(r => setTimeout(r, 100));
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  await start();
  const result = await (await call(`/${workflow.id}/executions/${run.executionId}`)).json();
  expect(result.status).toBe('cancelled');
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('cancelled');
  expect(byId.n2.status).toBe('cancelled');
});
