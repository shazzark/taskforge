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

**MongoDB setup finding (supersedes the earlier setup note):** The owner corrected the ignored `.env` URI using the locally stored database credentials; the commented credential lines were removed without printing values. `node dist/cli.js config` reports the redacted configuration as valid. A redacted outside-sandbox diagnostic resolved Atlas SRV DNS and all three nodes, then completed authenticated ping successfully. The sandbox-only DNS timeout is an environment restriction; no Atlas IP-list or database-user changes were made. Local MongoDB remains the isolated test backend.

**Phase status:** Phase 2 remains IN PROGRESS; do not mark COMPLETE until Phase 2.2 live local-model evaluation and remaining integration checks pass. No provider switch or billing was enabled.

### Phase 3 — Permissions, events and resume — IN PROGRESS

**Goal:** Add approved roots, secret denials, batch previews, bounded events/checkpoints and state revalidation.

**Acceptance checks:** Escape, changed-target and denial checks pass; cancel/resume and database-failure behavior are verified. No new task family until boundary checks pass.

#### Phase 3.1 — Approved roots and action previews — COMPLETE (in-memory foundation)

Implemented explicit realpath-resolved root approval, read/write path checks, secret-path denials, symlink/junction escape rejection, bounded file fingerprints, write/move previews, approval tokens and changed-target invalidation. This foundation performs no file mutations and keeps approvals in memory; it does not yet provide persistence-backed checkpoints or resume.

**Checks:** `npm run typecheck` passed; `npm test` passed (28 passed, 1 skipped: the dedicated MongoDB integration lacked its test URI). Approved-root traversal, secret denial, junction escape, content-change invalidation, junction replacement invalidation and preview limits passed.

**Pending:** Wire approval tokens to actual mutation tools only after their preview/approval contract is integrated. This foundation alone does not authorize filesystem actions.

#### Phase 3.2 — MongoDB run state, events and checkpoints — COMPLETE (persistence foundation)

Fixed `MongoStore.connect` to validate the MongoDB URI independently from the already-normalized provider object. Added validated run-state transitions, typed metadata-only events with stable per-run sequence and idempotency IDs, atomic per-run limits (300 events / 5 MiB budget), redacted/truncated run summaries, and version-1 checkpoints with input/state hash matching. Event payloads reject arbitrary fields, so chat text and tool outputs are not persisted by this API. Stale checkpoints and terminal runs fail closed. Approval tokens are not persisted.

**Checks:** `npm run typecheck` passed. `npm test` passed with a loopback-only test URI to the running local MongoDB service (45 passed, 0 skipped, 0 failed). The integration used a unique database name and dropped that database after run-summary CRUD, redaction, state transitions, event ordering/idempotency/budget, checkpoint round-trip/staleness and doctor connectivity checks. `node dist/cli.js config` passed with redacted output. `node dist/cli.js doctor` passed against a scratch path on local MongoDB. Atlas authenticated ping was subsequently verified outside the sandbox; the sandbox DNS timeout is environmental.

#### Phase 3.3 - Persisted CSV workflow and resume CLI - COMPLETE (bounded read-only workflow)

Added `run csv-analyze --input <path>`, `resume <run-id> --input <path>`, and `history list`. File reads require an interactive approval for the exact path, then pass through the approved-root/secret-path policy. The workflow persists bounded metadata-only events and hash-checked checkpoints; summaries exclude file names, headers, and cell contents. Resume is limited to `csv-analyze`, requires the same input bytes and workflow hash, reacquires file approval, and replays only deterministic analysis. A running record becomes resumable only after its two-minute inactivity window and an atomic stale-run claim; concurrent claims fail closed.

**Checks:** `npm run typecheck` passed; `npm test` passed against a unique loopback MongoDB database (47 passed, 0 skipped, 0 failed). Integration covered run summary redaction, events, analysis, history listing, stale-input rejection, crash-age recovery, resume completion, and cleanup of the isolated database.

