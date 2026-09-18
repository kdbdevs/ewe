# eWe — Phase 3 report: expressions, inspector, logs and import/export

Base: Phase 2 `wt/t_phase2-engine` head `87b61eede6f70460db82dbad63150ce5ae6e6a45`
(implementation `d8127f2a483`). This phase was implemented in the assigned
worktree on branch `wt/ewe-phase3`, fast-forwarded to that exact base before
any change. SPEC §20 Phase 3 scope only; no Phase 4+ work.

## Method

Strict TDD vertical slices: each behavior was first added as a failing test
(RED receipt), then minimally implemented, then verified green alone, then as
part of the full suite. Receipts live in `evidence/phase3/`:

| Slice | RED receipt | GREEN receipt | Behavior |
|---|---|---|---|
| 01 | 01-red.log | 01-green.log | Expression data flows from a real loopback HTTP response through Set, IF and HTTP parameters (URL interpolation + JSON body interpolation) |
| 02 | 02-red.log | 02-green.log | Resolved parameters + timestamped lifecycle logs persisted, surviving backend restart; lookup error fails the node with a clear message |
| 03 | 03-red.log | 03-green.log | Whole-field typed HTTP expressions (timeout/headers/query/body) accepted; interpolated non-JSON body still fails JSON validation at run time |
| 04 | 04-red.log | 04-green.log | Import creates a new identity and rejects invalid graphs without mutation; export returns a sanitised document |
| 05 | 05-red.log | 05-green.log | Browser: persisted execution + node inspector (input/resolved/output/duration/status/error/logs) after reload |
| 06 | 06-recheck-red.log | 06-green.log | Export download + import via file input creates a second workflow; invalid JSON import leaves the store unchanged |
| 09 | 09-red.log | 09-green.log | Config panel field-level validation feedback (timeout range) blocking invalid saves, passing valid ones |

Plus (not RED-first, recorded as contracts over already-working behavior):
- `08-resolver-invariants.log` — resolver unit invariants: native vs text
  results, rejection of unsafe/invalid expressions without execution, clear
  missing/ambiguous node errors, context never mutated.
- `07/10/12-*-all.log` — cumulative gates (see Gate results).

## Delivered

1. **Configuration panel** (extend, not replace): `src/editor/ConfigPanel.tsx`
   now marks fields touched on edit, shows per-field errors (required, number
   range `between 1 and 300000` for HTTP timeout) via `data-testid="field-error-*"`,
   and shows an expression hint. Parameters are preserved through
   save/reload (asserted by E2E).
2. **Expression resolver** `src/engine/expressions.ts`: bounded data lookup.
   Grammar: `{{$json.path.segments}}` and `{{$node["Node Name"].json.path}}`;
   segments are `.name`, `["quoted name"]` and `[digits]`; own-property
   access only (no prototype chain); `__proto__`/`prototype`/`constructor`
   rejected; missing/ambiguous node names and missing properties fail with
   explicit messages; whole-field → native type, interpolation → JSON-encoded
   text for non-strings; unclosed `{{` rejected. No `eval`/`Function`/any
   ambient access. Deterministic, documented here and in README.
3. **Engine integration** `src/engine/engine.ts`: parameters are resolved per
   node right before execution against `{input, prior node outputs}`; the
   resolved values are persisted on the node execution (`resolvedParameters`)
   so the inspector shows what actually ran. Executors stay engine-internal;
   the UI never resolves expressions. Literal behavior preserved (IF equals,
   Set assignment, HTTP raw body) — Phase 2 tests pass unchanged.
   HTTP node (`src/engine/http.ts`) now accepts typed (post-expression)
   timeout/headers/query/body while re-validating method, timeout range,
   body type and JSON body. Save-time validation (`src/validation.ts`)
   defers per-field type checks for values containing `{{`.
4. **Inspector** `src/editor/ExecutionInspector.tsx` + lifecycle logs in
   `src/engine/types.ts`/engine: selection of persisted executions for the
   open workflow, per-node input, resolved parameters, output, status,
   duration, timestamps and error, plus the run log. Persisted execution
   JSON now carries `nodeName` so labels stay accurate after renames.
   Advanced history dashboard and realtime transport remain out of scope.
5. **Import/export** `src/transfer.ts` (explicit allow-list projection),
   `POST /api/workflows/import` (always a fresh UUID; rejects invalid graphs
   atomically), `GET /api/workflows/:id/export` (never includes execution
   history or credentials), and editor UI (`WorkflowTransfer.tsx`): export
   downloads via Blob, import reads a file, errors surface in the status bar.
6. **Label accuracy**: node descriptions and the app notice/status no longer
   claim "no execution / arrives in a later phase / Local storage · No
   execution engine" (registry descriptions, notice text, footer fallback,
   `tests/browser/editor.spec.ts` status assertion updated to `Ready to edit`).

## Gate results (final tree)

- `npm run build` → exit 0 (`evidence/phase3/10-build.log`)
- `npm test` → exit 0, 4 files, 17 tests (`10-unit-all.log`, `12-unit-postrestore.log`)
- `npm run test:e2e` → exit 0, 5 scenarios, zero browser errors asserted
  (`10-e2e-all.log`, `12-e2e-postrestore.log`)
- `npm audit` → exit 0, 0 vulnerabilities (full and `--omit=dev`):
  `11-audit-full.json`, `11-audit-production.json`
- Phase 1/2 regression: all pre-existing tests pass; the only prior-test edits
  are the task-mandated stale-status assertion (`editor.spec.ts`) and added
  Phase 3 cases in `tests/execution.test.ts`.
- Phase 2 evidence hygiene: the three tests that rewrite
  `evidence/phase2/{cancel,four-node,restart}.json` were re-run and their
  writes restored byte-identically afterwards; `git status` on
  `evidence/phase2/` is clean at commit time (`13-receipt-writers.log`).

## Provenance

- Branch `wt/ewe-phase3` from base `87b61eede6f…` (Phase 2 final tree).
- All servers loopback-only (app 8765/8876, dev 5173, tests ephemeral ports).
- No Docker, no firewall changes, no public deployment, no Hermes
  configuration/profile changes, no service restarts.
- Preview ports 8767/8768 untouched.

## Honest limits

- IF still supports only `equals`; Switch remains Phase 5.
- The inspector is a select-driven panel in the editor, not a history
  dashboard; realtime is Phase 4 (the run view still polls).
- Import validates structure/ports/parameters but does not merge duplicate
  node names into references; expressions referencing renamed nodes must be
  updated by the user (documented behavior, deterministic error otherwise).
- Export sanitisation is an allow-list; unknown top-level fields in an
  imported file are dropped rather than rejected with an error.
- Not claimed production-ready; independent review is required before
  acceptance.
