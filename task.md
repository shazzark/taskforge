# TaskForge Phase Tracker

This file is the execution status source. Statuses describe verified work only. Planned checks are not passing evidence until run.

## Phases

### Phase 0 — Baseline and Windows setup — COMPLETE

**Goal:** Review planning documents, repository setup, local development tools and skills.

**Acceptance checks:** Requirements and unresolved proposals are visible; local Git baseline is recorded. Inspect Node.js, npm, Git, Codex, skills and agent instructions without exposing secrets. No runtime implementation.

**Evidence:** Inspection and document alignment are complete. Planning baseline commit `45c949e` exists. The origin URL was verified as `https://github.com/shazzark/taskforge`. Environment and skill findings are recorded in `local-codex-setup.md`. No runtime implementation was done.

### Phase 1 — CLI, configuration and MongoDB — COMPLETE

**Goal:** Build the CLI command shell, validated settings, MongoDB connection, doctor checks and deterministic setup errors.

**Acceptance checks:** Clean Windows setup; redacted diagnostics; deterministic failure when the database is unavailable. Run typecheck, CLI smoke tests and disposable database integration checks. No browser or mutation tools.

#### Phase 1.1 — TypeScript/package foundation and CLI help — COMPLETE

**Acceptance:** Establish the TypeScript project, package metadata, pinned dependencies and lockfile. The project builds and typechecks; CLI help exits successfully without requiring a database or model.

**Checks and evidence:** `npm ci`, `npm run typecheck`, and `npm run build` passed on Node.js v22.13.0. Built CLI help and version commands passed; CLI version `0.1.0` matches `package.json`. An invalid argument returned exit code 1 with a clear error and did not echo the supplied argument text. Packed the project, installed it in a temporary Windows consumer, and verified the generated `taskforge.cmd` shim ran and returned the matching version. `git diff --check` passed. The read-only review-agent review found no remaining defects after fixes.

#### Phase 1.2 — Validated configuration and redacted diagnostics — COMPLETE

**Acceptance:** Configuration is runtime-validated; missing and malformed values produce clear setup errors; diagnostics redact credentials and connection strings.

**Checks and evidence:** `npm ci`, `npm run typecheck`, and `npm test` passed (8 tests). Cases cover valid and multi-host MongoDB URIs, missing values, invalid input shapes, malformed scheme/host/path/query escapes and ambiguous user-info delimiters, redacted summaries, and CLI behavior with missing, valid and malformed configuration. Missing configuration exits 2; CLI diagnostics omit the URI. Phase 1.2 does not connect to MongoDB; that is Phase 1.3. Independent review found no remaining issues; `git diff --check` passed.

#### Phase 1.3 — MongoDB connection and minimal persistence — COMPLETE

**Acceptance:** Connect to a configured MongoDB instance and perform the agreed minimal persistence operation. An unavailable database fails deterministically without reporting success or proceeding as if persistence worked.

**Checks and evidence:** `npm ci`, `npm run typecheck`, `npm run build`, and `npm test` passed. All 10 tests passed with no skips while connected to a fresh temporary MongoDB v8.2.0 process bound to `127.0.0.1:27018`, using a unique temporary data directory and per-test database. The integration verified connect/ping, summary insert/read, missing-record lookup, and malformed persisted-record rejection. The unavailable-database test verified a generic error without echoing the endpoint. URI validation requires an explicit database path so the default MongoDB database cannot be selected implicitly. Connection, persistence, and shutdown failures are normalized. The registered Windows MongoDB service was not started or modified; the temporary instance and data directory were stopped and removed. `git diff --check` passed.

#### Phase 1.4 — Doctor checks, Windows smoke tests and integrated verification — COMPLETE

**Acceptance:** Doctor reports required setup state with redacted output. The documented Windows setup and CLI paths work together with the configured database; setup and database failures remain clear and deterministic.

**Checks and evidence:** Clean `npm ci`, `npm run typecheck`, `npm run build`, and `npm test` passed on Windows. All 12 tests passed with no skips against a fresh disposable loopback MongoDB instance. Direct Windows CLI smoke checks passed for help, version, config summary, and doctor unavailable-server exit code 2/redaction. The integrated doctor test reported MongoDB available against the disposable instance, and missing/unavailable config paths remained deterministic. The package's `cli` npm script name conflicted with npm 11 command parsing, so it was removed; README commands invoke the built entry point with `node dist/cli.js`. No registered service was started, no existing connection value was reused, and no changes were pushed. `git diff --check` passed; independent review found no remaining findings.

### Phase 2 — Providers and agent loop — IN PROGRESS

**Goal:** Add interactive chat, local and free-tier provider adapters, validated tool calls, run budgets and cancellation.

**Acceptance checks:** A real model completes a small read-only tool task; unsupported tool calling and provider quota errors are reported honestly. Verify mock contract/error cases and real provider runs. No arbitrary shell access.