**Pending:** Other workflow families, durable approved-root configuration, mutation tools, and rich artifact persistence remain future subphases. Atlas authenticated ping and isolated local MongoDB integration both pass.

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

**Integrated:** Phase 4.7 routes Markdown and TXT through the approved-file workflow and persists aggregate counts only.

#### Phase 4.4 — Bounded text-based PDF extraction — COMPLETE (pure byte input)

Added `pdfjs-dist` and a parser that accepts caller-supplied PDF bytes, extracts page text, and enforces 8 MiB input, 100-page, and 1,000,000-character limits. It uses PDF.js without system fonts, disables font-face loading, rejects malformed input, and exposes only normalized errors. Scanned PDFs/OCR, filesystem reads, and artifact integration are not supported.

**Checks:** `npm run typecheck` passed; `npm test` passed (41 passed, 1 skipped dedicated MongoDB integration). A generated in-memory report was parsed for page count and text; invalid type/header/PDF and size limit cases were rejected. npm reported zero vulnerabilities at installation.

**Pending:** Review the PDF.js dependency at release and add approved-root artifact integrity. Phase 4.7 now parses text PDF through the approved-file boundary; no OCR is implied.

#### Phase 4.5 — Bounded XLSX parsing — COMPLETE (pure byte input)

Added ExcelJS and a Yauzl ZIP preflight with entry count, per-entry and total expansion, path, encryption, symlink, duplicate-entry, worksheet-size, workbook complexity, cell-count, scalar-value and output-character limits. Formula-bearing and unsupported cell types fail closed; no filesystem access or formula evaluation is performed. ExcelJS 4.4.0 uses UUID 8 transitively, so a project-local UUID 11 override removes the reviewed advisory; installation audit reported zero vulnerabilities. Mammoth was trialed and removed after three moderate findings in its dependency tree (including unpatched sprintf-js); bounded DOCX text extraction is implemented separately in Phase 4.6.

**Checks:** `npm run typecheck` passed; full `npm test` passed against the running local MongoDB service (45 passed, 0 skipped, 0 failed), including synthetic/malformed/oversized/formula workbook contracts. `npm audit` reported zero vulnerabilities after the UUID override.

**Integrated:** Phase 4.7 parses XLSX through the approved-file workflow and persists aggregate counts only. Spreadsheet formula values remain unsupported.

#### Phase 4.6 - Bounded DOCX text extraction - COMPLETE (pure byte input)

Added a text-only DOCX parser using `fast-xml-parser` with bounded Yauzl ZIP preflight. It limits input to 8 MiB, archive entries to 256, expanded archive to 16 MiB, document XML to 1 MiB, nested XML depth to 64, and extracted text to 1,000,000 characters. It rejects DTD/entity declarations, malformed XML, macros, encrypted/unsupported ZIP entries, and does not resolve relationships, external links, embedded objects, or filesystem paths. The Mammoth candidate remains rejected because its trial dependency tree had three moderate findings; the selected XML parser and package tree audited with zero vulnerabilities.

**Checks:** Synthetic paragraph/entity/tab/break extraction and malformed, oversized, and DTD rejection tests passed. `npm run typecheck` passed; full `npm test` passed against isolated local MongoDB (47 passed, 0 skipped, 0 failed). The package install audit reported zero vulnerabilities.

**Integrated:** Phase 4.7 parses DOCX through the approved-file workflow and persists aggregate counts only. Formatting, tracked changes, headers/footers, images, tables-as-structure, and legacy DOC are not claimed.

#### Phase 4.7 — Approved document analysis workflow — COMPLETE (metadata-only persistence)

Added `run document-analyze --input <path>`. It requires interactive approval for the exact file, applies the shared approved-root/secret-path check and 8 MiB read limit, then dispatches TXT, Markdown, text PDF, DOCX, or XLSX bytes to the bounded parsers. Run records contain only format and aggregate counts; file names, extracted text, sheet names, and cell values are not persisted. No artifact is written.

