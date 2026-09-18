# eWe Phase 1 — acceptance evidence

Task t_c4eb9ea7, 2026-09-17 UTC.
Workspace: /usr/local/lib/hermes-agent/.worktrees/t_c4eb9ea7/ewe
Branch: wt/t_c4eb9ea7
HEAD: b5a04c5339e; implementation commit: 7ac81cb7add8ed469cb4e4fec839b6e7aa0ad4e3.
The dependency reconciliation and refreshed report/evidence are UNCOMMITTED changes on that HEAD. No push.

## Result and boundary

Phase 1 functional and dependency-audit gates pass on this candidate. This is Foundation only, NOT the full platform or production readiness. All 697 lines of /root/.hermes/workspace/ewe-repair/SPEC.md were read. Later phases remain parked; no execution work or public deployment was done. No Docker, firewall modifications, Hermes configuration changes or Hermes service restarts.

Actual architecture: React/React Flow, Node HTTP API, atomic JSON-file persistence. Upstream t_1117e522's NestJS/PostgreSQL/Redis/JWT proposal is not the delivered Phase 1 stack and is not being represented as implemented.

## Verified functionality

- Dark eWe shell, workflow list/create/rename and explicit save.
- Workflow JSON model and metadata registry: Manual Trigger, Set, HTTP Request. Configuration-only nodes; no requests are executed.
- Canvas node add/move/select/delete, output-to-input handle connections, disconnect, zoom/pan/fit view and schema-driven configuration.
- Three configured nodes and two connections survive save/browser reload unchanged, including positions, parameters and viewport.
- Node deletion removes incident connections; zero browser console/page errors are asserted.
- Real loopback API CRUD. Nine invalid graphs are rejected without mutation. Real process restart restores identical saved document including timestamps. Overlapping PUT/DELETE test passes.

## Reconciliation of audit disagreement

Original PHASE1_REPORT.md:33 at b5a04c5339e claimed a clean audit without a corresponding raw receipt. Independent verifier t_0969aae9 and this gate reproduced full audit exit 1: one moderate, one high, one critical package finding. Production-only audit exited 0. An early gate chat message incorrectly counted nested advisory entries as package totals; these three package totals are the correct baseline.

Patched Vite 6.4.1 to 6.4.3. Vitest 3.2.4 to 3.2.7 removed critical findings but left two moderate findings (Vitest/@vitest/mocker, GHSA-82fw-gwwq-j7x9). Subsequently upgraded Vitest to 4.1.11, the first release outside the reported affected range, after checking its registry engines and Vite peer compatibility. Regenerated package-lock.json. No application source code changed. No exploit reproduction was performed.

FINAL full audit and production-only audit BOTH exit 0 with zero findings. This replaces the intermediate residual-risk recommendation; no claim of exhaustive security assurance is made.

## Final observed execution receipts

All commands below run inside this report's workspace; actual exit statuses observed without output pipelines.

| Command | Exit | Evidence/result |
|---|---|---|
| npm install --workspaces=false | 0 | updated lockfile, audited 81 packages, zero findings |
| npm ci --ignore-scripts --workspaces=false | 0 | fresh locked install: 80 packages installed, zero findings |
| node scripts/verify.mjs | 0 | evidence/verification.json |
| npm test (inside verify) | 0 | Vitest 4.1.11: 2 files, 2 tests; evidence/test.log |
| npm run build (inside verify) | 0 | strict TypeScript, Vite 6.4.3, 193 modules; evidence/build.log |
| npm run test:e2e (inside verify) | 0 | 1 real Chrome scenario, 4.6s; evidence/test-e2e.log |
| npm audit --json | 0 | evidence/audit-full.json: vulnerabilities empty, total 0 |
| npm audit --omit=dev --json | 0 | evidence/audit-production.json: vulnerabilities empty, total 0 |
| npm test -- --reporter=verbose --silent=false | 0 | 2 tests; evidence/test-verbose.log |

Latest explicit restart receipt: PID 325379 stopped, PID 325393 restored identical 3-node/2-edge graph. See evidence/test-verbose.log:9. This proves ordinary application-process restart, not power-loss durability or multi-process safety.

Browser artifacts: evidence/restored-editor.png, evidence/saved-graph.json, evidence/browser-report/index.html. Chrome uses real loopback backend port 8876, not mocks. The screenshot from the preceding equivalent gate run was visually inspected: three connected nodes, readable POST configuration, Saved status, dark eWe shell, explicit no-execution notice. No persistent server is intentionally left running.

Warnings: React Flow's use-client directive is ignored by Vite; Node 26 emits module.register deprecation warnings. Build and browser error assertions pass despite those process warnings.

Independent upstream verification report: /usr/local/lib/hermes-agent/.worktrees/t_0969aae9/PHASE1_VERIFICATION.md. It contains two browser scenarios on ORIGINAL dependency versions, including its additional invalid-save/discard scenario. This gate reran the upstream single Chrome scenario on FINAL dependency versions; it does not claim that verifier-only extra scenario was rerun.

## Limitations

No execution/run/stop/history, auth or credential storage, realtime, AI/Hermes integration, import/export, undo/redo, workflow duplicate/delete UI. Workflow deletion is API-only. Palette adds by click, not drag from library. JSON storage is single-process/single-user; no backup/versioning, draft autosave or production database guarantees. Mobile, other browsers and broad accessibility were not assessed. Tests require system Chrome. Dev tools are needed for the current tsx-based start script even though npm classifies them as devDependencies.

## Local run

    cd /usr/local/lib/hermes-agent/.worktrees/t_c4eb9ea7/ewe
    npm ci --ignore-scripts --workspaces=false
    npm run build
    npm start

Open http://127.0.0.1:8765 on the same host. Default persistence: this directory's data/workflows.json. Stop with Ctrl-C. Optional explicit path:

    npm start -- --port 8765 --data /absolute/path/workflows.json

Keep the unauthenticated app on loopback. No firewall changes or public exposure are required. Recheck with npm test, npm run build, npm run test:e2e, and npm audit --json. scripts/verify.mjs does not itself run audit; audit receipts were captured separately.
