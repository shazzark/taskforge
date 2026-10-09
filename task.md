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

### Phase 2 — Providers and agent loop — BLOCKED

**Goal:** Add interactive chat, local and free-tier provider adapters, validated tool calls, run budgets and cancellation.

**Acceptance checks:** A real model completes a small read-only tool task; unsupported tool calling and provider quota errors are reported honestly. Verify mock contract/error cases and real provider runs. No arbitrary shell access.

**Provider decision:** Recommend Groq with `openai/gpt-oss-20b` for the first online tool-call trial. Groq documents local tool calling for this model and an official Node.js/TypeScript SDK. Its published limits table lists 30 RPM, 1K RPD, 8K TPM and 200K TPD for this model, but these are published table values, not a guarantee of free-tier availability; the account's Free Plan limits must be checked in the console. Stay on the Free Plan and do not add billing. Groq says inference data is not retained by default, with temporary retention possible for reliability/abuse monitoring (up to 30 days); do not use real user or project data in the trial. Google Gemini is a viable tool-calling/TypeScript alternative, but Google states free-tier content may be used to improve products, so it is not the recommended first trial for this project.

**Observed blocker:** No TaskForge-specific Groq key/model environment variables were present; the root `.env` file is absent and ignored by Git. The Ollama command and loopback endpoint are unavailable. No credential value or unrelated credential was read. No Phase 2 code or real model run has started.

**Configuration contract proposal:** Configure only the ignored repository-root `.env` file with `TASKFORGE_PROVIDER=groq`, `TASKFORGE_GROQ_API_KEY`, `TASKFORGE_GROQ_MODEL=openai/gpt-oss-20b`, `TASKFORGE_OLLAMA_BASE_URL=http://127.0.0.1:11434`, and `TASKFORGE_OLLAMA_MODEL=qwen3:4b-q4_K_M`. `TASKFORGE_MONGODB_URI` remains the existing Phase 1 local setting. The current application does not load `.env` and its configuration contract only reads MongoDB; Phase 2 must add optional `.env` loading before validated configuration, then validate selected provider and provider-specific settings with redacted errors. Do not copy real key values into tracked files or output.

**Local model trial plan:** Once Ollama is set up, trial `qwen3:4b-q4_K_M` (official Ollama tag size about 2.6 GB) with a pinned 4K context and a synthetic read-only tool call. Record load time, response time and peak memory on this Windows laptop; hardware suitability is unverified until that trial runs.

**Exact next action:** Create a Groq API key at the official [Groq API Keys page](https://console.groq.com/keys), keep the account on Free Plan, and put it in the ignored root `.env` as `TASKFORGE_GROQ_API_KEY` alongside the names above. Do not send the value here. Then Phase 2 can add the `.env` loader and validated provider configuration before a live synthetic tool-call verification. Independently install/start Ollama only when ready to perform the local model trial; do not claim its hardware fit in advance.

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

- **Current phase/subphase:** Phase 1 COMPLETE; Phase 2 BLOCKED before implementation pending TaskForge Groq key setup and Ollama setup.
- **Last completed work:** Phase 1.4 checkpoint `fda8566`; provider research and recommendation recorded; doctor, Windows CLI smoke checks, and integrated verification.
- **Checks performed:** Phase 1.1: `npm ci`; typecheck/build; built CLI help/version; package version parity; invalid-argument error and no argument echo; packed Windows consumer and `taskforge.cmd`; review; `git diff --check`. Phase 1.2: `npm ci`; typecheck; tests (8 passed); missing/malformed config exit behavior and redaction; review; diff check. Phase 1.3: `npm ci`; typecheck/build; 10 tests passed against isolated disposable MongoDB; persistence and unavailable-server paths; review; diff check. Phase 1.4: clean `npm ci`; typecheck/build; Windows help/version/config/doctor smoke checks; all 12 tests passed with no skips against isolated disposable MongoDB; doctor success plus missing/unavailable failure paths and redaction; review; `git diff --check`. Registered MongoDB service remains stopped and untouched; no existing connection value was read or reused.
- **Blockers:** TaskForge-specific Groq key and root `.env` are absent; Ollama executable and endpoint are absent. Current app does not load `.env` or define provider configuration. The local `build-in-verified-phases` skill is unavailable; installed `engineering-workflow`, `debugging-workflow`, and `.system/review-agent` are available and were applied.
- **Checks performed for provider setup:** Confirmed the root `.env` is ignored and absent; checked only presence booleans for `TASKFORGE_GROQ_API_KEY`, `TASKFORGE_GROQ_MODEL`, and `TASKFORGE_OLLAMA_BASE_URL` (all absent); checked Ollama command and loopback port 11434 (both unavailable). Inspected `src/config.ts` and confirmed only `TASKFORGE_MONGODB_URI` is loaded and validated. No secret values were read.
- **Exact next action:** Create a Groq key at `https://console.groq.com/keys`, put it only in the ignored root `.env` as `TASKFORGE_GROQ_API_KEY` (do not share it), keep Free Plan/no billing, and report setup completion. Then implement the Phase 2 `.env` loader/provider config and verify a live synthetic read-only tool call. Separately set up Ollama for the planned `qwen3:4b-q4_K_M` 4K-context trial and measure actual laptop performance. Do not push.
