/**
 * Code sandbox worker — runs in a child process for true timeout enforcement.
 * Plain CommonJS .js file (not TypeScript) so it can be forked without tsx.
 * Receives { source, input, memoryLimit, timeoutMs } via IPC and sends back
 * a NodeResult-shaped object. Infinite loops are killed by the parent timeout.
 */
const { getQuickJS } = require('quickjs-emscripten');

function jsValueToHandle(vm, value) {
  if (value === null || value === undefined) return vm.undefined;
  if (typeof value === 'number') return vm.newNumber(value);
  if (typeof value === 'string') return vm.newString(value);
  if (typeof value === 'boolean') return value ? vm.true : vm.false;
  if (Array.isArray(value)) {
    const arr = vm.newArray();
    for (let i = 0; i < value.length; i++) {
      const h = jsValueToHandle(vm, value[i]);
      vm.setProp(arr, String(i), h);
      h.dispose();
    }
    return arr;
  }
  if (typeof value === 'object') {
    const obj = vm.newObject();
    for (const [k, v] of Object.entries(value)) {
      const h = jsValueToHandle(vm, v);
      vm.setProp(obj, k, h);
      h.dispose();
    }
    return obj;
  }
  return vm.undefined;
}

function stringifyHandle(vm, handle) {
  try {
    const dumped = vm.dump(handle);
    if (dumped && typeof dumped === 'object' && 'message' in dumped) {
      return String(dumped.message);
    }
    return JSON.stringify(dumped);
  } catch {
    return 'Unknown error';
  }
}

process.on('message', async (msg) => {
  const { source, input, memoryLimit, timeoutMs } = msg;
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  vm.runtime.setMemoryLimit(memoryLimit);

  // Best-effort interrupt handler (may not fire in all WASM variants)
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;
  let interrupted = false;
  vm.runtime.setInterruptHandler(() => {
    if (Date.now() > deadline) { interrupted = true; return true; }
    return false;
  });

  const logs = [];
  try {
    // Inject console.log
    const consoleHandle = vm.newObject();
    const logFn = vm.newFunction('log', (...args) => {
      const parts = args.map(arg => {
        const dumped = vm.dump(arg);
        return typeof dumped === 'string' ? dumped : JSON.stringify(dumped);
      });
      logs.push(parts.join(' '));
    });
    vm.setProp(consoleHandle, 'log', logFn);
    vm.setProp(vm.global, 'console', consoleHandle);
    logFn.dispose();
    consoleHandle.dispose();

    // Inject input
    const inputHandle = vm.newObject();
    for (const [key, value] of Object.entries(input)) {
      const valHandle = jsValueToHandle(vm, value);
      vm.setProp(inputHandle, key, valHandle);
      valHandle.dispose();
    }
    vm.setProp(vm.global, 'input', inputHandle);
    inputHandle.dispose();

    // Try unwrapped first (handles expressions and self-invoking functions).
    // On syntax error (e.g. bare `return`), retry wrapped in an IIFE.
    let result = vm.evalCode(source);
    if (result.error) {
      const errorMsg = stringifyHandle(vm, result.error);
      result.error.dispose();
      if (/return not in a function/i.test(errorMsg)) {
        const wrapped = `(function(){\n${source}\n})()`;
        result = vm.evalCode(wrapped);
      }
      if (result.error) {
        const errorMsg2 = stringifyHandle(vm, result.error);
        result.error.dispose();
        // If interrupt handler fired, always report as timeout
        if (interrupted) {
          process.send({ output: { error: `Code execution timed out after ${timeoutMs}ms`, logs, result: null }, port: 'error' });
        } else {
          process.send({ output: { error: errorMsg2, logs, result: null }, port: 'error' });
        }
        vm.dispose();
        process.exit(0);
        return;
      }
    }

    const output = vm.dump(result.value);
    result.value.dispose();

    let port = 'main';
    let finalOutput;
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const obj = output;
      if ('port' in obj) {
        port = String(obj.port || 'main');
        finalOutput = obj.data ?? output;
      } else {
        finalOutput = { ...output, logs };
      }
    } else {
      finalOutput = { result: output, logs };
    }

    process.send({ output: finalOutput, port });
  } catch (err) {
    const msg2 = err instanceof Error ? err.message : String(err);
    if (msg2.includes('interrupt') || msg2.includes('timeout') || msg2.includes('time')) {
      process.send({ output: { error: `Code execution timed out after ${timeoutMs}ms`, logs, result: null }, port: 'error' });
    } else {
      process.send({ output: { error: msg2, logs, result: null }, port: 'error' });
    }
  } finally {
    vm.dispose();
    process.exit(0);
  }
});