**Checks:** `npm run typecheck` passed; full `npm test` passed against the loopback isolated MongoDB backend (51 passed, 0 skipped, 0 failed). Generated TXT, Markdown, PDF, DOCX, and XLSX fixtures exercised each parser; unsupported suffixes and invalid UTF-8 failed before creating run records. Persistence integration verified completed state/events and confirmed fixture text was absent from MongoDB; the unique test database and temporary fixture were cleaned up.

**Pending:** Approved-root PDF artifact output/integrity, parser resumability, and structured extraction/report workflows remain future work. Scanned PDF OCR and unsupported DOCX/XLSX features remain outside current support.

#### Phase 4.8 — Approved PDF artifact output — COMPLETE (create-only, hash-verified)

Added `run pdf-report --input <report.json> --output <new.pdf>`. The JSON input is explicitly read-approved and parsed as untrusted data, then rendered by the bounded PDF renderer. Before output, TaskForge shows the canonical target, byte count and SHA-256 digest and asks for approval. The write uses the existing in-memory preview registry, creates only a new file (never replaces an existing target), uses a same-directory temporary file and atomic hard-link creation, then verifies the written bytes and digest. No report text or artifact bytes are persisted to MongoDB.

**Checks:** `npm run typecheck` passed; `npm test` passed against the isolated local MongoDB database (57 passed, 0 skipped, 0 failed). PDF fixtures verified valid markers, create-only output, post-write byte/hash integrity, refusal to replace an existing file, stale-target invalidation, and rejection outside the approved root. The complete database workflow suite passed with isolation/cleanup. `git diff --check` passed.

**Pending:** Rich workflow artifact references, document conversion, and parser resumability remain future subphases.
### Phase 5 — Software workflow — IN PROGRESS

**Goal:** Support repository inspection, seeded bug investigation, approved patches, reviewed command execution and local diffs.

**Acceptance checks:** Reproduce and correct a seeded failure, run relevant tests, and retain secret/path controls. Verify in a disposable repository. No Git push or deployment from the workflow.

#### Phase 5.1 — Approved-root repository inventory — COMPLETE (metadata-only foundation)

Added `run repo-inspect --root <directory>`. The command requires interactive approval for the exact root, then uses the in-memory path policy to inventory bounded directory/file metadata. It skips secret paths, symlinks, and common generated/dependency directories. It does not read file contents, run commands, modify files, or persist paths/content; MongoDB receives only redacted counts and typed lifecycle events. Limits cap traversal depth, directories, and files.

**Checks:** `npm run typecheck` passed; full `npm test` passed against a loopback MongoDB URI, 49 passed, 0 skipped. Unit fixtures verified excluded dependency/VCS folders, `.env` denial, metadata redaction, unapproved-root rejection, and lifecycle events. Integration verified completed inventory run/events in a unique database that the test dropped afterward. Noninteractive CLI smoke stopped before root access. `git diff --check` passed.

**Pending after Phase 5.1:** Source-content review/seeded-failure reproduction, approved patch previews/application, and local diff review remain future subphases. This metadata inventory is not bug diagnosis or a sandbox.

#### Phase 5.2 — Reviewed test/check execution — COMPLETE (fixed command set)

Added `run software-check --root <directory> --check <node-test|typescript-check>`. The CLI requires interactive approval for the exact root and a second confirmation for the selected fixed check. The runner invokes Node directly with `shell: false`, allows only `node --test` or the repository-local TypeScript compiler with `--noEmit`, filters inherited environment variables, caps runtime at 120 seconds, drains output without displaying or persisting it and reports only a capped observed-byte count; timeout termination targets the full process tree, and records only outcome/exit metadata. This executes code from the approved repository and is not an OS sandbox; arbitrary command strings and arguments are unsupported.