**Provider decision:** Recommend Groq with `openai/gpt-oss-20b` for the first online tool-call trial. Groq documents local tool calling for this model and an official Node.js/TypeScript SDK. Its published limits table lists 30 RPM, 1K RPD, 8K TPM and 200K TPD for this model, but these are published table values, not a guarantee of free-tier availability; the account's Free Plan limits must be checked in the console. Stay on the Free Plan and do not add billing. Groq says inference data is not retained by default, with temporary retention possible for reliability/abuse monitoring (up to 30 days); do not use real user or project data in the trial. Google Gemini is a viable tool-calling/TypeScript alternative, but Google states free-tier content may be used to improve products, so it is not the recommended first trial for this project.

#### Phase 2.1 — Configuration, adapters, bounded tool loop and chat — COMPLETE (online and mocked paths)

**Implemented:** Added ignored-root `.env` loading without overriding existing process variables; runtime validation for Groq and loopback-only Ollama configuration; a shared provider completion contract; the official Groq SDK adapter; an Ollama OpenAI-compatible adapter; cancellation propagation; bounded model/tool budgets; tool-name, argument and output checks; interactive chat with an online-transfer consent prompt; and a synthetic read-only `model-check` command. No arbitrary shell tools exist.

**Mock verification:** Groq request mapping, tool response normalization, auth/quota/invalid-response errors, Ollama request/response mapping, unsupported-tool and malformed-response behavior, loopback validation, tool-call validation, cancellation, duplicate tool rejection, action limits and request limits are covered by contract tests. `npm run typecheck` and `npm test` passed; 21 tests passed and the pre-existing MongoDB integration test was skipped because its dedicated `TASKFORGE_TEST_MONGODB_URI` was not supplied. `npm test` also ran the build.

**Live Groq evidence:** `node dist/cli.js model-check` completed with Groq `openai/gpt-oss-20b`, one synthetic read-only tool action and two model requests. No user/project data was sent. The first sandboxed network attempt was unavailable; the authorized elevated run succeeded. Provider credential values were never printed.

**Interactive chat smoke:** Launched `node dist/cli.js chat` in a TTY and declined the Groq transfer prompt. Chat exited before sending a request.

#### Phase 2.2 — Live Ollama evaluation — PENDING (owner-deferred until tonight)

The adapter is implemented and mocked contract tests pass. Ollama is not installed and its endpoint/model are absent. Do not install it or download a model before the owner’s stated time. At the local trial, use the planned `qwen3:4b-q4_K_M` candidate with a pinned 4K context; record load/response time and peak memory. Do not claim hardware fit until measured.

**MongoDB setup finding:** The MongoDB Windows service is running and a secret-free local `mongosh` ping returned `1`. The configured `TASKFORGE_MONGODB_URI` is present only in `.env` but fails the existing URI validator: it uses the SRV scheme and does not provide the explicit database path required by Phase 1. The URI value was not printed or changed. Owner must add/select an explicit database path in the ignored `.env`; until then `config`/`doctor` database validation is blocked. The Groq model check was separated from database loading and succeeded independently.

**Phase status:** Phase 2 remains IN PROGRESS; do not mark COMPLETE until Phase 2.2 live local-model evaluation and remaining integration checks pass. No provider switch or billing was enabled.

### Phase 3 — Permissions, events and resume — IN PROGRESS

**Goal:** Add approved roots, secret denials, batch previews, bounded events/checkpoints and state revalidation.

**Acceptance checks:** Escape, changed-target and denial checks pass; cancel/resume and database-failure behavior are verified. No new task family until boundary checks pass.

#### Phase 3.1 — Approved roots and action previews — COMPLETE (in-memory foundation)

Implemented explicit realpath-resolved root approval, read/write path checks, secret-path denials, symlink/junction escape rejection, bounded file fingerprints, write/move previews, approval tokens and changed-target invalidation. This foundation performs no file mutations and keeps approvals in memory; it does not yet provide persistence-backed checkpoints or resume.

**Checks:** `npm run typecheck` passed; `npm test` passed (28 passed, 1 skipped: the dedicated MongoDB integration lacked its test URI). Approved-root traversal, secret denial, junction escape, content-change invalidation, junction replacement invalidation and preview limits passed.

**Pending:** Wire approval tokens to actual mutation tools only after their preview/approval contract is integrated. Persist events and checkpoints after MongoDB URI correction. This foundation alone does not authorize filesystem actions.

### Phase 4 — Files, data and report adapters — IN PROGRESS

**Goal:** Implement inventory, deterministic CSV calculations, approved organization, input parsers and requested outputs.

**Acceptance checks:** Fixture counts/totals and file integrity match; PDF renders; unsupported formats fail clearly. Verify paths, format fixtures, malformed input and artifact hashes.

#### Phase 4.1 — Deterministic CSV analysis core — COMPLETE (pure input module)

Added a bounded CSV parser and analyzer for caller-supplied text: BOM/CRLF, escaped quotes, quoted delimiters and embedded newlines; header/row validation; duplicate and missing-cell counts; selected-column totals using exact decimal arithmetic. It does not open files, create exports, or expose a new workflow/CLI task.

**Checks:** `npm run typecheck` passed; `npm test` passed (33 passed, 1 skipped dedicated MongoDB integration). Fixtures cover known exact totals, missing values, duplicate rows, malformed quoting/width, invalid numeric values, and size/record/column/precision limits.

