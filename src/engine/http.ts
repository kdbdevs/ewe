import type { WorkflowNode } from '../model';
import type { NodeResult } from './executors';

function pairs(raw: unknown): Record<string, string> {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string')) throw new Error('Headers/query must be JSON objects of strings');
  return value as Record<string, string>;
}
export async function httpRequest(node: WorkflowNode, _input: unknown, signal: AbortSignal): Promise<NodeResult> {
  const p = node.parameters;
  const url = new URL(String(p.url));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must use HTTP or HTTPS');
  const headers = new Headers(pairs(p.headers ?? '{}'));
  for (const [key, value] of Object.entries(pairs(p.query ?? '{}'))) url.searchParams.set(key, value);
  const method = String(p.method);
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Invalid HTTP method');
  if (!Number.isInteger(p.timeout) || Number(p.timeout) < 1 || Number(p.timeout) > 300000) throw new Error('Timeout must be an integer from 1 to 300000 ms');
  if (!['raw', 'json'].includes(String(p.bodyType ?? 'raw'))) throw new Error('Invalid body type');
  let body: string | undefined;
  if (method !== 'GET' && p.body !== '' && p.body !== undefined) {
    if ((p.bodyType ?? 'raw') === 'json') {
      body = JSON.stringify(typeof p.body === 'string' ? JSON.parse(p.body) : p.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    } else {
      if (typeof p.body !== 'string') throw new Error('Raw body must be text');
      body = p.body;
    }
  }
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(Number(p.timeout))]) });
  const text = await response.text();
  const parsed = text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  return { output: { status: response.status, headers: Object.fromEntries(response.headers), body: parsed }, port: 'main' };
}
