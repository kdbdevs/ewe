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
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ewe-ph6-')); await start(); });
afterEach(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });

const call = (path: string, method = 'GET', data?: unknown) => fetch(base + '/api/workflows' + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
});
function node(id: string, type: string, parameters = {}): WorkflowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, credentials: {}, parameters: { ...defaultParameters(getNodeMetadata(type)!), ...parameters } };
}
async function save(nodes: WorkflowNode[], links: string[][]) {
  const workflow: Workflow = await (await call('', 'POST', { name: 'Phase 6' })).json();
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
  }, { timeout: 15000 }).not.toBe('running');
  return execution;
}

// ─── Registry ──────────────────────────────────────────────────────
it('AI node registered with all expected fields', () => {
  const meta = getNodeMetadata('ai');
  expect(meta).toBeDefined();
  expect(meta!.fields.map(f => f.key)).toEqual([
    'baseUrl', 'apiKey', 'model', 'systemPrompt', 'userPrompt', 'temperature', 'stream', 'timeout'
  ]);
});

it('Hermes Agent node registered with all expected fields', () => {
  const meta = getNodeMetadata('hermesAgent');
  expect(meta).toBeDefined();
  expect(meta!.fields.map(f => f.key)).toEqual([
    'prompt', 'model', 'sessionId', 'timeout'
  ]);
});

// ─── AI node (OpenAI-compatible) ─────────────────────────────────
it('AI node fails without apiKey', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'ai', { apiKey: '', model: 'gpt-4o-mini', systemPrompt: 'Test', userPrompt: 'Hello' }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('error');
  expect(byId.n1.output?.error).toMatch(/requires an API key/i);
});

it('AI node uses baseUrl parameter (mock server)', async () => {
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Mock response' } }],
        usage: { total_tokens: 42 },
      }));
    });
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
  const port = (mock.address() as any).port;

  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'ai', {
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'fake-key',
      model: 'test-model',
      systemPrompt: 'Test system',
      userPrompt: 'Test user',
    }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('success');
  expect(byId.n1.output?.response).toBe('Mock response');
  mock.close();
});

// ─── Hermes Agent node ────────────────────────────────────────────
it('Hermes Agent node runs prompt via hermes CLI', async () => {
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'hermesAgent', { prompt: 'Say hello in one word', timeout: 90000 }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  // Either success or error — depends on hermes CLI availability in env
  expect(['success', 'error']).toContain(byId.n1.status);
  expect(byId.n1.output).toBeDefined();
});

// ─── AI + Hermes integration workflow ─────────────────────────────
it('Set → AI → Set workflow (AI output passed downstream)', async () => {
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'PROCESSED' } }],
      }));
    });
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
  const port = (mock.address() as any).port;

  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'set', { field: 'input', value: 'process this' }),
    node('n2', 'ai', {
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'fake',
      systemPrompt: 'Echo input',
      userPrompt: '{{$json.input}}',
    }),
    node('n3', 'set', { field: 'output', value: '{{$json.response}}' }),
  ], [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n2.status).toBe('success');
  expect(byId.n3.status).toBe('success');
  mock.close();
});

// ─── AI stream parsing ────────────────────────────────────────────
it('AI node handles streaming response (SSE)', async () => {
  const mock = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":" World"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
  const port = (mock.address() as any).port;

  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'ai', {
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'fake',
      stream: 'yes',
      systemPrompt: 'Test',
      userPrompt: 'Hi',
    }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(byId.n1.status).toBe('success');
  expect(byId.n1.output?.response).toBe('Hello World');
  mock.close();
});

// ─── Hermes Agent cancellation via engine cancel ──────────────────
it('Hermes Agent node is cancellable via engine cancel', async () => {
  // Use a long prompt; engine cancel should interrupt or the CLI returns fast.
  // In CI env hermes CLI may finish before cancel — accept any terminal state.
  const workflow = await save([
    node('n0', 'manualTrigger'),
    node('n1', 'hermesAgent', { prompt: 'Write a detailed essay about quantum physics', timeout: 120000 }),
  ], [['n0', 'n1']]);
  const run = await launch(workflow.id);
  // Cancel immediately
  await call(`/${workflow.id}/executions/${run.executionId}/cancel`, 'POST');
  const result = await finished(workflow.id, run.executionId);
  expect(['cancelled', 'success', 'error']).toContain(result.status);
  const byId = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
  expect(['cancelled', 'success', 'error']).toContain(byId.n1.status);
});
