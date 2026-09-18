import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { it, expect } from 'vitest';
import { defaultParameters, getNodeMetadata } from '../src/nodes/registry';

it('streams durable ordered execution state and resyncs missed terminal events without a browser', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ewe-realtime-'));
  let child: ChildProcess | undefined;
  let base = '';
  const controllers: AbortController[] = [];
  const pending: http.ServerResponse[] = [];
  const upstream = http.createServer((req, res) => { req.resume(); pending.push(res); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/api/server.ts', '--port', '0', '--data', join(dir, 'workflows.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(output || 'Startup timeout')), 10000);
      child!.stderr!.on('data', data => { output += data; });
      child!.stdout!.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child!.once('exit', code => { clearTimeout(timer); reject(new Error(`Exit ${code}: ${output}`)); });
    });
  }
  async function stop() {
    if (child?.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
  }
  const call = (path: string, method = 'GET', body?: unknown) => fetch(base + '/api/workflows' + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function stream(path: string, lastId = '0') {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(base + '/api/workflows' + path + '/events', { headers: { 'Last-Event-ID': lastId }, signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder(); let buffer = '';
    return {
      close: () => controller.abort(),
      async next(): Promise<any> {
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split('\n').find(line => line.startsWith('data: '));
            if (data) {
              const snapshot = JSON.parse(data.slice(6));
              expect(frame).toContain(`id: ${snapshot.sequence}`);
              return snapshot;
            }
          } else {
            const result = await reader.read();
            if (result.done) throw new Error('Stream closed before expected snapshot');
            buffer += decoder.decode(result.value, { stream: true });
          }
        }
      },
    };
  }
  try {
    await start();
    const workflow = await (await call('', 'POST', { name: 'SSE proof' })).json();
    workflow.nodes = ['manualTrigger', 'httpRequest'].map((type, i) => ({ id: `node${i}`, type, name: type, position: { x: i * 240, y: 0 }, credentials: {}, parameters: defaultParameters(getNodeMetadata(type)!) }));
    workflow.nodes[1].parameters.url = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
    workflow.connections = [{ id: 'edge', source: 'node0', target: 'node1', sourcePort: 'main', targetPort: 'main' }];
    expect((await call('/' + workflow.id, 'PUT', workflow)).status).toBe(200);
    const run = await (await call(`/${workflow.id}/executions`, 'POST')).json();
    const path = `/${workflow.id}/executions/${run.executionId}`;
    const socket = await stream(path);
    let snapshot = await socket.next();
    while (snapshot.execution.nodeExecutions[1].status !== 'running') snapshot = await socket.next();
    expect(snapshot.execution.status).toBe('running');
    await expect.poll(() => pending.length).toBe(1);
    const cursor = snapshot.sequence;
    pending[0].writeHead(200, { 'Content-Type': 'application/json' }); pending[0].end('{"proof":true}');
    while (snapshot.execution.status === 'running') snapshot = await socket.next();
    expect(snapshot.execution.nodeExecutions[1].output.body).toEqual({ proof: true });
    const events = snapshot.execution.events;
    expect(events.map((event: any) => event.type)).toEqual(['workflow.started', 'node.started', 'node.finished', 'node.started', 'node.finished', 'workflow.finished']);
    expect(events.every((event: any, i: number) => event.id === i + 1 && event.executionId === run.executionId && event.workflowId === workflow.id && Number.isFinite(Date.parse(event.timestamp)))).toBe(true);
    socket.close();
    // Reconnect is an authoritative replacement, including when a client cursor is stale or invalid.
    const replay = await stream(path, String(cursor));
    expect((await replay.next()).execution).toEqual(snapshot.execution); replay.close();
    expect((await call(`/wrong/executions/${run.executionId}/events`)).status).toBe(404);
    await stop(); await start();
    const restored = await stream(path, '999999');
    expect((await restored.next()).execution).toEqual(snapshot.execution); restored.close();
    // Two active runs: disconnecting one must not stop it; cancellation cannot affect its sibling.
    const runA = await (await call(`/${workflow.id}/executions`, 'POST')).json();
    const runB = await (await call(`/${workflow.id}/executions`, 'POST')).json();
    const pathA = `/${workflow.id}/executions/${runA.executionId}`;
    const pathB = `/${workflow.id}/executions/${runB.executionId}`;
    const a = await stream(pathA); await a.next(); a.close();
    const b = await stream(pathB); let stateB = await b.next();
    await expect.poll(() => pending.length).toBe(3);
    await call(pathA + '/cancel', 'POST');
    pending[2].writeHead(500); pending[2].end('failure proof');
    while (stateB.execution.status === 'running') stateB = await b.next();
    expect(stateB.execution.status).toBe('error');
    expect(stateB.execution.events.slice(-2).map((event: any) => event.type)).toEqual(['node.failed', 'workflow.failed']);
    expect(stateB.execution.events.every((event: any) => event.executionId === runB.executionId)).toBe(true);
    b.close();
    const cancelled = await stream(pathA);
    const stateA = await cancelled.next(); cancelled.close();
    expect(stateA.execution.status).toBe('cancelled');
    expect(stateA.execution.events.at(-1).type).toBe('workflow.cancelled');
    expect(stateA.execution.nodeExecutions[1].status).toBe('cancelled');
    // Leave an actual connected subscriber during shutdown: SIGTERM must release sockets.
    const interrupted = await (await call(`/${workflow.id}/executions`, 'POST')).json();
    const interruptedPath = `/${workflow.id}/executions/${interrupted.executionId}`;
    const connected = await stream(interruptedPath); await connected.next();
    await stop(); connected.close(); await start();
    const recovered = await stream(interruptedPath);
    const recovery = await recovered.next(); recovered.close();
    expect(recovery.execution.status).toBe('cancelled');
    expect(recovery.execution.events.at(-1).type).toBe('workflow.cancelled');
  } finally {
    controllers.forEach(controller => controller.abort());
    await stop(); upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
