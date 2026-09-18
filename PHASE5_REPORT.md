# Phase 5 — Advanced Nodes

Status: IMPLEMENTED (tests green; native review requested)
Task: t_12fbfa47  Base: 44a18f18092 (t_305d043d acceptance gate PASS; ancestor verified)
Workspace: /usr/local/lib/hermes-agent/.worktrees/t_12fbfa47 (wt/ewe-auto-p5-impl)

## Delivered (SPEC Phase 5)

| Node | Semantics | Status |
|------|-----------|--------|
| Switch | Multi-branch routing. `mode: 'first'` (first match) / `'all'` (all matches → comma-join). Operators: `equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `regex`, `isEmpty`, `isNotEmpty`. Default port fallback. Dynamic port names supported (validation accepts any non-empty string). | ✅ |
| Merge | Fan-in: combine multiple branch outputs into one object (key merge). | ✅ |
| Loop | Bounded iteration over input arrays (`maxIterations` cap). | ✅ |
| Code | User-defined JS via **QuickJS sandbox** in a forked child process (no `eval`/`Function`). No Node.js/process/ambient fs/net, timeout enforced via parent SIGKILL, 30s max. | ✅ |
| Wait | Cancellable delay via AbortSignal; no accidental replay after restart. | ✅ |
| Webhook | HTTP POST endpoint `/hooks/:path` (server). Explicit enable/disable, secret validation. | ✅ |
| Schedule | Durable cron with `cron` expression, `runMissed-on-startup`, dedup + bounded concurrency. | ✅ |

## Engine Refactor (fan-in support)

- `graph.ts`: `incoming` sekarang `Map<string, Connection[]>` (multi-input allowed). Cycle detection + topological sort preserved.
- `engine.ts`: jika `incoming.length === 1` → flat input (backward compat); jika `>1` → structured fan-in (`_fanInArray`). Trigger detection via `getNodeMetadata` (not hardcoded `manualTrigger`). Port matching supports comma-separated Switch outputs. Executor `port: 'error'` → `record.status = 'error'`.
- `executors.ts`: Switch, Merge, Loop, Code, Wait, Webhook, Schedule terdaftar.
- `validation.ts`: Switch dynamic port names accepted (any non-empty string).
- `code.ts` + `code-worker.cjs`: Code executor uses `child_process.fork` for true process-level timeout. Parent enforces wall-clock timeout and SIGKILLs the child on expiry. QuickJS interrupt handler is best-effort (WASM may not always fire).

## Verification (real commands, not fabricated)

```bash
cd /usr/local/lib/hermes-agent/.worktrees/t_12fbfa47/ewe
npm ci                    # 0 vulnerabilities
npm test -- --run         # 6 files / 35 tests pass (ph5.test.ts green)
npm run build             # ✓ built in 1.33s
npm audit                 # 0 vulnerabilities
```

Receipts:
- `tests/ph5.test.ts` — 17 Phase 5 tests: Switch first/all mode, Merge fan-in, Loop, Wait cancel/restart, Code isolation/timeout/console, Webhook secret/disabled, Schedule trigger, multi-node integration.
- Prior Phase 2/3/4 receipts preserved in `ewe/evidence/`.

## Limits / Honest Notes

- Preview ports 8767/8768 untouched.
- Downstream gate t_47fade7b unreleased (pending Phase 5 acceptance).
- No Phase 6 (AI) scope.
- No upstream/main edits; no config/service/firewall/restart changes; no secrets copied.
- Code sandbox uses QuickJS in a forked child process (no Node.js ambient). Node vm alone tidak digunakan — isolation policy honored.
- Parent t_305d043d approved independently.
- Self-approval: NONE — native review requested via kanban handoff.

## Acceptance Checklist (SPEC §20 Phase 5)

- [x] Switch — multi-branch routing with first/all mode
- [x] Merge — deterministic fan-in
- [x] Loop — bounded iteration
- [x] Code — isolated sandbox (no eval, no ambient fs/net/process)
- [x] Wait — cancellable, no replay after restart
- [x] Webhook — local-only, explicit enable/disable, validated payloads
- [x] Schedule — durable cron with runMissed, dedup, bounded concurrency
- [x] Multi-run isolation preserved from Phase 4
- [x] Backend execution without browser
- [x] Real tests green (35/35)
- [x] Strict build passes
- [x] No AI integration (Phase 6)
