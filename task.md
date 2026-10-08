# TaskForge Phase Tracker

This file is the execution status source. Statuses describe verified work only. Planned checks are not passing evidence until run.

## Phases

### Phase 0 — Baseline and Windows setup — COMPLETE

**Goal:** Review planning documents, repository setup, local development tools and skills.

**Acceptance checks:** Requirements and unresolved proposals are visible; local Git baseline is recorded. Inspect Node.js, npm, Git, Codex, skills and agent instructions without exposing secrets. No runtime implementation.

**Evidence:** Inspection and document alignment are complete. Planning baseline commit `45c949e` exists. The origin URL was verified as `https://github.com/shazzark/taskforge`. Environment and skill findings are recorded in `local-codex-setup.md`. No runtime implementation was done.

### Phase 1 — CLI, configuration and MongoDB — IN PROGRESS

**Goal:** Build command/chat shell, validated settings, MongoDB connection, doctor checks and deterministic setup errors.

**Acceptance checks:** Clean Windows setup; redacted diagnostics; deterministic failure when the database is unavailable. Run typecheck, CLI smoke tests and disposable database integration checks. No browser or mutation tools.

#### Phase 1.1 — TypeScript/package foundation and CLI help — COMPLETE

**Acceptance:** Establish the TypeScript project, package metadata, pinned dependencies and lockfile. The project builds and typechecks; CLI help exits successfully without requiring a database or model.

**Checks and evidence:** `npm ci`, `npm run typecheck`, and `npm run build` passed on Node.js v22.13.0. Built CLI help and version commands passed; CLI version `0.1.0` matches `package.json`. An invalid argument returned exit code 1 with a clear error and did not echo the supplied argument text. Packed the project, installed it in a temporary Windows consumer, and verified the generated `taskforge.cmd` shim ran and returned the matching version. `git diff --check` passed. The read-only review-agent review found no remaining defects after fixes.

#### Phase 1.2 — Validated configuration and redacted diagnostics — NOT STARTED

**Acceptance:** Configuration is runtime-validated; missing and malformed values produce clear setup errors; diagnostics redact credentials and connection strings.

**Checks:** Automated cases for valid, missing and malformed configuration; inspect captured diagnostics to confirm secret values do not appear; run the configuration/doctor CLI smoke path.

#### Phase 1.3 — MongoDB connection and minimal persistence — NOT STARTED

**Acceptance:** Connect to a configured MongoDB instance and perform the agreed minimal persistence operation. An unavailable database fails deterministically without reporting success or proceeding as if persistence worked.

**Checks:** Integration test against a disposable MongoDB database for connection and persistence; repeat with the database unavailable and verify the documented error and exit status. Do not claim real-provider verification from mocks.

#### Phase 1.4 — Doctor checks, Windows smoke tests and integrated verification — NOT STARTED

**Acceptance:** Doctor reports required setup state with redacted output. The documented Windows setup and CLI paths work together with the configured database; setup and database failures remain clear and deterministic.

**Checks:** Clean Windows setup/build, CLI help/config/doctor smoke checks, integration suite with a disposable available database, and failure-path verification with the database unavailable. Record actual commands and results before marking Phase 1 complete.

### Phase 2 — Providers and agent loop — NOT STARTED

**Goal:** Add local and free-tier provider adapters, validated tool calls, run budgets and cancellation.

**Acceptance checks:** A real model completes a small read-only tool task; unsupported tool calling and provider quota errors are reported honestly. Verify mock contract/error cases and real provider runs. No arbitrary shell access.

### Phase 3 — Permissions, events and resume — NOT STARTED

**Goal:** Add approved roots, secret denials, batch previews, bounded events/checkpoints and state revalidation.

**Acceptance checks:** Escape, changed-target and denial checks pass; cancel/resume and database-failure behavior are verified. No new task family until boundary checks pass.

### Phase 4 — Files, data and report adapters — NOT STARTED

**Goal:** Implement inventory, deterministic CSV calculations, approved organization, input parsers and requested outputs.

**Acceptance checks:** Fixture counts/totals and file integrity match; PDF renders; unsupported formats fail clearly. Verify paths, format fixtures, malformed input and artifact hashes.

### Phase 5 — Software workflow — NOT STARTED

**Goal:** Support repository inspection, seeded bug investigation, approved patches, reviewed command execution and local diffs.

**Acceptance checks:** Reproduce and correct a seeded failure, run relevant tests, and retain secret/path controls. Verify in a disposable repository. No Git push or deployment from the workflow.

### Phase 6 — Browser, research and design observations — NOT STARTED

**Goal:** Add Playwright journeys, network/console/link checks, passive security observations, responsive/accessibility observations, design reporting and sourced comparisons.

**Acceptance checks:** Detect seeded failures; list exact checks run; include source references and label inferred observations. Verify against a fixture site and an approved real site. Active security and sensitive form actions remain separately gated.

### Phase 7 — Connections, scheduling and specialist agents — NOT STARTED

**Goal:** Add GitHub read/drafts, local schedules, email drafts and bounded delegation.

**Acceptance checks:** Verify mocked and authorized real read integrations, no accidental sending/publishing, shared budgets, repeat-run suppression and worker review. Clarify integration inputs. No unrestricted third-party executable plugins.

### Phase 8 — Release gate — NOT STARTED

**Goal:** Complete a clean Windows consumer trial, workflow documentation, contribution guide, license/dependency review and distribution checks.

**Acceptance checks:** Another developer runs documented scenarios and all required checks are recorded. Release by clone first. npm publication requires tarball consumer verification and explicit publication authorization; check package naming before release.

## Recovery

- **Current phase/subphase:** Phase 1 is IN PROGRESS; Phase 1.1 is COMPLETE; Phase 1.2 is next and NOT STARTED.
- **Last completed work:** Phase 0 planning and Windows setup inspection (`45c949e`); Phase 1.1 TypeScript/package foundation and help/version CLI.
- **Checks performed:** `git status --short --branch`; `git log -5 --oneline --decorate`; required planning documents read; `npm ci`; `npm run typecheck`; `npm run build`; built CLI help/version; package-version parity; invalid-argument message/exit behavior and no argument echo; packed Windows consumer install and `taskforge.cmd` invocation; independent review-agent review; `git diff --check`. No chat, model, database, task execution or other later-phase behavior was implemented or tested.
- **Blockers:** MongoDB server command is unavailable and its Windows service was stopped during inspection; MongoDB version/setup must be selected before Phase 1.3. No blocker for Phase 1.2. The local `build-in-verified-phases` skill is unavailable; installed `engineering-workflow` and `review-agent` skills were applied.
- **Exact next action:** Begin Phase 1.2 (validated configuration and redacted diagnostics) only when that subphase is authorized.
