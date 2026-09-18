# eWe — Phase 2: Execution Engine Report

Branch: `wt/t_phase2-engine` · Base: `9c538162089` (wt/t_379a0c27, Phase 1) · Workspace: `/usr/local/lib/hermes-agent/.worktrees/t_79c4b6d0/ewe`

## Scope delivered (SPEC §20 Phase 2 only)

- **Execution engine** (`src/engine/`): `graph.ts` validates + orders the graph (single trigger required, single input per node, cycle rejection); `engine.ts` executes along connections, passes node outputs forward, aborts on stop, persists every state transition; `store.ts` atomic JSON persistence; `executors.ts` + `http.ts` node handlers. Engine is independent of the UI — it runs headless via API.
- **Nodes**: Manual Trigger (start), Set (field assignment, preserves incoming fields), IF (compares one top-level field, `true`/`false` output ports), HTTP Request (GET/POST/PUT/PATCH/DELETE, headers, query params, JSON and raw body, timeout, JSON response parsing, request only when executed). No expressions (Phase 3), no Code/Switch/Merge/Loop (Phase 5), no credentials.
- **States**: node `waiting/running/success/error/skipped/cancelled`; execution `running/success/error/cancelled`. Record: `executionId, workflowId, startedAt, finishedAt, status, nodeExecutions[]` (per-node input/output/status/duration/timestamps/error).
- **API** (loopback-only, unchanged bind): `POST /api/workflows/:id/executions` (202), `GET …/executions` (history), `GET …/executions/:eid`, `POST …/executions/:eid/cancel`. History at `data/workflows.json.executions.json` survives restarts; executions interrupted by a backend crash are marked cancelled on startup and never replayed (idempotency-safe).
- **UI**: Run button (requires a Manual Trigger), Stop button while running, per-node status text/border during and after execution, `Execution success/error/cancelled` result indicator, banner replaced with accurate messaging. Execution **history browsing is NOT included** (Phase 4 scope).

## Commands and exit codes (evidence in `ewe/evidence/phase2/`)

| Gate | Command | Exit | Evidence |
|---|---|---|---|
| Unit tests | `npm test` | 0 | `final-unit.log` (3 files, 10 tests) |
| Build | `npm run build` | 0 | `final-build.log` |
| Browser E2E | `npm run test:e2e` | 0 | `final-e2e.log` (2 scenarios, zero console errors) |

TDD receipts: `01-red.log`→`01-green.log` … `09-red.log`→`09-green.log` — every new behavior was first watched failing (`404` before the execution API existed, wrong data flow, unknown node type, no real request, no timeout handling, no cancel endpoint, `'running'` after crash) then green.

## Acceptance mapping

1. **Failing-first per behavior** — red logs 01–09 above.
2. **4-node workflow via API** — `four-node.json` (Manual Trigger → Set → IF → HTTP Request, real requests recorded for GET/POST/PUT/PATCH/DELETE, per-node input/output/status/duration). Unit test `executes a four-node API graph…`.
3. **HTTP against real loopback server** — ephemeral `node:http` server on 127.0.0.1; status/body/headers asserted; timeout path covered (`hanging` server, 100 ms timeout → node error `HTTP request timed out`). Real `fetch`, no mocks.
4. **History survives restart** — `restart.json` records old PID vs new PID with byte-identical history restored.
5. **Stop/cancel** — `cancel.json`: active HTTP request aborted, node `cancelled`, remaining nodes `cancelled`, execution `cancelled`; a second concurrent run unaffected; cancelling a finished run is idempotent.
6. **Browser E2E** — `tests/browser/execution.spec.ts`: Run → nodes show `running` → release a held server response → `success` → `Execution success`; Stop → `cancelled`; zero console errors (asserted in-test).
7. **Phase 1 regression** — Phase 1 unit test and editor E2E pass unchanged except the banner assertion the task required replacing (`Execution is not implemented` → accurate messaging).
8. **Docs** — this file + `README.md` updated; commit hash below.

## Limitations (honest)

- IF compares a literal string only (equals) — expression system is Phase 3.
- Single-input graphs only: multi-input fan-in is rejected (`Multiple inputs require Merge (not supported)`); loops are rejected.
- One execution per workflow at a time from the UI (`start` replaces the polled execution); concurrent executions are supported and isolated at the API level.
- Cancel of an unknown/finished execution id returns the stored record (idempotent), not 404.
- Execution history is a flat list per workflow — pagination and an inspector UI are later phases.
- No WebSocket/SSE: the UI polls the active execution every 500 ms; realtime transport is Phase 4.