**Checks:** `npm run typecheck` passed; `npm test` passed against an isolated local MongoDB database (53 passed, 0 skipped). A disposable fixture reproduced an assertion failure and passed after the fixture test was corrected. Database integration verified failed/completed run state and a successful TypeScript no-emit check; the isolated database and fixture roots were cleaned up. Persisted summaries/events contain no command output or paths.

**Pending:** Reading repository source into an investigation context, reviewed patch/diff previews and application, and more targeted test selection remain future subphases.

#### Phase 5.3 — Bounded local source review — COMPLETE (local-only, read-only)

Added `run source-review --root <directory> --file <relative-path> [...]`. It requires an interactive exact resolved-root and explicit file-set confirmation, restricts inputs to approved source extensions and in-root regular files, rejects protected paths, links, invalid UTF-8 and NUL bytes, and caps selection at 20 files, 128 KiB per file, 512 KiB total and 48 KiB displayed text. Common credential assignments, common token prefixes and PEM private-key blocks are redacted before display. Source is local-only and is not sent to a provider or persisted. Redaction is heuristic and cannot guarantee detection of every secret.

**Checks:** `npm run typecheck` passed; `npm test` passed with the isolated local MongoDB URI (55 passed, 0 skipped, 0 failed). Source review contract tests verified approved-root enforcement, explicit file selection, protected paths, traversal, symlink/junction rejection, invalid UTF-8/NUL rejection, credential assignment/token/PEM redaction, and successful bounded source review. The full suite reverified every database workflow on the isolated local database. Review found and closed a PEM redaction gap; approval now names the resolved root. Node v22 documentation confirms fatal UTF-8 decoding rejects malformed sequences and that Windows does not support `O_NOFOLLOW`, so file identity is also checked on the opened handle.

**Pending:** Seeded-failure investigation integration, reviewed patch preview/application, and local diff review remain future subphases. The read workflow is not a security scanner or OS sandbox.
#### Phase 5.4 — Reviewed file replacement — COMPLETE (approved single-file operation)

Added `run file-patch --root <directory> --target <relative-path> --content-file <relative-path>`. It accepts one existing source target and a bounded UTF-8 replacement file from the approved root. The CLI displays current and replacement text after heuristic redaction, prints the replacement SHA-256, and requires an explicit apply confirmation against a canonicalized root. The action preview binds replacement bytes and the target snapshot; state is revalidated and the replacement is written through the opened target handle, preserving permissions and avoiding path-swap redirection. The in-place write is not crash-atomic and cannot coordinate with concurrent writers to that file. Contents are not sent to a model or persisted.

**Checks:** `npm run typecheck`, `npm run build`, and `node --test test/patch-application.test.mjs` passed (3/3). Full `npm test` passed against the isolated local MongoDB test database (60 passed, 0 skipped, 0 failed). The three patch contract tests cover exact preview-bound writes, stale-target and path rejection, and reproducing a seeded test failure, applying the approved replacement, then passing the reviewed Node test runner. CLI help lists `file-patch`; the noninteractive command exits before file access. `git diff --check` passed.

**Pending:** Local Git diff review and model-assisted investigation remain separate future subphases. Redaction is heuristic; displayed terminal content must be reviewed before sharing.
### Phase 6 — Browser, research and design observations — IN PROGRESS

**Goal:** Add Playwright journeys, network/console/link checks, passive security observations, responsive/accessibility observations, design reporting and sourced comparisons.

**Acceptance checks:** Detect seeded failures; list exact checks run; include source references and label inferred observations. Verify against a fixture site and an approved real site. Active security and sensitive form actions remain separately gated.

#### Phase 6.1 — Local browser audit foundation — BLOCKED (npm registry access)

Official Playwright documentation and a read-only implementation review are complete. The agreed first slice is a local-only loopback fixture audit using isolated Chromium contexts, with external requests blocked and metadata-only persistence. Playwright is not installed. `npm install --save-dev playwright@latest` failed in the sandbox with a registry `EACCES`; the escalated retry received no registry response and was stopped. No package files or browser binaries were downloaded.

