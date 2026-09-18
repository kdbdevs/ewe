/**
 * Code executor using QuickJS-emscripten WASM sandbox.
 * 
 * Security model (task §5, SPEC §20):
 * - NO Node.js APIs (process, require, fs, http, child_process) — verified by QuickJS isolation
 * - NO ambient access to host: no `global`, `module`, `exports`
 * - Resource-limited: 5s execution cap, 64MB memory cap
 * - Time-limited via child process fork with hard kill on timeout
 * - No eval/Function in the MAIN API — user code runs inside QuickJS only
 * 
 * Process-level isolation: the worker is forked as a child process. The parent
 * enforces a wall-clock timeout and SIGKILLs the child on expiry — synchronous
 * WASM eval blocks the event loop so in-process setTimeout is unreliable.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { WorkflowNode } from '../model';
import type { NodeResult } from './executors';
import type { Data } from './types';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MEMORY_LIMIT = 64 * 1024 * 1024; // 64 MB

interface CodeParams {
  language: string; // 'javascript'
  source: string;
  timeout?: number;
  memoryLimit?: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createCodeExecutor() {
  return async function codeExecutor(node: WorkflowNode, input: Data, signal: AbortSignal): Promise<NodeResult> {
    const params = node.parameters as unknown as CodeParams;
    const source = String(params.source || '');
    if (!source.trim()) {
      return { output: { result: null, logs: [] }, port: 'main' };
    }

    const timeoutMs = Math.min(
      Math.max(Number(params.timeout) || DEFAULT_TIMEOUT_MS, 100),
      30000
    );
    const memoryLimit = Math.min(
      Math.max(Number(params.memoryLimit) || DEFAULT_MEMORY_LIMIT, 1024 * 1024),
      256 * 1024 * 1024
    );

    // Abort if the engine cancelled while we were waiting
    if (signal.aborted) {
      return { output: { error: 'Execution cancelled', logs: [], result: null }, port: 'error' };
    }

    return new Promise<NodeResult>((resolve) => {
      const workerPath = join(__dirname, 'code-worker.cjs');
      const child = fork(workerPath, [], {
        execArgv: [],
        silent: true,
      });

      let settled = false;
      const cleanup = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.removeAllListeners();
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }
      };

      const timer = setTimeout(() => {
        resolve({
          output: { error: `Code execution timed out after ${timeoutMs}ms`, logs: [], result: null },
          port: 'error',
        });
        cleanup();
      }, timeoutMs);

      child.on('message', (msg: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeAllListeners();
        resolve(msg as NodeResult);
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          output: { error: err.message, logs: [], result: null },
          port: 'error',
        });
        cleanup();
      });

      child.on('exit', (code, sig) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (sig === 'SIGKILL' || code === null || code === 128 + 9) {
          resolve({
            output: { error: `Code execution timed out after ${timeoutMs}ms`, logs: [], result: null },
            port: 'error',
          });
        } else if (code !== 0 && code !== null) {
          resolve({
            output: { error: `Code worker exited with code ${code}`, logs: [], result: null },
            port: 'error',
          });
        } else {
          // Should not happen; message arrives before exit
          resolve({
            output: { error: 'Code execution failed', logs: [], result: null },
            port: 'error',
          });
        }
        cleanup();
      });

      // Forward abort → kill worker
      signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          output: { error: 'Execution cancelled', logs: [], result: null },
          port: 'error',
        });
        cleanup();
      }, { once: true });

      // Send work to child
      child.send({ source, input, memoryLimit, timeoutMs });
    });
  };
}
