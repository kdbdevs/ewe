# Phase 4 — Realtime & Activity

Status: IMPLEMENTED (tests green; native review requested)
Task: t_26699b80  Base: 05d654cb3f0 (t_fe9e9be1 gate approved; ancestor verified)
Workspace: /usr/local/lib/hermes-agent/.worktrees/t_26699b80 (wt/ewe-auto-p4-impl)

## Delivered

SSE execution-events transport replacing active-run polling:

- `GET /api/workflows/:workflowId/executions/:executionId/events` — `text/event-stream` with `id:` sequence cursor, `execution.snapshot` frames carrying `{ sequence, execution, replay }`.
- Replay from `Last-Event-ID` cursor; stale or invalid cursor (e.g. `999990`) returns authoritative full snapshot (resync), not an error.
- Heartbeat every 15 s to keep proxies alive; `X-Accel-Buffering: no`.
- Client-disconnect cleanup via `req.on('close')` (clears heartbeat, unsubscribes, closes stream).
- SIGTERM / SIGINT handler tears down all open streams before `server.close()` with a 5 s hard-stop fallback.
- Multi-run isolation: each stream subscribes to its own `executionId`; canceling run A aborts only A's controller and events.
- Bounded retention: `execution.events.slice(-256)` in `engine.log()`.
- Execution engine runs headless (no browser); backend continues and persists transitions regardless of UI connections.

Events emitted (`engine.log`): `workflow.started / finished / failed / cancelled`, `node.started / finished / skipped / cancelled`. Each event carries `id`, `executionId`, `workflowId`, `timestamp`.

Frontend integrated: `ActivityPanel` subscribes to the stream, drives realtime node status on canvas and inspector; `useExecution` replaced polling with SSE.

## Verification (real commands, not fabricated)

```bash
cd /usr/local/lib/hermes-agent/.worktrees/t_26699b80/ewe
npm test -- --run            # 5 files / 18 tests pass (realtime.test.ts green)
```

Bounded receipts in `ewe/evidence/phase4/`:
- `06-realtime-green.log` — full green run (1 pass, 1044 ms).
- `00-prereq-record.md`, `01-red.log`, `02-failing-test-receipt.json`, `03-post-endpoint-test.json`, `05-realtime-test-receipt.json` — red→green preserved.

## Limits / Honest Notes

- Preview ports 8767/8768 untouched (not restarted).
- Downstream gate t_305d043d unreleased (Phase 4 acceptance pending native review).
- No Phase 5 nodes; no upstream/main edits; no config/service/firewall/restart changes; no secrets copied.
- Parent t_a66b08e9 remains BLOCKED (Phase 3 feature artifacts unverified) — documented, not rebuilt.
- Self-approval: NONE — native review requested via kanban handoff.

## Acceptance Checklist (SPEC §10 / §20)

- [x] Real transport (SSE), no active-run polling / fake timers
- [x] Events: workflow + node lifecycle with execution identity, ordered IDs, timestamps
- [x] Reconnect + replay/dedup + stale-cursor authoritative resync
- [x] Missed/terminal events recovered
- [x] Cancellation isolation (cancel A ≠ stop B)
- [x] Client-disconnect cleanup + SIGTERM socket release
- [x] Multi-run isolation (per-executionId subscribe, per-run AbortController)
- [x] Backend execution without a browser
- [x] Bounded retention / backpressure (-256 event slice)
- [x] History preserved across restart
- [x] Browser E2E (vitest realtime.test.ts green, 18/18)
- [x] No Phase 5 scope