**Requires owner/environment action:** Provide working npm registry access or an already available local Playwright package cache. This blocks only Phase 6 browser execution; independent work continues.
### Phase 7 — Connections, scheduling and specialist agents — NOT STARTED

**Goal:** Add GitHub read/drafts, local schedules, email drafts and bounded delegation.

**Acceptance checks:** Verify mocked and authorized real read integrations, no accidental sending/publishing, shared budgets, repeat-run suppression and worker review. Clarify integration inputs. No unrestricted third-party executable plugins.

### Phase 8 — Release gate — NOT STARTED

**Goal:** Complete a clean Windows consumer trial, workflow documentation, contribution guide, license/dependency review and distribution checks.

**Acceptance checks:** Another developer runs documented scenarios and all required checks are recorded. Release by clone first. npm publication requires tarball consumer verification and explicit publication authorization; check package naming before release.

## Prerequisite checklist milestone

**Status: COMPLETE (documentation and prerequisites).** Added root `setup-checklist.md` and placeholder-only `.env.example`; the real `.env` remains ignored. The owner corrected the Atlas URI locally; redacted authenticated ping passes and no IP access-list or database-user changes were made. Local MongoDB responds to ping and passes isolated workflow integration checks. The synthetic Groq model-check passes. PDFKit, PDF.js, XLSX and DOCX dependencies are installed and bounded parser cores pass. Ollama has not been installed and no model has been downloaded. Remaining optional-provider choices and limitations are in the checklist.

## Recovery