**Pending:** Integrate file access through approved-root permissions, add requested export formats and artifact validation, and test full file workflows after Phase 3 persistence/approval integration.

#### Phase 4.2 — PDF report rendering core — COMPLETE (in-memory output)

Added a PDFKit renderer for validated title/section text that returns PDF bytes in memory, with metadata, a standard-font character boundary, and bounded input/output size. No filesystem writes or untrusted HTML rendering are performed.

**Checks:** `npm run typecheck` passed; `npm test` passed (36 passed, 1 skipped dedicated MongoDB integration). Generated output had a valid PDF header/EOF and expected metadata; malformed, unsupported-character, oversized and excessive-section cases failed closed.

**Pending:** Write artifacts only through the approved-root/approval system, validate resulting hashes and paths, and add integrated report workflows after Phase 3 persistence/approval wiring.

#### Phase 4.3 — Bounded TXT and Markdown parsing — COMPLETE (pure input module)

Added a bounded parser for caller-supplied TXT/Markdown text. It normalizes BOM/Windows line endings, counts lines and Unicode words, extracts Markdown ATX headings outside fenced code, and rejects NUL bytes and oversized input. It does not open files or add workflow/CLI behavior.

**Checks:** `npm run typecheck` passed; `npm test` passed (39 passed, 1 skipped dedicated MongoDB integration). Fixtures cover normalization/counts, fenced heading exclusion, unsupported formats, NUL bytes, wrong types and size limits.

**Pending:** Integrate file access through approved-root permissions and verify file workflows after Phase 3 persistence/approval wiring.

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

## Prerequisite checklist milestone

**Status: COMPLETE (documentation and prerequisites).** Added root `setup-checklist.md` and placeholder-only `.env.example`; the real `.env` remains ignored. Inspected configuration and credential presence without printing or changing values. MongoDB service ping and live synthetic Groq model-check pass, but the configured MongoDB URI lacks the explicit database path required by the application. PDFKit is installed and CSV/PDF/TXT/Markdown pure-input cores pass. No Ollama installation or model download has been performed. Exact choices and owner actions are in the checklist.

## Recovery

- **Current phase/subphase:** Phase 2.1 COMPLETE for online and mocked paths; Phase 2.2 live Ollama verification is owner-deferred until tonight. Phase 2 remains IN PROGRESS. Phase 3.1 approved-root and preview foundation is COMPLETE; database-backed events/resume remain pending. Phase 4.1 CSV analysis, 4.2 in-memory PDF rendering and 4.3 TXT/Markdown parser cores are COMPLETE; file workflows remain pending permission/artifact integration. MongoDB URI needs an explicit database path before `config`/`doctor` database checks can pass.
- **Last completed work:** Phase 1.4 checkpoint `fda8566`; Phase 2 provider/tool-loop implementation, mock contracts and live synthetic Groq tool call.
- **Checks performed:** Phase 1.1: `npm ci`; typecheck/build; built CLI help/version; package version parity; invalid-argument error and no argument echo; packed Windows consumer and `taskforge.cmd`; review; `git diff --check`. Phase 1.2: `npm ci`; typecheck; tests (8 passed); missing/malformed config exit behavior and redaction; review; diff check. Phase 1.3: `npm ci`; typecheck/build; 10 tests passed against isolated disposable MongoDB; persistence and unavailable-server paths; review; diff check. Phase 1.4: clean `npm ci`; typecheck/build; Windows help/version/config/doctor smoke checks; all 12 tests passed with no skips against isolated disposable MongoDB; doctor success plus missing/unavailable failure paths and redaction; review; `git diff --check`. Registered MongoDB service remains stopped and untouched; no existing connection value was read or reused.
- **Verified commands/results:** `npm run typecheck` passed; `npm test` passed (21 passed, 1 skipped dedicated MongoDB integration; test command builds). `node dist/cli.js model-check` passed against Groq (1 read-only synthetic tool action, 2 model requests). Safe `mongosh` ping returned `1`; application URI validation failed without revealing the connection string. `git diff --check` must pass before checkpointing.
- **Phase 3.1 checks:** `npm run typecheck` passed; `npm test` passed at that checkpoint (28 passed, 1 skipped dedicated MongoDB integration). Junction-based escape and changed-target checks passed on Windows.
- **Phase 4.1 checks:** `npm run typecheck` passed; `npm test` passed (33 passed, 1 skipped dedicated MongoDB integration).
- **Phase 4.2 checks:** `npm run typecheck` passed; `npm test` passed (36 passed, 1 skipped dedicated MongoDB integration).
- **Phase 4.3 checks:** `npm run typecheck` passed; `npm test` passed (39 passed, 1 skipped dedicated MongoDB integration).
- **Outstanding:** Ollama installation/model pull and live local evaluation are explicitly deferred until tonight. Correct the MongoDB URI database path in ignored `.env` without sharing its value. Then verify config/doctor and database-dependent workflows. Continue independent work where prerequisites pass; no push.
