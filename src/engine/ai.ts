import { TextDecoder } from 'node:util';
import type { WorkflowNode } from '../model';
import type { Data } from './types';
import type { NodeResult } from './executors';

const OPENAI_PATH = '/v1/chat/completions';

export async function aiOpenAI(
  node: WorkflowNode,
  input: Data,
  signal: AbortSignal
): Promise<NodeResult> {
  const baseUrl = String(node.parameters.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  const apiKey = String(node.parameters.apiKey || process.env.OPENAI_API_KEY || '');
  const model = String(node.parameters.model || 'gpt-4o-mini');
  const systemPrompt = String(node.parameters.systemPrompt || 'You are a helpful assistant.');
  const userPrompt = String(node.parameters.userPrompt || '');
  const temperature = Number(node.parameters.temperature ?? 0.7);
  const stream = node.parameters.stream === 'yes' || node.parameters.stream === true;
  const timeout = Math.min(Math.max(Number(node.parameters.timeout) || 30000, 1000), 120000);

  const resolvedSystem = interpolateParams(systemPrompt, input);
  const resolvedUser = interpolateParams(userPrompt, input);

  if (!apiKey) {
    return { output: { error: 'AI node requires an API key (set apiKey parameter or OPENAI_API_KEY env var)' }, port: 'error' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  signal.addEventListener('abort', () => controller.abort());

  try {
    const response = await fetch(baseUrl + OPENAI_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: resolvedSystem },
          { role: 'user', content: resolvedUser },
        ],
        temperature,
        stream,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { output: { error: `AI API error ${response.status}: ${text.slice(0, 500)}` }, port: 'error' };
    }

    if (stream && response.body) {
      const raw = await readStreamBody(response.body);
      const content = parseSSEContent(raw);
      return { output: { response: content, raw }, port: 'main' };
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || '';
    return { output: { response: content, usage: json.usage || null }, port: 'main' };
  } catch (err: any) {
    if (err?.name === 'AbortError') return { output: { error: 'AI node timed out' }, port: 'error' };
    return { output: { error: `AI node error: ${err?.message || err}` }, port: 'error' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readStreamBody(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) chunks.push(decoder.decode(result.value, { stream: true }));
  }
  return chunks.join('');
}

function parseSSEContent(raw: string): string {
  let content = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) content += delta;
    } catch { /* skip */ }
  }
  return content;
}

export async function hermesAgent(
  node: WorkflowNode,
  input: Data,
  signal: AbortSignal
): Promise<NodeResult> {
  const prompt = String(node.parameters.prompt || '');
  const model = String(node.parameters.model || '');
  const sessionId = String(node.parameters.sessionId || '');
  const timeout = Math.min(Math.max(Number(node.parameters.timeout) || 60000, 1000), 300000);

  const resolvedPrompt = interpolateParams(prompt, input);
  const args = ['chat', '-q', resolvedPrompt, '--oneshot'];
  if (model) args.push('-m', model);
  if (sessionId) args.push('--resume', sessionId);

  return new Promise<NodeResult>((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require('node:child_process');
    const child = spawn('hermes', args, {
      env: { ...process.env, TERM: 'dumb' },
      cwd: process.cwd(),
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ output: { error: `Hermes Agent timed out after ${timeout}ms` }, port: 'error' });
    }, timeout);

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve({ output: { error: 'Hermes Agent node cancelled' }, port: 'error' });
    });

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ output: { error: `Hermes Agent exit ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}` }, port: 'error' });
      } else {
        resolve({ output: { response: stdout.trim() || '' }, port: 'main' });
      }
    });
  });
}

function interpolateParams(template: string, input: Data): string {
  if (!template.includes('{{')) return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_match: string, expr: string) => {
    try {
      const trimmed = expr.trim();
      if (trimmed.startsWith('$json.') || trimmed.startsWith('$json[')) {
        const path = trimmed.slice(6);
        const val = path.split('.').reduce<unknown>((acc, key) => {
          if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[key];
          }
          return undefined;
        }, input);
        return typeof val === 'string' ? val : JSON.stringify(val ?? '');
      }
      return JSON.stringify(input);
    } catch {
      return '';
    }
  });
}