- **Current phase/subphase:** Phase 2.1 COMPLETE for online and mocked paths; Phase 2.2 live Ollama verification is owner-deferred until tonight. Phase 2 remains IN PROGRESS. Phase 3.1 approved-root/previews, 3.2 MongoDB persistence primitives, and 3.3 CSV run/history/resume CLI are COMPLETE as bounded foundations; other workflow families and durable approval configuration remain pending. Phase 4.1–4.8 bounded parsers, document analysis, and approved create-only PDF artifact output are COMPLETE; parser resumability and persisted artifact references remain pending. Phase 5.1 inventory and 5.2 reviewed test/check execution are COMPLETE; Phase 5.3 bounded local source review (`18c55ba`) and 5.4 reviewed file replacement are COMPLETE; local diff review and model-assisted investigation remain pending.
- **Last completed work:** Phase 5.4 approved file replacement; Phase 4.8 approved PDF output (`2a1e4d1`); Phase 5.3 bounded local source review (`18c55ba`); Phase 5.2 runner (`c02fdb7`); Phase 5.1 inventory (`4f5ff92`); Phase 4.7 document analysis (`bbd60f3`).
- **Checks performed:** Phase 1.1: `npm ci`; typecheck/build; built CLI help/version; package version parity; invalid-argument error and no argument echo; packed Windows consumer and `taskforge.cmd`; review; `git diff --check`. Phase 1.2: `npm ci`; typecheck; tests (8 passed); missing/malformed config exit behavior and redaction; review; diff check. Phase 1.3: `npm ci`; typecheck/build; 10 tests passed against isolated disposable MongoDB; persistence and unavailable-server paths; review; diff check. Phase 1.4: clean `npm ci`; typecheck/build; Windows help/version/config/doctor smoke checks; all 12 tests passed with no skips against isolated disposable MongoDB; doctor success plus missing/unavailable failure paths and redaction; review; `git diff --check`. Registered MongoDB service remains stopped and untouched; no existing connection value was read or reused.
- **Verified commands/results:** `npm run typecheck` passed; `npm test` passed (21 passed, 1 skipped dedicated MongoDB integration; test command builds). `node dist/cli.js model-check` passed against Groq (1 read-only synthetic tool action, 2 model requests). Safe `mongosh` ping returned `1`; application URI validation failed without revealing the connection string. `git diff --check` must pass before checkpointing.
- **Phase 3.1 checks:** `npm run typecheck` passed; `npm test` passed at that checkpoint (28 passed, 1 skipped dedicated MongoDB integration). Junction-based escape and changed-target checks passed on Windows.
- **Phase 3.2 checks:** `npm run typecheck` passed; full `npm test` passed against a unique loopback test database (45 passed, 0 skipped). Database integration verified redaction, status transitions, event idempotency/order/limit, checkpoint hash matching/staleness, and doctor connectivity; the unique database was dropped afterward.
- **Phase 3.3 checks:** `npm run typecheck` passed; full `npm test` passed against a unique loopback test database (47 passed, 0 skipped). Run/history/resume verified against CSV fixtures, stale hashes rejected, and an inactive running record recovered atomically after the two-minute cutoff; scratch database dropped afterward.
- **Phase 4.1 checks:** `npm run typecheck` passed; `npm test` passed (33 passed, 1 skipped dedicated MongoDB integration).
- **Phase 4.2 checks:** `npm run typecheck` passed; `npm test` passed (36 passed, 1 skipped dedicated MongoDB integration).
- **Phase 4.3 checks:** `npm run typecheck` passed; `npm test` passed (39 passed, 1 skipped dedicated MongoDB integration).
- **Phase 4.4 checks:** `npm run typecheck` passed; `npm test` passed (41 passed, 1 skipped dedicated MongoDB integration).
- **Phase 4.5/4.6 checks:** Bounded XLSX and DOCX extraction contract fixtures pass; package installation audits reported zero vulnerabilities. Full current `npm test` passed with local MongoDB (51 passed, 0 skipped).
- **Phase 4.8 checks:** `npm run typecheck` and `npm test` passed at that checkpoint (57 passed, 0 skipped, 0 failed) with isolated local MongoDB. Approved output tests covered create-only behavior, stale-target denial, output-root containment, and PDF byte/hash validation.
- **Phase 4.7 checks:** `npm run typecheck` passed; `npm test` passed against a unique loopback MongoDB database (51 passed, 0 skipped, 0 failed). Integrated TXT, Markdown, PDF, DOCX, and XLSX parsing; malformed input rejection; metadata-only run/event persistence; and isolated database cleanup were verified.
- **Phase 5.1 checks:** `npm run typecheck` passed; `npm test` passed against a unique loopback MongoDB database (49 passed, 0 skipped, 0 failed). Integration verified the repository inventory summary and event lifecycle, then dropped the unique database and removed the temporary fixture. `node dist/cli.js run repo-inspect --root .` in a noninteractive process exited 2 before accessing the path. `git diff --check` passed.
- **Phase 5.2 checks:** `npm run typecheck` passed; `npm test` passed against an isolated local MongoDB database (53 passed, 0 skipped, 0 failed). The reviewed runner reproduced a seeded fixture assertion failure, recorded failure metadata, then passed after the fixture was corrected; the integrated project TypeScript no-emit check passed. Noninteractive approved commands remain unavailable. Output was not emitted or persisted.
- **Phase 5.3 checks:** `npm run typecheck` and `npm test` passed at that checkpoint (55 passed, 0 skipped, 0 failed) with database integration using the isolated local MongoDB instance. Source fixture tests exercised content redaction and path/type/size denials; no source content was sent to a provider or persisted.

- **Phase 5.4 checks:** `npm run typecheck` passed; `npm test` passed against isolated local MongoDB (60 passed, 0 skipped, 0 failed). A disposable seeded test failed before patch, passed after applying the content-bound replacement, and stale/outside-root changes were rejected.
- **Outstanding:** Ollama installation/model pull and live local evaluation are explicitly deferred until the owner provides it tonight. Atlas SRV DNS resolved three nodes and authenticated ping succeeded outside the sandbox; no owner database or IP-list action remains. Local MongoDB-backed workflows pass. Continue independent work; no push.
