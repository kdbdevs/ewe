# eWe

Visual workflow automation editor with a headless execution engine.
Phase 3: executions are inspectable, parameters accept expressions, and
workflows can be imported/exported as JSON.

## Quickstart

```bash
npm install --workspaces=false
npm run build           # typecheck + bundle (dist/)
npm start               # http://127.0.0.1:8765 (serves dist/ + /api)
```

For live-reload development run `npm start` plus `npm run dev`, and open
http://127.0.0.1:5173 (the dev server proxies /api to port 8765).

## Tests

```bash
npm test          # vitest: registry, resolver invariants, API CRUD, execution engine (expressions, logs, import/export, IF, HTTP, timeout, cancel, crash recovery)
npm run test:e2e  # Playwright in system Chrome: editor flow, run/stop, inspector, validation, import/export on http://127.0.0.1:8876
npm start -- --port 0 --data /tmp/ewe.json   # custom port / storage path
```

## What works (Phase 3)

Everything from Phase 2 (build/connect/execute/persist), plus:

- **Expressions** in string parameters: `{{$json.field.path}}` for the
  previous node's output and `{{$node["Node name"].json.field.path}}` for any
  earlier node in the same execution. Nested own-property paths only; a
  whole-field expression yields the native type (object/number/boolean),
  interpolation inside larger text yields text. Missing/ambiguous node
  names, missing own properties and `__proto__`/`prototype`/`constructor`
  access fail the node with a clear error — no `eval`, `Function`, or any
  code execution (see `src/engine/expressions.ts`, bounded data lookup).
- **Resolved parameters + logs persisted**: each node execution records the
  post-resolution parameters, and each run records timestamped lifecycle
  events (workflow/node started, success, error, skipped, cancelled).
- **Inspector**: pick any persisted execution and node to see input, resolved
  parameters, output, status, duration, timestamps and error, plus the run
  log — real history, including after a reload.
- **Import/export**: export downloads a sanitised workflow JSON (never
  execution history or credentials); import validates atomically and always
  creates a new workflow identity. API: `POST /api/workflows/import`,
  `GET /api/workflows/:id/export`.
- **Config panel**: field-level validation feedback (required, number ranges)
  and an expression hint; parameters survive save/reload.
- Whole-field typed expressions work for HTTP timeout/headers/query/body;
  interpolated body JSON still goes through JSON validation at run time.

## Current limitations

- No credentials, no auth — later phases.
- IF compares one field (expressions allowed) with equals only.
- Fan-in (multiple inputs) and cycles are rejected — Merge/Loop are Phase 5.
- No realtime (WebSocket/SSE): the UI polls the active run; Phase 4 work.
- Advanced history dashboard/realtime activity: not in Phase 3 scope.
- The API accepts any localhost request; bind it to loopback.
- Deleting the data file removes all workflows; there is no backup/versioning.

## Architecture

- `src/model.ts` — workflow JSON model
- `src/nodes/registry.ts` — node metadata registry (typed fields, ports)
- `src/validation.ts` — graph validation (API rejects invalid saves)
- `src/transfer.ts` — import/export projection (sanitised workflow document)
- `src/engine/` — `graph.ts` (validate + topological order), `engine.ts`
  (execution + cancel + crash recovery + lifecycle logs), `executors.ts`,
  `expressions.ts` (bounded `{{$json}}`/`{{$node}}` resolver),
  `http.ts` (real HTTP node), `store.ts` (atomic execution-history
  persistence), `types.ts` (node/execution states)
- `src/api/server.ts` — Node HTTP API + static server (loopback)
- `src/api/store.ts` — atomic-file workflow store
- `src/App.tsx` + `src/editor/` — dark editor shell, canvas, config panel,
  run/stop + live node status, execution inspector, JSON import/export

Planned, not implemented: Switch/Merge/Loop/Code, credentials, realtime
activity, AI/Hermes nodes. See `PHASE3_REPORT.md`, `PHASE2_REPORT.md` and
`PHASE1_REPORT.md` for per-phase evidence.
