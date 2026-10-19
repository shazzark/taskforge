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

### Phase 2 — Providers and agent loop — COMPLETE

**Goal:** Add interactive chat, local and free-tier provider adapters, validated tool calls, run budgets and cancellation.

**Acceptance checks:** A real model completes a small read-only tool task; unsupported tool calling and provider quota errors are reported honestly. Verify mock contract/error cases and real provider runs. No arbitrary shell access.

**Provider decision:** Recommend Groq with `openai/gpt-oss-20b` for the first online tool-call trial. Groq documents local tool calling for this model and an official Node.js/TypeScript SDK. Its published limits table lists 30 RPM, 1K RPD, 8K TPM and 200K TPD for this model, but these are published table values, not a guarantee of free-tier availability; the account's Free Plan limits must be checked in the console. Stay on the Free Plan and do not add billing. Groq says inference data is not retained by default, with temporary retention possible for reliability/abuse monitoring (up to 30 days); do not use real user or project data in the trial. Google Gemini is a viable tool-calling/TypeScript alternative, but Google states free-tier content may be used to improve products, so it is not the recommended first trial for this project.

#### Phase 2.1 — Configuration, adapters, bounded tool loop and chat — COMPLETE (online and mocked paths)

**Implemented:** Added ignored-root `.env` loading without overriding existing process variables; runtime validation for Groq and loopback-only Ollama configuration; a shared provider completion contract; the official Groq SDK adapter; an Ollama OpenAI-compatible adapter; cancellation propagation; bounded model/tool budgets; tool-name, argument and output checks; interactive chat with an online-transfer consent prompt; and a synthetic read-only `model-check` command. No arbitrary shell tools exist.

**Mock verification:** Groq request mapping, tool response normalization, auth/quota/invalid-response errors, Ollama request/response mapping, unsupported-tool and malformed-response behavior, loopback validation, tool-call validation, cancellation, duplicate tool rejection, action limits and request limits are covered by contract tests. `npm run typecheck` and `npm test` passed; 21 tests passed and the pre-existing MongoDB integration test was skipped because its dedicated `TASKFORGE_TEST_MONGODB_URI` was not supplied. `npm test` also ran the build.

**Live Groq evidence:** `node dist/cli.js model-check` completed with Groq `openai/gpt-oss-20b`, one synthetic read-only tool action and two model requests. No user/project data was sent. The first sandboxed network attempt was unavailable; the authorized elevated run succeeded. Provider credential values were never printed.

**Interactive chat smoke:** Launched `node dist/cli.js chat` in a TTY and declined the Groq transfer prompt. Chat exited before sending a request.

#### Phase 2.2 — Live Ollama evaluation — COMPLETE (4K context, read-only tool loop)

Updated the Ollama adapter to use the native `/api/chat` endpoint so each request can explicitly set `options.num_ctx=4096`; the OpenAI-compatible endpoint does not expose context size in its documented request fields. Added validated `TASKFORGE_OLLAMA_CONTEXT_LENGTH` configuration (default 4096; accepted range 1024–131072). Groq remains selected by the existing configuration and remains the default in `.env.example`; no provider switch or model download occurred.

**Live evidence (Windows laptop, 13 October 2026):** `ollama list` and `/api/tags` confirmed only the requested `qwen3:4b-q4_K_M` candidate was used (2.62 GB on disk). TaskForge's real `runToolLoop` made two model requests at context 4096, invoked the fixed read-only `read_fixture_status` tool once, and supplied its result (`status=READY balance=7319 units`) to the second model call. The final answer correctly returned READY and 7319; assertions verified one tool execution, one action, two requests, and both result values. Ollama `/api/ps` confirmed `context_length=4096`, runner `llamacpp`, and `size=3,307,502,303` bytes resident; `size_vram=0` (CPU). `ollama ps` reported 3.3 GB and 100% CPU placement.

**Timing:** First request 96.3 s wall, including 25.4 s model load; 185 prompt tokens (9.2 s prompt evaluation) and 213 generated tokens (59.9 s generation). Follow-up request 65.8 s wall; 241 prompt tokens (5.5 s prompt evaluation) and 156 generated tokens (46.3 s generation). Whole tool loop: 162.2 s. These are single-run measurements, not repeatability claims.

**Memory suitability:** Windows reports 7.65 GiB physical RAM, 0.14 GiB available, and 98% memory load after inference; Ollama reported 3.3 GB resident and no VRAM allocation. The model and tool loop function, but current laptop headroom is very low and CPU inference is slow; this is not a comfortable configuration for concurrent workflows. The evidence reflects the laptop's load at measurement time and does not isolate all other processes.

**Verification:** `npm run typecheck` passed; `npm run build` passed; focused provider tests passed (10/10); the integrated `npm test` suite passed (91 passed, 0 failed, 1 skipped because `TASKFORGE_TEST_MONGODB_URI` was not supplied). The live model output was validated by assertions in a temporary evaluation script, which was removed after the run. No secrets or user/project data were sent.

**MongoDB setup finding (supersedes the earlier setup note):** The owner corrected the ignored `.env` URI using the locally stored database credentials; the commented credential lines were removed without printing values. `node dist/cli.js config` reports the redacted configuration as valid. A redacted outside-sandbox diagnostic resolved Atlas SRV DNS and all three nodes, then completed authenticated ping successfully. The sandbox-only DNS timeout is an environment restriction; no Atlas IP-list or database-user changes were made. Local MongoDB remains the isolated test backend.

**Phase status:** Phase 2 is COMPLETE for the bounded provider and read-only tool-loop scope. Groq remains the default provider; the Ollama evaluation used only the already-downloaded local model. No billing was enabled.

### Phase 3 — Permissions, events and resume — COMPLETE

**Goal:** Add approved roots, secret denials, batch previews, bounded events/checkpoints and state revalidation.

**Acceptance checks:** Escape, changed-target and denial checks pass; cancel/resume and database-failure behavior are verified. No new task family until boundary checks pass.

#### Phase 3.1 — Approved roots and action previews — COMPLETE (in-memory foundation)

Implemented explicit realpath-resolved root approval, read/write path checks, secret-path denials, symlink/junction escape rejection, bounded file fingerprints, write/move previews, approval tokens and changed-target invalidation. This foundation performs no file mutations and keeps approvals in memory; it does not yet provide persistence-backed checkpoints or resume.

**Checks:** `npm run typecheck` passed; `npm test` passed (28 passed, 1 skipped: the dedicated MongoDB integration lacked its test URI). Approved-root traversal, secret denial, junction escape, content-change invalidation, junction replacement invalidation and preview limits passed.

**Pending:** This general root/preview foundation remains in-memory. `file-patch`, `pdf-report`, and local `draft` each enforce their own approved, content-bound operation path; durable scoped folder approvals are implemented in Phase 3.4. Higher-level file patch and file move workflows integrate approved mutations with persistent folder grants and operation consent.

#### Phase 3.2 — MongoDB run state, events and checkpoints — COMPLETE (persistence foundation)

Fixed `MongoStore.connect` to validate the MongoDB URI independently from the already-normalized provider object. Added validated run-state transitions, typed metadata-only events with stable per-run sequence and idempotency IDs, atomic per-run limits (300 events / 5 MiB budget), redacted/truncated run summaries, and version-1 checkpoints with input/state hash matching. Event payloads reject arbitrary fields, so chat text and tool outputs are not persisted by this API. Stale checkpoints and terminal runs fail closed. Approval tokens are not persisted.

**Checks:** `npm run typecheck` passed. `npm test` passed with a loopback-only test URI to the running local MongoDB service (45 passed, 0 skipped, 0 failed). The integration used a unique database name and dropped that database after run-summary CRUD, redaction, state transitions, event ordering/idempotency/budget, checkpoint round-trip/staleness and doctor connectivity checks. `node dist/cli.js config` passed with redacted output. `node dist/cli.js doctor` passed against a scratch path on local MongoDB. Atlas authenticated ping was subsequently verified outside the sandbox; the sandbox DNS timeout is environmental.

#### Phase 3.3 - Persisted CSV workflow and resume CLI - COMPLETE (bounded read-only workflow)

Added `run csv-analyze --input <path>`, `resume <run-id> --input <path>`, and `history list`. File reads require an interactive approval for the exact path, then pass through the approved-root/secret-path policy. The workflow persists bounded metadata-only events and hash-checked checkpoints; summaries exclude file names, headers, and cell contents. Resume is limited to `csv-analyze`, requires the same input bytes and workflow hash, reacquires file approval, and replays only deterministic analysis. A running record becomes resumable only after its two-minute inactivity window and an atomic stale-run claim; concurrent claims fail closed.

**Checks:** `npm run typecheck` passed; `npm test` passed against a unique loopback MongoDB database (47 passed, 0 skipped, 0 failed). Integration covered run summary redaction, events, analysis, history listing, stale-input rejection, crash-age recovery, resume completion, and cleanup of the isolated database.

**Pending:** Additional workflow families, additional mutation workflows, and rich artifact references remain future subphases. Atlas authenticated ping and isolated local MongoDB integration both pass.

#### Phase 3.4 — Persistent folder approvals — COMPLETE

Added validated MongoDB `folder_approvals` records keyed by canonical path and independent `read`/`write` scope, retaining active/revoked status. Added interactive `permissions approve`, `list [--all]`, and `revoke` commands. Roots must resolve to an existing non-sensitive directory; permission changes require a TTY confirmation. CLI file/repository workflows now require an active covering scope before operating. Read workflows need `read`; file patching needs both read and write; artifact creation and repository command execution need write. Existing operation confirmation, secret denial, path canonicalization, and link escape protections remain active. Revocation is soft, and repeat revocation reports no active grant.

**Checks:** `npm run typecheck` passed. `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_test npm test` passed against a unique generated loopback test database: 94 passed, 0 skipped, 0 failed. Integration covered distinct read/write records, descendant containment, sibling escape denial, wrong-scope denial, revocation, repeat revocation, all-status listing, invalid path/scope rejection, and visibility/enforcement with more than 1,000 stored grants. CLI checks verify permission changes stop with exit code 2 without an interactive terminal and database unavailability is reported without a stack trace or endpoint disclosure. Existing symlink/escape and secret-path tests also passed.

### Phase 4 — Files, data and report adapters — COMPLETE (declared v1 workflows)

**Goal:** Implement inventory, deterministic CSV calculations, approved organization, input parsers and requested outputs.

**Acceptance checks:** Fixture counts/totals and file integrity match; PDF renders; unsupported formats fail clearly. Verify paths, format fixtures, malformed input and artifact hashes.

#### Phase 4.1 — Deterministic CSV analysis core — COMPLETE (pure input module)

Added a bounded CSV parser and analyzer for caller-supplied text: BOM/CRLF, escaped quotes, quoted delimiters and embedded newlines; header/row validation; duplicate and missing-cell counts; selected-column totals using exact decimal arithmetic. It does not open files, create exports, or expose a new workflow/CLI task.

**Checks:** `npm run typecheck` passed; `npm test` passed (33 passed, 1 skipped dedicated MongoDB integration). Fixtures cover known exact totals, missing values, duplicate rows, malformed quoting/width, invalid numeric values, and size/record/column/precision limits.

**Integrated:** File access is wired through explicit approval and Phase 3 metadata persistence in the CSV analysis/resume and document-analysis workflows. Create-only validated PDF output is in Phase 4.8. **Remaining:** further agreed file workflow families and release acceptance.

#### Phase 4.2 — PDF report rendering core — COMPLETE (in-memory output)

Added a PDFKit renderer for validated title/section text that returns PDF bytes in memory, with metadata, a standard-font character boundary, and bounded input/output size. No filesystem writes or untrusted HTML rendering are performed.

**Checks:** `npm run typecheck` passed; `npm test` passed (36 passed, 1 skipped dedicated MongoDB integration). Generated output had a valid PDF header/EOF and expected metadata; malformed, unsupported-character, oversized and excessive-section cases failed closed.

**Integrated:** Phase 4.8 writes a new PDF only after path/content approval and verifies the resulting hash. **Integrated:** CSV/document artifact references and JSON/CSV/Markdown aggregate exports are now implemented. **Remaining:** other agreed output formats/workflows.

#### Phase 4.3 — Bounded TXT and Markdown parsing — COMPLETE (pure input module)

Added a bounded parser for caller-supplied TXT/Markdown text. It normalizes BOM/Windows line endings, counts lines and Unicode words, extracts Markdown ATX headings outside fenced code, and rejects NUL bytes and oversized input. It does not open files or add workflow/CLI behavior.

**Checks:** `npm run typecheck` passed; `npm test` passed (39 passed, 1 skipped dedicated MongoDB integration). Fixtures cover normalization/counts, fenced heading exclusion, unsupported formats, NUL bytes, wrong types and size limits.

**Integrated:** Phase 4.7 routes Markdown and TXT through the approved-file workflow and persists aggregate counts only.

#### Phase 4.4 — Bounded text-based PDF extraction — COMPLETE (pure byte input)

Added `pdfjs-dist` and a parser that accepts caller-supplied PDF bytes, extracts page text, and enforces 8 MiB input, 100-page, and 1,000,000-character limits. It uses PDF.js without system fonts, disables font-face loading, rejects malformed input, and exposes only normalized errors. Scanned PDFs/OCR, filesystem reads, and artifact integration are not supported.

**Checks:** `npm run typecheck` passed; `npm test` passed (41 passed, 1 skipped dedicated MongoDB integration). A generated in-memory report was parsed for page count and text; invalid type/header/PDF and size limit cases were rejected. npm reported zero vulnerabilities at installation.

**Dependency review:** Current online production `npm audit` passed with zero reported vulnerabilities; licensing and deprecation review remains in Phase 8. Phase 4.7 parses text PDFs through the approved-file boundary; no OCR is implied.

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

**Checks:** `npm run typecheck` passed; full `npm test` passed against the loopback isolated MongoDB backend (51 passed, 0 skipped, 0 failed). Generated TXT, Markdown, PDF, DOCX, and XLSX fixtures exercised each parser; unsupported suffixes fail before creating records, while invalid UTF-8 is recorded as failed metadata only after Phase 4.9. Persistence integration verified completed state/events and confirmed fixture text was absent from MongoDB; the unique test database and temporary fixture were cleaned up.

**Integrated:** Approved-root PDF artifact output/integrity is implemented in Phase 4.8; metadata-only document resume is implemented in Phase 4.9. **Pending:** rich artifact references and structured extraction/report workflows remain future work. Scanned PDF OCR and unsupported DOCX/XLSX features remain outside current support.

#### Phase 4.8 — Approved PDF artifact output — COMPLETE (create-only, hash-verified)

Added `run pdf-report --input <report.json> --output <new.pdf>`. The JSON input is explicitly read-approved and parsed as untrusted data, then rendered by the bounded PDF renderer. Before output, TaskForge shows the canonical target, byte count and SHA-256 digest and asks for approval. The write uses the existing in-memory preview registry, creates only a new file (never replaces an existing target), uses a same-directory temporary file and atomic hard-link creation, then verifies the written bytes and digest. No report text or artifact bytes are persisted to MongoDB.

**Checks:** `npm run typecheck` passed; `npm test` passed against the isolated local MongoDB database (57 passed, 0 skipped, 0 failed). PDF fixtures verified valid markers, create-only output, post-write byte/hash integrity, refusal to replace an existing file, stale-target invalidation, and rejection outside the approved root. The complete database workflow suite passed with isolation/cleanup. `git diff --check` passed.

**Integrated:** CSV artifact references, bounded document conversion, and document artifact references are verified in Phases 4.11–4.12.

#### Phase 4.9 — Document workflow checkpoints and resume — COMPLETE

Added a metadata-only checkpoint before document parsing and deterministic replay for an uncertain `document-analyze` run. Resume requires the same input bytes and workflow-state hash; the CLI reacquires exact-file read approval and selects CSV or document resume from the stored workflow ID. Parsing failures are persisted as failed metadata only. `npm run typecheck`, `npm run build`, and full `npm test` passed against the isolated local MongoDB database (86 passed, 0 skipped, 0 failed). Unit and MongoDB integration coverage reject changed bytes and verify successful resume/completion; no document content is persisted.
#### Phase 4.10 — Aggregate CSV report exports — COMPLETE (create-only, hash-verified)

Added optional `run csv-analyze --input <path> --output <new.json|new.csv|new.md>`. The JSON, CSV, or Markdown report includes row count, duplicate-row count, and missing-cell count; when numeric columns are explicitly selected (Phase 4.13), it also includes those selected labels and exact totals. Source cell values remain excluded. The command previews the report and requires confirmation of the exact canonical output path and SHA-256. It also requires persistent folder write approval and uses create-only output with post-write digest validation. Cancellation leaves the analysis complete and creates no report. All implementation remains local.

**Checks:** `npm run typecheck` passed with strict TypeScript settings. Full `npm test` passed against `mongodb://127.0.0.1:27017/taskforge_test` (98 passed, 0 failed, 0 skipped), including isolated MongoDB integration/cleanup and new format, privacy, suffix, invalid-metric, and noninteractive approval-gate tests. `npm run build` passed as part of the test command. Independent review reported no findings.

#### Phase 4.11 — CSV artifact references — COMPLETE (metadata-only)

Added a metadata-only MongoDB `artifacts` collection reference for completed CSV aggregate exports. It links the completed run to a filename relative to the approved output folder and records format, SHA-256, byte count, and timestamp; it rejects absolute/traversing paths, unsupported fields/types, oversized values, and references to incomplete or non-CSV runs. `history list` prints linked artifact metadata with terminal controls escaped. If metadata persistence fails after file creation, the CLI reports that the file exists and the reference was not saved; it does not delete user output.

**Checks:** `npm run typecheck` and full `npm test` passed with `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_test` (98 passed, 0 failed, 0 skipped). Integration verified completed-run linking, listing, traversal/extra-field rejection, and absence of artifact content/absolute paths in MongoDB; the harness dropped its unique database. Independent review found one post-write error-reporting gap, which was fixed and confirmed resolved with no other findings. `git diff --check` passed.

#### Phase 4.12 — Bounded plain-text document conversion — COMPLETE (plain-text artifact)

Added `run document-convert --input <path> --output <new.txt>` for TXT, Markdown, text PDF, DOCX, and XLSX. It reuses the existing safe parsers, renders XLSX rows as escaped TSV, caps converted output at 64 KiB, previews the full local text and binds confirmation to its path and SHA-256, requires persistent write scope, and creates only a new file. The completed document analysis run receives a metadata-only artifact reference; source and converted text remain out of MongoDB. Reference persistence failure reports that the already-created output remains on disk.

**Checks:** `npm run typecheck` passed; full `npm test` passed against the unique loopback MongoDB integration database (101 passed, 0 failed, 0 skipped); focused conversion/writer/CLI-gate tests passed (10/10). Integration verified document artifact references are linked only to completed document runs and reject mismatched artifact types. Tests cover generated TXT, Markdown, PDF, DOCX, and XLSX extraction, TSV escaping, unsupported suffix and 64 KiB output limits, writer create-only/hash behavior, and non-TTY denial before file access. Independent review found and resolved the post-write verification reporting gap; no other issues. `git diff --check` passed.

#### Phase 4.13 — Selected numeric CSV totals — COMPLETE

The deterministic parser already supported exact decimals, but `csv-analyze` passed no selected columns. Added repeatable `--numeric-column <header>` options and includes selected labels/totals in terminal and structured JSON/CSV/Markdown output. Source cell values remain excluded. Selected column names are bound into the checkpoint state hash so resuming requires the same calculation scope; empty selections retain the v1 hash and existing resume behavior.

**Checks:** `npm run typecheck` passed; full isolated MongoDB suite passed (105 passed, 0 failed, 0 skipped). Focused parser/export/CLI tests passed (14/14), covering explicit selections, exact totals, prototype-safe headers, adversarial Markdown labels, selection bound to resume hash, report inclusion, and source-value exclusion. Independent review found and cleared the prototype-key and Markdown-markup cases; final review reported no findings. `git diff --check` passed.

### Phase 5 — Software workflow — COMPLETE (declared v1 workflows)

**Goal:** Support repository inspection, seeded bug investigation, approved patches, reviewed command execution and local diffs.

**Acceptance checks:** Reproduce and correct a seeded failure, run relevant tests, and retain secret/path controls. Verify in a disposable repository. No Git push or deployment from the workflow.

#### Phase 5.1 — Approved-root repository inventory — COMPLETE (metadata-only foundation)

Added `run repo-inspect --root <directory>`. The command requires interactive approval for the exact root, then uses the in-memory path policy to inventory bounded directory/file metadata. It skips secret paths, symlinks, and common generated/dependency directories. It does not read file contents, run commands, modify files, or persist paths/content; MongoDB receives only redacted counts and typed lifecycle events. Limits cap traversal depth, directories, and files.

**Checks:** `npm run typecheck` passed; full `npm test` passed against a loopback MongoDB URI, 49 passed, 0 skipped. Unit fixtures verified excluded dependency/VCS folders, `.env` denial, metadata redaction, unapproved-root rejection, and lifecycle events. Integration verified completed inventory run/events in a unique database that the test dropped afterward. Noninteractive CLI smoke stopped before root access. `git diff --check` passed.

**Integrated:** Source review and model-assisted investigation are in Phase 5.3/5.6; approved patching is Phase 5.4; staged diff review is Phase 5.5. This metadata inventory itself remains read-only and is not bug diagnosis or a sandbox.

#### Phase 5.2 — Reviewed test/check execution — COMPLETE (fixed command set)

Added `run software-check --root <directory> --check <node-test|typescript-check>`. The CLI requires interactive approval for the exact root and a second confirmation for the selected fixed check. The runner invokes Node directly with `shell: false`, allows only `node --test` or the repository-local TypeScript compiler with `--noEmit`, filters inherited environment variables, caps runtime at 120 seconds, drains output without displaying or persisting it and reports only a capped observed-byte count; timeout termination targets the full process tree, and records only outcome/exit metadata. This executes code from the approved repository and is not an OS sandbox; arbitrary command strings and arguments are unsupported.

**Checks:** `npm run typecheck` passed; `npm test` passed against an isolated local MongoDB database (53 passed, 0 skipped). A disposable fixture reproduced an assertion failure and passed after the fixture test was corrected. Database integration verified failed/completed run state and a successful TypeScript no-emit check; the isolated database and fixture roots were cleaned up. Persisted summaries/events contain no command output or paths.

**Integrated:** Local source review, consented model-assisted investigation, patch preview/application, staged diff review, and explicitly selected in-root Node tests are in Phases 5.3–5.7. **Remaining:** any broader workflow not covered by the fixed reviewed commands.

#### Phase 5.3 — Bounded local source review — COMPLETE (local-only, read-only)

Added `run source-review --root <directory> --file <relative-path> [...]`. It requires an interactive exact resolved-root and explicit file-set confirmation, restricts inputs to approved source extensions and in-root regular files, rejects protected paths, links, invalid UTF-8 and NUL bytes, and caps selection at 20 files, 128 KiB per file, 512 KiB total and 48 KiB displayed text. Common credential assignments, common token prefixes and PEM private-key blocks are redacted before display. Source is local-only and is not sent to a provider or persisted. Redaction is heuristic and cannot guarantee detection of every secret.

**Checks:** `npm run typecheck` passed; `npm test` passed with the isolated local MongoDB URI (55 passed, 0 skipped, 0 failed). Source review contract tests verified approved-root enforcement, explicit file selection, protected paths, traversal, symlink/junction rejection, invalid UTF-8/NUL rejection, credential assignment/token/PEM redaction, and successful bounded source review. The full suite reverified every database workflow on the isolated local database. Review found and closed a PEM redaction gap; approval now names the resolved root. Node v22 documentation confirms fatal UTF-8 decoding rejects malformed sequences and that Windows does not support `O_NOFOLLOW`, so file identity is also checked on the opened handle.

**Integrated:** Seeded-failure investigation is in Phase 5.6; reviewed patch preview/application is in Phase 5.4; staged local diff review is in Phase 5.5. Redaction remains heuristic; this read workflow is not a security scanner or OS sandbox.
#### Phase 5.4 — Reviewed file replacement — COMPLETE (approved single-file operation)

Added `run file-patch --root <directory> --target <relative-path> --content-file <relative-path>`. It accepts one existing source target and a bounded UTF-8 replacement file from the approved root. The CLI displays current and replacement text after heuristic redaction, prints the replacement SHA-256, and requires an explicit apply confirmation against a canonicalized root. The action preview binds replacement bytes and the target snapshot; state is revalidated and the replacement is written through the opened target handle, preserving permissions and avoiding path-swap redirection. The in-place write is not crash-atomic and cannot coordinate with concurrent writers to that file. Contents are not sent to a model or persisted.

**Checks:** `npm run typecheck`, `npm run build`, and `node --test test/patch-application.test.mjs` passed (3/3). Full `npm test` passed against the isolated local MongoDB test database (60 passed, 0 skipped, 0 failed). The three patch contract tests cover exact preview-bound writes, stale-target and path rejection, and reproducing a seeded test failure, applying the approved replacement, then passing the reviewed Node test runner. CLI help lists `file-patch`; the noninteractive command exits before file access. `git diff --check` passed.

**Integrated:** Local Git diff review and model-assisted investigation are tracked in Phases 5.5 and 5.6. Redaction is heuristic; displayed terminal content must be reviewed before sharing.

#### Phase 5.5 — Approved local Git diff review — COMPLETE (read-only, local)

Added `run git-diff --root <directory>`. It requires an interactive canonical repository-root approval, lists staged tracked paths without reading diff content, then asks approval for that exact path list. It caps the diff at 48 KiB and 20 files, disables external diff and text conversion, disables fsmonitor and untracked-cache execution, reads only the index and Git objects (not working-tree files), rejects protected paths, applies local heuristic redaction including PEM blocks, and does not call a model or persist contents. Unstaged and untracked files are excluded.

**Checks:** Current integrated verification passed `npm run typecheck`, `npm run build`, and `npm test` against the isolated local MongoDB test database (67 passed, 0 skipped, 0 failed). Focused fixtures cover staged-file review, credential/PEM redaction, and protected-secret-path rejection. A Windows TTY smoke in a disposable temporary Git repo approved the canonical root and exact staged one-file list and displayed the expected diff. The noninteractive CLI exits 2 before path access. `git diff --check` passed.

**Limitations:** Review is staged-only. Redaction remains heuristic; displayed diff content must be reviewed locally before sharing.

#### Phase 5.6 — Explicit model-assisted investigation — COMPLETE (Groq synthetic integration)

Added `run model-investigate --root <directory> --file <relative-path> [...]`. It locally reviews 1–5 explicitly selected source files, applies existing heuristic redaction, and displays those excerpts before a separate provider/model transfer confirmation. It sends at most 24 KiB of redacted source in one request with no tools, stores neither source nor findings, validates bounded text output, escapes terminal control characters, and labels model findings unverified. Declining transfer makes no provider request.

**Checks:** Mocked provider tests verify exact redacted excerpt transfer, no tool contract, byte limits including multibyte UTF-8, bounded output rejection, and terminal control escaping. A Windows TTY cancellation smoke verified source was redacted and transfer refusal returned without a provider call. A separate live Groq call used only a disposable synthetic `add` function with an intentional subtraction bug; after both consent prompts, Groq identified the seeded issue. No project source was sent and no result was persisted. Current integrated verification passed `npm run typecheck`, `npm run build`, and `npm test` (67 passed, 0 skipped, 0 failed) with isolated local MongoDB.
### Phase 6 — Browser, research and design observations — IN PROGRESS

**Goal:** Add Playwright journeys, network/console/link checks, passive security observations, responsive/accessibility observations, design reporting and sourced comparisons.

**Acceptance checks:** Detect seeded failures; list exact checks run; include source references and label inferred observations. Verify against a fixture site and an approved real site. Active security and sensitive form actions remain separately gated.

#### Phase 6.1 — Local browser audit foundation — COMPLETE (loopback fixture slice)

Added Playwright 1.64.0 as a development dependency and installed its matching Chromium components in the project-local `node_modules` cache (`PLAYWRIGHT_BROWSERS_PATH=0` was command-scoped; no global browser configuration changed). Added `run browser-audit --url <loopback-url>` with TTY consent, HTTP loopback-only target validation, isolated Chromium context, cross-origin and non-GET/HEAD request blocking, 100 routed-page-request cap, at most 25 same-origin link probes, bounded timeouts, cancellation checks, and aggregate-count-only MongoDB persistence. It does not capture page text, URLs, titles, screenshots, or console messages.

**Checks:** `npm run typecheck`, `npm run build`, and full `npm test` passed with `TASKFORGE_TEST_MONGODB_URI` pointed to the isolated local test database (85 passed, 0 skipped, 0 failed). The real local HTTP/Chromium fixture verified blocked external and unsafe requests, bounded link checks, and exclusion of target/page content from persisted metadata. CLI non-TTY gating and pre-persistence rejection of non-loopback targets, userinfo, query, and fragment were verified. `npx playwright install --list` verified the installed package-matched browser components. Independent review found no material boundary or persistence issue; in-flight Playwright calls remain bounded by their operation timeout rather than immediately interruptible by AbortSignal.

**Remaining Phase 6:** Broader audit/design workflows and a real-site journey remain pending. Owner must provide an explicitly approved target and journey before any real-site access; login credentials only if the journey genuinely requires them. Phase 6 remains IN PROGRESS.

#### Phase 6.2 — Query-only Groq browser research — COMPLETE (bounded first slice)

Added `run research --query <question>`. It requires a TTY and explicit confirmation, sends only the trimmed query (maximum 512 characters) to Groq browser search, and has no file, agent, code-execution, persistence, or external write access. It requires an allowlisted Groq GPT OSS model, requests only the built-in `browser_search` tool, validates that execution type and bounded HTTPS source fields, requires at least one retrieved source, and terminal-escapes the answer, titles and excerpts. Results are labeled unverified and include a local retrieval timestamp. Search is optional, uses the existing Groq key/model configuration, and is powered by Exa per Groq documentation; no separate key/account is needed. Service terms, quotas and pricing are controlled by Groq.

**Checks:** Four mocked contract tests cover exact tool scope, configured supported-model selection, unsafe/missing source rejection, bounds, sanitized quota errors and cancellation. `npm run typecheck`, `npm run build` and full `npm test` passed with the isolated local MongoDB URI (82 passed, 0 skipped, 0 failed). Live synthetic Groq query returned 10 validated sources including an official Groq documentation result; only model, source count, retrieval timestamp and an official-domain boolean were printed. Independent review confirmed consent and output handling; its model-mismatch finding was fixed and a non-default supported-model test was added.

**Remaining Phase 6:** The verified local fixture browser foundation is complete. Broader audit/design workflows and an explicitly approved real-site journey remain pending.

#### Phase 6.4 — Fixture design observations — COMPLETE (loopback fixture slice)

The loopback browser audit displays bounded CSS custom-property names and counts of semantic/component-like elements. Results are escaped for terminal display and are excluded from MongoDB summaries/events. This is a fixture-only observation slice and does not claim original design-system recovery.

**Checks:** `npm run typecheck`, `npm run build`, and `node --test test/browser-audit.test.mjs` passed (5/5). Full `npm test` with `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_test` passed (120 passed, 0 skipped, 0 failed), including the dedicated live MongoDB persistence test. The fixture verifies bounded safe CSS custom-property names and component counts appear in the local report, bidi controls are excluded, and design values/observations are absent from persisted metadata. Independent review found no remaining actionable boundedness or privacy findings after limiting the CSS scan, ASCII-filtering emitted names, and capping DOM traversal at 2,000 elements.

**Remaining Phase 6:** Owner-provided real-site target and journey are still required before live navigation. Broader design/accessibility/security workflows remain incomplete.

#### Phase 6.5 — Two-query sourced research comparison — COMPLETE (bounded comparison slice)

Added `run research --compare <question> --against <question>` for two separately executed browser searches. The CLI confirms both exact query strings in one prompt, displays each unverified model synthesis alongside validated source excerpts, and mechanically identifies exact shared URL matches. It explicitly leaves claim-level agreement and contradiction judgments to the reader. Nothing is persisted.

**Checks:** `npm run typecheck`, `npm run build`, focused Groq browser-search tests (5/5), and the full isolated MongoDB suite (121 passed, 0 skipped, 0 failed) passed. Synthetic responses verified two bounded exact queries, source excerpt output, and exact shared URL detection. Independent review found no remaining consent, bounds, or claim-scope issue after directional-control URLs were rejected and displayed URLs terminal-escaped. Live research remains optional and is not required for the synthetic contract check.

### Phase 7 — Connections, scheduling and specialist agents — IN PROGRESS

**Goal:** Add GitHub read/drafts, local schedules, email drafts and bounded delegation.

**Acceptance checks:** Verify mocked and authorized real read integrations, no accidental sending/publishing, shared budgets, repeat-run suppression and worker review. Clarify integration inputs. No unrestricted third-party executable plugins.

#### Phase 7.1 — Public GitHub issue reader — COMPLETE (tokenless read only)

Added `run github-issues --repository <owner/name>`. It asks before one GET to the fixed GitHub API origin, uses no credential or environment token, requests up to 20 open issues, filters pull requests, caps response size at 256 KiB, validates issue fields and links, escapes terminal controls, and prints titles/links only. It does not write to GitHub, persist data, or read private repositories.

**Checks:** Mocked tests cover endpoint/headers (including no Authorization header), pull-request exclusion, response/title controls, malformed URL/repository, oversized response and rate-limit errors; both adapter tests pass in the integrated 67-test run. The Windows CLI completed a live read against the public `shazzark/taskforge` repository after its confirmation prompt; zero open issues were returned. The sandbox request failed, then the same tokenless GET succeeded outside the sandbox. Official GitHub documentation confirms public issue listing does not require authentication and unauthenticated REST API requests have a 60/hour primary limit.

#### Phase 7.2 — Local issue and email draft artifacts — COMPLETE (local-only, create-only)

Added `run draft --input <draft.json> --output <new.md>` for GitHub issue and email drafts. Inputs are locally approved JSON; runtime validation bounds fields, rejects email header injection, issue URL userinfo and terminal control injection in preview, and requires an optional related issue URL to match the named public repository. The CLI previews the rendered Markdown and requires approval bound to the exact new path and content hash; writing is create-only and followed by hash verification. It makes no network request and does not store draft contents in MongoDB. Markdown is the current local artifact convention; no email provider or GitHub write token is used. Node's path-based filesystem APIs do not protect against a hostile concurrent swap of the approved output directory.

**Checks:** `npm run typecheck`, `npm run build`, and the full `npm test` suite passed against isolated local MongoDB (72 passed, 0 skipped, 0 failed). Five focused draft tests cover issue/email rendering, malformed and credential-bearing issue URLs, email header injection, terminal control escaping, create-only output, stale targets, path boundaries and hash verification. `git diff --check` passed.

Private-repository access remains optional and out of scope unless selected; public reading needs no token.

#### Phase 7.3 — Bounded read-only specialist review — COMPLETE (first read-only slice)

Added `run specialist-review --root <directory> --file <relative-path> [...]`. After local root/file approval and a separate transfer confirmation, it runs at most two fixed specialist roles and one parent-review call through the selected provider. The CLI creates one fresh `AgentBudgetLedger` for the command; it bounds requests/actions across those workers and parent review. The ledger API can also be passed into the normal tool loop by a future composed parent orchestration path; this standalone CLI is not attached to a separate ongoing agent run. Workers receive no tools and have no nested delegation API. Inputs, goals and outputs are bounded; worker outputs and source are treated as untrusted data; terminal controls are escaped. Provider failures and incomplete review steps preserve sanitized status kinds and produce nonzero CLI exit. The parent review output remains unverified; no files are written and no source/findings are persisted. No distinct key or service is required.

**Checks:** Strict `npm run typecheck` and `npm run build` passed; full `npm test` passed against isolated local MongoDB (78 passed, 0 skipped, 0 failed). Fifteen provider/tool-loop/specialist contract tests verify shared request/action accounting when callers pass the same ledger, max-two worker enforcement, no tools/nested delegation, budget exhaustion, tool-call rejection, sanitized provider failures and parent-review failure status. Noninteractive CLI smoke exited 2 before source access. A read-only reviewer confirmed the failure/budget fixes and found no material remaining issue.

#### Phase 7.4 — Foreground schedules — COMPLETE (reviewed bounded slice)

Implemented MongoDB-backed one-time and fixed-interval schedules for CSV/document analysis. Schedules execute only in the foreground `schedule run` process. Due occurrences are atomically claimed, late/missed intervals are counted and recorded without replay, and approval-dependent occurrences remain pending when no user is present. Every occurrence has a deterministic run ID and canonical `awaiting_approval` `RunSummary`; workflows use that run ID, allowing a restarted scheduler to finalize a completed run without repeating analysis. Interactive executions require fresh schedule confirmation and exact-file read approval; path policy and input hash/checkpoint are revalidated before resume. CLI supports add, list, pause, resume, confirmed soft-delete, explicitly confirmed stale-claim recovery, continuous run and one-tick `--once`. Recovery requires the owner to confirm the previous scheduler stopped; running workflow recovery still follows the existing stale-run checkpoint rules. No OS scheduler job is installed.

**Checks:** Strict `npm run typecheck` passed. `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_test npm test` built and passed all 91 tests (0 skips/failures) using a unique isolated loopback database that the integration harness drops after use. Integration verified deterministic occurrence/run linkage and canonical pending state, due-claim duplicate suppression, missed count/history, pending approval retention, pause/resume, explicit stale-claim recovery, completion and soft-delete visibility. Mocked scheduler contracts verify unattended pending state, fresh approval before execution and completed-run finalization without replay.

**Recovery boundary:** A process crash can leave a dispatch claim. The owner must stop the previous runner and explicitly run `schedule recover <id>`; this clears only the claim and preserves the awaiting run. If its workflow was already completed, the scheduler finalizes without replay. If it was interrupted while running, a fresh schedule and file approval is still required and the workflow's stale-run/input-checkpoint resume validation must pass. The explicit recovery command and completed-run finalization are covered by integration/mock contract tests. Independent review found no remaining duplicate-execution or approval-semantic defects.

#### Phase 7.5 — Approved-source specialist tool integration — COMPLETE (bounded read-only tool)

Workers now run through the shared `AgentBudgetLedger` and can receive an explicitly supplied allowlisted tool. The CLI supplies one literal, case-insensitive source-search tool over the same already approved/read/redacted excerpts shown to the user. Queries are capped at 200 characters and results at 20 matching lines/8,000 characters. The parent review has no tools; no filesystem reread, browser, shell, GitHub-write, messaging, nested delegation, or persistence capability is exposed.

**Checks:** `npm run typecheck` and `npm run build` passed; focused specialist and permission CLI tests passed (13/13). The full isolated MongoDB suite passed (120 passed, 0 failed, 0 skipped), including shared request/action budget exhaustion and tool-action status coverage. Independent permission review found no actionable findings after the status-classification fix. `git diff --check` passed.

**Changed files:** `src/agent/specialist-review.ts`, `src/cli.ts`, `test/specialist-review.test.mjs`, README, architecture, TRD, implementation plan, and this tracker. Commit: `ccf97ca`.\n\n**Remaining:** Browser/data specialist integrations are not implemented.

### Phase 8 — Release gate — IN PROGRESS

**Goal:** Complete a clean Windows consumer trial, workflow documentation, contribution guide, license/dependency review and distribution checks.

**Acceptance checks:** Another developer runs documented scenarios and all required checks are recorded. Release by clone first. npm publication requires tarball consumer verification and explicit publication authorization; check package naming before release.

#### Phase 8.1 — Package metadata and Windows consumer smoke — COMPLETE (offline cached consumer)

Added the MIT license and verified GitHub repository URL to package metadata and the lockfile. The generated local tarball installed offline in a temporary Windows consumer using 240 cached packages; its generated `taskforge.cmd` returned version `0.1.0` and help including `run research`. A full `npm ls --prefix <consumer> --omit=dev --all --json` dependency-tree check exited 0 and counted 554 installed dependency nodes. The temporary consumer was removed. The package dry-run contained 33 files and no `.env` or test/tracker files. No package was published. This verifies the cached offline consumer path; it does not establish a clean online install on another developer's machine.

**Dependency review at this checkpoint:** `npm audit --omit=dev --audit-level=high` passed with 0 reported production vulnerabilities. The then-current production tree included deprecated transitive `glob@7.2.3` and `inflight@1.0.6`; `buffers@0.1.1` and `png-js@2.0.0` lacked license metadata. `jszip@3.10.2` declares `(MIT OR GPL-3.0-or-later)`. Phase 8.4 records the subsequent remediation and current evidence.

#### Phase 8.2 — Contributor guidance and package-content check — COMPLETE (documentation slice)

Added `CONTRIBUTING.md` with Windows/Node setup, isolated test database instructions, quality gates, strict TypeScript requirements, consent boundaries and local-only checkpoint rules. `npm pack --dry-run --json` completed after the sandbox denied its npm cache write; the escalated read-only retry listed 33 package files including the new research adapter in `dist`, with no `.env`, tests or tracker files. `npm ls --omit=dev --all` exited 0; npm reported unmet optional platform/provider packages that are intentionally optional. `git diff --check` passed.

**Pending at this checkpoint:** Dependency remediation is complete in Phase 8.4; obtain another developer's documented workflow trial. Phase 8 remains incomplete.

**Dependency review follow-up at this checkpoint:** `npm ls --omit=dev --all` exited 0. `buffers@0.1.1` was reached through ExcelJS to unzipper to binary and lacked license metadata or a package license file. `png-js@2.0.0` has no SPDX field but its installed upstream license text states MIT. `glob@7.2.3` and `inflight@1.0.6` were deprecated transitive packages in the ExcelJS archive path. `jszip@3.10.2` explicitly allows an MIT or GPL-3.0-or-later choice; TaskForge selects MIT and records that in `THIRD_PARTY_NOTICES.md`. Phase 8.4 remediates the ExcelJS chain. These are inventory notes, not a legal determination.

#### Phase 8.3 — Independent developer trial — PREPARED, PENDING EXTERNAL TRIAL

Added `DEVELOPER_TRIAL.md` as a clean Windows clone checklist covering install, strict TypeScript, local configuration, isolated MongoDB workflows, document fixtures, scheduling and optional Groq. Another developer must complete it; no external trial is claimed.

#### Phase 8.4 — Production dependency remediation — VERIFIED, TRIAL PENDING

Added ExcelJS-scoped overrides to `archiver@7.0.1` and `unzipper@0.12.5`, plus a `glob@13.0.6` override for archiver-utils. This removes `buffers@0.1.1` (missing license metadata) and the deprecated `glob@7.2.3`/`inflight@1.0.6` chain. The selected archive dependencies declare MIT; glob 13 declares Blue Oak Model License 1.0.0 and its required license URL is recorded in `THIRD_PARTY_NOTICES.md`. The existing `png-js` upstream MIT text and selected JSZip MIT option are also recorded.

**Checks:** `npm install --ignore-scripts` completed and audited 0 vulnerabilities; `npm audit --omit=dev --audit-level=high` reported 0 production vulnerabilities; `npm ls --omit=dev --all --parseable` exited 0. `npm explain` resolves glob only through archiver-utils and the production tree contains no `buffers` or `inflight`. Strict TypeScript and the full isolated MongoDB suite passed (91 passed, 0 skipped, 0 failed), including synthetic XLSX generation, DOCX/XLSX extraction, malformed/oversized/formula-bearing workbook rejection, and parser integration. `npm pack --dry-run --json` listed 36 files, includes `THIRD_PARTY_NOTICES.md`, and excludes `.env`. Another developer's trial remains external and pending, so Phase 8 remains IN PROGRESS.

**Security note:** The unzipper GitHub advisory is internally inconsistent: its title says affected versions through 0.12.4, its affected-version body says through 0.12.3, and it lists no patched release. Installed 0.12.5 is outside both ranges but upstream does not explicitly certify it as patched. ExcelJS uses unzipper's streaming parser; the advisory discusses the filesystem extraction API. The distinction and upstream reference are documented in `THIRD_PARTY_NOTICES.md`; recheck before release.

#### Phase 8.5 — Full dependency inventory and package consumer review — COMPLETE

Replaced ExcelJS as the runtime XLSX reader with the existing bounded ZIP/XML stack. ExcelJS is now development-only and generates synthetic test fixtures; the runtime parser follows workbook worksheet relationships, applies archive/XML/cell/output limits, and accepts custom worksheet part filenames while rejecting traversal and unsupported cell content. THIRD_PARTY_NOTICES.md distinguishes fixture tooling from production consumer dependencies.

**Checks (2026-10-14):** `npm run typecheck` and `npm run build` passed. The full suite passed serially with `TASKFORGE_TEST_MONGODB_URI` set to a dedicated loopback test database: 127 passed, 0 skipped, 0 failed. One parallel `npm test` run hit a 10-second spawned-CLI timeout in an unrelated CSV CLI test; that test passed alone, and the full serial rerun passed. Focused XLSX tests passed (8/8), covering custom worksheet filenames, explicit `t="n"` values, and built-in/custom date formats with both date systems. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` reconciled the lockfile; `npm ls --omit=dev --all --parseable` passed. Full and production-only `npm audit --audit-level=high` each reported zero vulnerabilities. A fresh temporary Windows consumer installed 48 production packages; its production tree passed, `npm query '#deprecated'` returned `[]`, ExcelJS was absent, and `taskforge.cmd` version/help checks passed. The final package contained 39 files with no `.env` or tests. The live synthetic Groq check passed with one tool action and two requests; Ollama and the existing `qwen3:4b-q4_K_M` model were confirmed live without downloading anything. The configured MongoDB doctor ping passed outside the sandbox after the sandbox attempt timed out. Independent review confirmed the custom worksheet-name and dependency/notices fixes; the parser still deliberately rejects root-absolute and percent-encoded worksheet relationship targets. `git diff --check` passed.

**Release status:** Phase 8.5 package and dependency review is complete. Phase 8 remains IN PROGRESS because the independent developer trial is external and pending.

## Prerequisite checklist milestone

**Status: COMPLETE (documentation and prerequisites).** Added root `setup-checklist.md` and placeholder-only `.env.example`; the real `.env` remains ignored. The owner corrected the Atlas URI locally; redacted authenticated ping passes and no IP access-list or database-user changes were made. Local MongoDB responds to ping and passes isolated workflow integration checks. The synthetic Groq model-check passes. PDFKit, PDF.js, XLSX and DOCX dependencies are installed and bounded parser cores pass. Ollama is installed and the Phase 2 live trial used the already-downloaded qwen3 model; no additional model was downloaded. Remaining optional-provider choices and limitations are in the checklist.

## Recovery

- **Recovered checkpoint:** Base commit 771839f (Phase 6.5: compare sourced research results). The initial working tree had four unstaged changes in `DEVELOPER_TRIAL.md`, `THIRD_PARTY_NOTICES.md`, `src/documents/xlsx-parser.ts`, and `test/xlsx-parser.test.mjs`; there were no staged or untracked files. The package metadata, lockfile, tracker, and implementation plan were changed while completing verification.
- **Verified recovery:** Phase 8.5 is now complete in this local checkpoint. Strict TypeScript, build, all 127 tests with isolated loopback MongoDB, the live synthetic Groq model-check, package audits, a fresh tarball, and a production-only Windows consumer install passed. The package consumer contains no ExcelJS or deprecated packages. Ollama and the previously downloaded qwen3 model were live; no model was downloaded. Exact evidence is in Phase 8.5.
- **Historical requirements authority (superseded 14 October 2026):** The MongoDB-only requirement was the last recorded choice at that checkpoint. The owner subsequently approved local persistence by default with optional MongoDB, guided setup/Windows bundled runtime, evidence-based architecture reports, and read-only GitHub/Vercel deployment tracing. Current code remains Mongo-only until those phases are implemented; no automatic migration, deletion, or silent fallback is allowed.
- **Remaining release work:** Phase 6 real-site acceptance requires an owner-approved target and journey; broader browser acceptance remains pending. Phase 7 browser/data specialist integrations are future work requiring separate scoped tool contracts and review. Phase 8.3 requires another developer to complete DEVELOPER_TRIAL.md. Phase 8 remains IN PROGRESS; mocked checks do not satisfy live acceptance or the independent trial.
- **Services and safety:** The registered MongoDB service was already running and the loopback ping succeeded; the configured MongoDB doctor ping also succeeded outside the sandbox after the sandbox attempt timed out. Ollama was already responding with qwen3:4b-q4_K_M installed. No unrelated process was stopped, no provider was switched, and no secret values were printed. No push, publication, or deployment was performed.
- **Next action:** Await an owner-approved real-site target/journey and an independent developer trial; clarify whether browser/data specialist integration slices should enter first-release scope before designing their permissions and data-transfer boundaries.

#### Phase 4.14 — Approved exact-file move — COMPLETE

Added `run file-move --source <file> --target <new-file>` for matching TXT, Markdown, CSV, PDF, DOCX, and XLSX suffixes. Requires durable read and write scopes for the source folder, durable write scope for the destination folder, and interactive confirmation of exact canonical paths, byte count, and source SHA-256. It refuses existing targets and uses create-only same-volume hard-link creation, verifies destination identity and content, rechecks source identity, then removes the source. Cross-volume moves are unsupported; a failed operation retains the source whenever possible and only cleans a destination whose identity matches the opened source.

**Checks:** `npm run typecheck` and `npm run build` passed; focused permission/CLI tests passed (12/12); full isolated MongoDB suite passed after review fixes (108 passed, 0 failed, 0 skipped); `git diff --check` passed. Independent review found and cleared destination revalidation and post-mutation close-reporting issues. Commit: `f10d59e`.


#### Phase 6.3 — Local accessibility, responsive, and passive security observations — COMPLETE

Extended loopback run browser-audit to report HTTP errors, same-origin request failures, existing bounded link checks, console/page errors, missing image alt text, unnamed controls, desktop/mobile horizontal overflow, and presence of three passive response headers (CSP, X-Content-Type-Options, Referrer-Policy). It labels mixed-content checks as skipped because only HTTP loopback targets are accepted. Results and MongoDB summaries remain aggregate-only; no page content, URL, link, screenshots, or console text are persisted. These are bounded heuristics, not WCAG compliance or a security certification. Real-site journeys and broader design-system inference remain pending owner target/journey scope.

**Checks:** `npm run typecheck`, `npm run build`, focused browser fixture tests (5/5), and the final full isolated MongoDB suite (110 passed, 0 failed, 0 skipped) passed. The fixture verified HTTP 404 and actual socket failure counts, broken local link, console error, policy-block accounting, accessible-name and hidden-control behavior, mobile overflow, missing passive headers, explicit mixed-content skip, and no persisted target/page text. Socket-reset integration verified failed run state and `run_failed`; exit mapping tests confirm CLI code 3 for failed and 0 for completed. Independent review confirmed all findings resolved.

#### Phase 5.7 — Explicitly selected Node test execution — COMPLETE

Extended `run software-check --check node-test` with optional `--test <relative-file>`. The selector accepts one existing regular `.js`, `.cjs`, or `.mjs` file under the approved root, rejects absolute paths, traversal, missing files, unsupported suffixes, symlink files, and all test-runner arguments. The exact selected relative path appears in the second operation-approval prompt. The runner executes Node directly with `shell: false`; persisted metadata distinguishes selected-test from full-suite runs without storing paths or output. It snapshots selected test size, modified time, identity, and SHA-256, then revalidates all of them immediately before spawning. A changed target records failed/could_not_start and is not executed.

**Checks so far:** `npm run typecheck`, `npm run build`, and focused software/permission tests passed (8/8). Fixtures proved a selected passing file runs while an unrelated failing file is excluded; traversal, absolute, missing, wrong-suffix selections and noninteractive CLI use are refused. A race fixture replaced the approved parent directory with an outside junction between initial validation and execution; revalidation refused it and the outside marker was not created. Independent review confirmed no remaining findings; final full isolated MongoDB suite passed (113 passed, 0 failed, 0 skipped), as did `git diff --check`.

#### Phase 4.15 — Document aggregate report exports — COMPLETE

Added `run document-analyze --input <path> [--output <new.json|new.csv|new.md>]`. Exports contain only the validated document format and parser counts; document content, absolute paths, spreadsheet names, and cell values are excluded. Output requires the existing persistent folder write grant and a TTY preview with canonical target path and SHA-256 confirmation; it uses create-only hash-verified output and saves a metadata-only artifact reference linked to the completed document run. Invalid formats are rejected before input access; cancellation leaves the completed analysis intact without creating a report. Phase 4 is COMPLETE for declared v1 workflows after the reconciliation below.

**Checks:** `npm run typecheck` and `npm run build` passed. Focused document export/parser tests passed (6/6), including JSON/CSV/Markdown content boundaries, malformed metric rejection, unsupported suffix refusal before input access, and document parser behavior. `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_test npm test` passed against the dedicated isolated MongoDB integration harness (116 passed, 0 failed, 0 skipped); integration verified document-analysis artifact type linkage and rejected a CSV artifact linked to a document run. Independent permission-focused review found no actionable findings. `git diff --check` passed. Commit: `f5ffdbe`.

#### Phase 5.8 — Approved TypeScript build execution — COMPLETE

Adds a fixed `typescript-build` option to `run software-check`; it invokes only the repository-local compiler after the existing root and command approvals. A read-only `tsc --showConfig` check rejects `outFile`, trace, and CPU-profile output options. Normal emits and conditional declarations/build-info are redirected to a new `.taskforge-build-*` directory under the approved root; the directory name is ignored by Git. This is not an OS sandbox and build configuration/repository code remains executable input.

**Checks:** `npm run typecheck` and `npm run build` passed. Focused reviewed-command tests passed (5/5). The full isolated MongoDB suite passed (118 passed, 0 failed, 0 skipped), including a real project build through the persisted reviewed-command path. Independent permission-focused review found no remaining issues. Commit: `a14c4e1`.

#### Phase 5.9 — Temporary TypeScript build artifact lifecycle — COMPLETE (full-suite follow-up in Phase 8.8)

The reviewed build runner now owns a unique ignored output directory, keeps it under the approved repository so emitted ESM resolves repository dependencies, and removes that exact directory after success, compiler failure, timeout, explicit cancellation, or an exception in run recording when its UUID-bound owner marker and generated-only contents still validate. The CLI propagates Ctrl+C cancellation to the child process. On a later build, stale cleanup considers only directories older than 24 hours with a matching marker, a confirmed-dead PID, and generated-only regular files. Active owners, malformed markers, symlinks, and mixed content are retained. The npm package allowlist excludes these temporary folders.

**Checks:** `npm run typecheck`, `npm run build`, focused `node --test test/reviewed-command.test.mjs` (5/5), the final strict build within `npm test`, and `git diff --check` passed. An initial full-suite attempt ended with 148 passed, 2 failed, 1 skipped after subprocess timeouts at their unchanged limits under high system load; the Mongo integration was skipped because `TASKFORGE_TEST_MONGODB_URI` was absent. Phase 8.8 later reran both affected CLI checks successfully in the full serial suite, with the dedicated Mongo integration enabled: 152 passed, 0 failed, 0 skipped. No assertions or timeout values changed. Fixtures verify success/failure/cancellation/interruption cleanup, reaping of an old dead-owner build, retention of an active-owner directory and a mixed directory containing a JSON report. `npm pack --dry-run --json` using a task-scoped temporary npm cache completed with no build directories in the package file list. The root had 35 legacy `.taskforge-build-*` directories (34 with compiled JS, one empty); `git ls-files` found none tracked and `git check-ignore` confirmed they are ignored. Windows denied process command-line inspection and several Node processes were present, so these legacy unmarked folders cannot be safely certified inactive. They were preserved; no user data or build folders were deleted. No intentional build output is retained by new runs. Independent lifecycle review found no remaining code concerns.

**Follow-up status (2026-10-14):** The earlier timeout failures described above were rerun and resolved as environmental load sensitivity in Phase 8.8. The full serial suite passed 152/152 with the isolated MongoDB integration enabled; this phase is COMPLETE. No timeout or assertion was changed.

**Phase 4 acceptance reconciliation:** The PRD's declared files/data workflows are covered by bounded folder inventory (`repo-inspect`, Phase 5.1), supported-format reading and metadata summaries (4.7), deterministic CSV analysis and exports (4.1, 4.10–4.13), create-only PDF/document outputs (4.8, 4.12, 4.15), and consented exact-file moves (4.14). OCR, legacy formats, unsupported office features, and generalized arbitrary-folder organization remain explicitly unsupported, rather than implied.
## Recovery checkpoint - 14 October 2026

### Phase 6.6 - Approval-controlled public website URL auditing - IMPLEMENTATION COMPLETE (live acceptance recorded separately)

Added `run browser-audit --url <public-https-url> --journey '<json-array>' [--origin <https-origin>]...`. Before navigation it requires interactive approval of the exact target URL, read-only journey, and additional resource origins. Supported steps are exact visible text, constrained one-field same-origin GET search, first visible Harry Potter result link, ordinary anchor, and browser back; forms are never submitted. Uses fresh unauthenticated Chromium, no stored browser credentials, HTTPS/443 only, DNS resolution with rejection of any private/internal answer and numeric-IP pinning, exact origin allowlists, GET/HEAD only, service-worker/WebSocket blocking, and caps of 100 requests, 20 MiB, eight tunnels, and 45 seconds. It reports browser-observed console/page errors, failed requests, bounded same-origin broken links, basic accessibility heuristics, viewport overflow, mixed-content and passive response-header observations, bounded visual style consistency observations, and local journey evidence. Blocked origins are shown without paths or queries and are not accessed until approved. Persisted data and specialist handoff exclude page text and origins. These checks are not comprehensive security or accessibility certification.

**Checks:** `npm run typecheck` and `npm run build` passed. Focused checks cover browser audit, egress proxy, data evidence, and specialist orchestration. The new integrated Chromium fixture routes actual browser HTTPS requests through the TaskForge egress proxy to a controlled local TLS server. It verifies GET search, opening a book-details link, browser back, DNS pinning, and blocking an unapproved telemetry origin before access. Its self-signed key/certificate are documented as disposable test-only material. Live owner acceptance is in Phase 6.7 below.

### Phase 7.6 - Browser and data specialist integration - COMPLETE for approved bounded workflow

Added browser/data specialist roles under the existing read-only specialist engine. Browser handoff contains aggregate audit metrics and coverage limits. Data handoff parses supported CSV, XLSX, PDF, DOCX, text, and Markdown locally, applies bounded heuristic redaction, omits source paths/filenames, and previews the exact outgoing evidence. Both online and local-provider handoffs require explicit approval; Groq remains the default, provider selection is unchanged, and no additional provider/model was introduced. Worker and parent share at most 40 model requests, 30 tool actions, a 120-second deadline and zero automatic retries; cancellation waits for in-flight workers, and parent review remains mandatory. Results are unverified proposals and are not persisted.

**Checks:** Integration is covered by fixture-backed browser workflow to specialist to parent review, locally parsed data evidence to specialist to parent review, worker failure/cancellation/budget tests, and refusal without interactive transfer approval. The focused 34-test set passed. Existing schedule acceptance remains: one-time and recurring schedules, execution only while foreground runner is active, missed-run skip/record, awaiting-approval when unavailable, renewed approval per run, revalidation on resume, and list/pause/delete.

### Scope and release reconciliation

MongoDB was the sole implemented/approved persistence choice at this checkpoint; the owner later approved the expanded scope documented in Phase 9 below. Deployment actions remain deferred. Phase 8 remains IN PROGRESS: another developer must complete `DEVELOPER_TRIAL.md`; Codex/subagent review does not satisfy that trial.

**Recovery state:** Last verified base commit was `dc58ff7` (`Phase 8.5: record configured MongoDB check`); its initial tree was clean. Integrated Phase 6.6/7.6 work and Phase 8.6 verification passed and were committed locally as `fc137e4` (`Phase 6.6-8.6: add approved audits and specialist integrations`). MongoDB and Ollama were already live; configured provider checks exposed no credentials, no unrelated process was stopped, and no model was downloaded. No public site was visited, and no push, publish, deploy, or message was performed.

**Remaining acceptance:** Live Phase 6 acceptance still needs the owner URL/journey and any additional origins; Phase 8 completion still needs another developer's independent trial.

### Phase 8.6 - Integrated release verification - VERIFIED (independent trial pending)

**Checks (2026-10-14):** `npm run typecheck` passed; `npm run build` passed. The full serial suite passed against disposable loopback database `taskforge_recovery_20261014_phase67_rerun`: 149 passed, 0 failed, 0 skipped; the suite's live isolated MongoDB persistence test passed. An initial run reported 148/149 because the doctor-output assertion still expected the old wording; after updating that assertion, the full rerun passed. Focused browser/proxy/data-specialist tests passed 34/34 before the added DNS-metric regression; the full rerun includes that new test. `git diff --check` passed.

`npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high` each reported 0 vulnerabilities. `npm ls --omit=dev --all --parseable` exited 0; `npm query '#deprecated'` returned `[]`. `npm pack --dry-run --json` succeeded with 41 files (including `THIRD_PARTY_NOTICES.md`; no tests or `.env`). npm initially could not write logs in the configured user cache; using a task-scoped cache under `%TEMP%` completed the package inspection. The earlier fresh production-only Windows consumer install remains recorded in Phase 8.5.

The synthetic live Groq check passed with one tool action and two model requests. Ollama API responded and the existing `qwen3:4b-q4_K_M` was present; no model was downloaded. Local MongoDB integration passed against the disposable database. The configured MongoDB doctor ping was unavailable even outside the network sandbox; it reports only a generic unavailable status. No credentials or connection strings were emitted. No provider was switched.

Independent review of Phase 6/7 found and resolved a DNS metric issue. The later Phase 6.8 checkpoint closes the prior Chromium-through-proxy integration gap with a controlled end-to-end fixture; the owner-approved live target still did not expose an app UI, as recorded in Phase 6.7.

**Release status:** Phase 8 remains IN PROGRESS because another developer must complete the independent trial in `DEVELOPER_TRIAL.md`. A subagent review is not that trial.

Fresh-consumer verification against the current tarball also passed: a temporary Windows consumer installed 48 production packages with `--omit=dev --ignore-scripts`; `taskforge --version` returned 0.1.0 and `taskforge --help` listed both new commands. The configured npm user-cache directory denied log writes, so packaging/install checks used a task-scoped cache under `%TEMP%`.

### Phase 6.7 - Owner-approved live website acceptance - IN PROGRESS (unauthenticated route reaches login gate)

The owner approved `https://the-bookfinder-v2.vercel.app/` and a read-only journey: homepage, search “Harry Potter”, inspect results/open one detail if supported, return. No login, registration, favourites, or state-changing action was authorized. The audit used fresh unauthenticated Chromium, target-origin-only approval, and a dedicated local MongoDB database `taskforge_live_audit_20261014`; the normal configured database was not used. No additional resource origins or redirects were observed.

**Initial observation (superseded by Phase 6.9):** The first attempt in the restricted sandbox failed at the tunnel. After network escalation, the audit at `/` checked immediately after `DOMContentLoaded`, observed an empty body, and reported no controls. It did not record the response status, final route, or wait for client hydration. The earlier conclusion that the site exposed no UI was premature. No additional origin was accessed.

### Phase 6.8 - Chromium-through-proxy integration verification - VERIFIED

The controlled end-to-end TLS fixture demonstrated real Chromium CONNECT traffic through the egress proxy, numeric public-address pinning, same-origin search and details navigation, and browser return. An unapproved telemetry origin was recorded as blocked and never reached. The initial fixture exposed that Chromium's DNS resolver rule also blocked the local proxy; exempting only `127.0.0.1` restored proxy connection while other hostnames remain unresolved outside the pinned proxy. The integrated regression now passes. The initial live tunnel failure came from the restricted network environment and cleared after network escalation; the target subsequently loaded an empty/unrecognized document.

### MongoDB recovery diagnostics - CONFIGURED ENDPOINT BLOCKED; LOCAL TEST DATABASE VERIFIED

Redacted checks found the local MongoDB Windows service running and a local Node TCP/MongoClient ping succeeding against a diagnostic-only database. The configured endpoint uses SRV discovery; resolving its `_mongodb._tcp` record timed out before any remote TCP connection or authentication attempt. No credentials, URI, or connection string were printed or modified. This does not establish a bad password or access-list failure; the configured endpoint remains unavailable pending working DNS/network access. Database workflow verification uses a separate disposable loopback database, not normal application data.

**Current pending items at this historical checkpoint:** The approved BookFinder discovery journey remained incomplete because the fresh unauthenticated `/discover` visit reached `/login`; the owner-confirmed signed-in screenshot and later manual-login flow are recorded below. Phase 8 remains IN PROGRESS until another developer completes `DEVELOPER_TRIAL.md`; agent review does not replace that trial. The owner later approved the expanded development areas in Phase 9; this earlier note does not describe their current implementation status.

### Phase 6.9 - Reconcile /discover unauthenticated inspection and hydration - VERIFIED (live journey remains pending)

The owner reported that `/discover` displayed filters/search but no results, conflicting with the earlier empty `/` audit. Compared exact URLs in separate fresh Chromium contexts with empty cookies/storage and target-origin-only egress. `/` returned HTTP 200 and remained visually empty at `DOMContentLoaded`; after a bounded 2.5-second observation it rendered the unauthenticated home UI (title `BookFinder | Find Your Next Favorite Read`, 1 heading, 2 main landmarks, 2 buttons, 6 links). The captured desktop screenshot is stored outside the repository at `%TEMP%\taskforge-bookfinder-root-20261014.png`.

`/discover` returned HTTP 200, then the client changed the final path to `/login` (no network redirect observed). The rendered login screen was captured at 1280x800 in `%TEMP%\taskforge-bookfinder-discover-login-20261014.png`. The final DOM had 1 heading, 0 main landmarks, 1 form, 0 search controls, 3 non-hidden inputs (including a password field), 3 buttons, and 2 links. Across the browser load, six same-origin resources (document, script, stylesheet, image, and two fonts) returned 200 in the bounded comparison harness; no extra origin was requested or discovered. The TaskForge audit observed HTTP status 200, final path `/login`, 0 navigation redirects, an authentication gate, and 0/5 journey steps completed; all five were marked blocked by the gate. It did not enter credentials or continue through account actions. It observed 0 HTTP errors, 0 console errors, 0 page errors, 0 missing image alt attributes, 0 unnamed visible controls, no horizontal overflow at 360px or 1280px, and 3/3 selected passive response headers missing. Its two same-origin link probes (`/forgot-password` and `/signup`) ended `net::ERR_ABORTED`, while reporting 0/2 broken links. Sampled design evidence included 1 form, 3 buttons, and 2 links; 2/3 sampled buttons and 1/2 links shared their dominant style signature. These observations concern the login gate, not the intended discovery/results screen.

**Cause assessment:** The exact route and unauthenticated state differ from the earlier `/` observation, and `/` also hydrates after `DOMContentLoaded`. TaskForge previously inspected immediately, discarded status/final path, then continued a journey after the route had reached login; this made the empty result misleading. It now waits up to 2.5 seconds for the requested visible journey target, reports local-only HTTP/final-path/wait evidence, detects visible password fields before/after target waits, and stops the journey without submitting or navigating when an authentication gate appears. A delayed-hydration controlled Chromium-through-proxy fixture and a password-form-plus-searchbox auth-gate fixture verify these cases. The live unauthenticated result suggests the observed UI in the owner's browser may depend on a different session/state or delivery timing; that difference is not yet proven. No BookFinder code was changed, no credentials/session were reused, and no extra origin was accessed.

**Checks (2026-10-14):** `npm run typecheck`, `npm run build`, `node --test test/browser-audit.test.mjs` (10/10), `npm test` (150 passed, 0 failed, 0 skipped), and `git diff --check` passed. Mongo-backed suite used isolated loopback database `taskforge_recovery_phase69_20261014`. The integrated Chromium-through-proxy fixture verifies 200 response status, delayed hydration, same-origin search/details/back, an unauthenticated route change to `/login`, and fail-closed behavior when password-field enumeration exceeds its 20-field bound. Independent code review found no remaining actionable issue in the changed workflow, CLI, and fixture. Strict TypeScript remains enabled. No TaskForge database, provider, or BookFinder application data was modified. Live journey acceptance remains pending until the owner’s reported UI can be reconciled with a fresh unauthenticated visit; any future additional origin must receive separate approval before access.

The bounded render and unauthenticated gate observations are locally verified; password-field scan overflow now fails closed with an explicit incomplete-coverage reason and a controlled regression fixture. The temporary screenshot callback was removed after evidence capture. Final checks passed and this checkpoint was committed locally as `d8d9a6c` (`Phase 6.9: reconcile unauthenticated discovery inspection`).

### Phase 6.10 - Autonomous bounded website failure diagnostics - IMPLEMENTATION VERIFIED

**Approved requirement:** After approval of the exact public target and read-only journey, “audit this website” automatically performs bounded page-load diagnosis without requiring the owner to enumerate each diagnostic step. Capture a local screenshot and capped initial/final DOM summaries; inspect status, console, same-origin network/data failures, authentication gates, blocked resources, and safe same-origin route availability; investigate missing page content and distinguish observed failures from suspected causes. Keep page-originated content untrusted: it cannot alter journey, target, origin approvals, or permissions. Continue enforcing the fresh unauthenticated context, DNS-pinned origin allowlist, GET/HEAD only, existing request/byte/tunnel/runtime limits, form blockers, and no state-changing actions. Suggest an additional-origin approval only when a blocked fetch/XHR plausibly relates to missing results; never access it before exact owner approval.

**Implementation verified:** The browser workflow automatically captures up to two viewport screenshots (4 MiB each), initial/final DOM summaries (2,000 elements per walk and 240-character text sample), console/page/network failures, authentication gates, and up to ten final-page same-origin HEAD route probes. Password detection and rendering waits use bounded DOM traversal; auth scanning stops after 20 password fields or 2,000 elements. DOM and text truncation are explicit; incomplete samples cannot be labeled empty or support missing-result hypotheses. Screenshots are create-only files in a generated OS temporary folder; screenshots and DOM samples are excluded from persistence and provider handoff. Accessibility, visual samples, and link inventory are also bounded. Observed failures and suspected causes are separate. HEAD route-probe failures are distinguished from page data-request failures so TaskForge's own diagnostics cannot imply a missing-data cause. Page-provided links are followed/probed only on recognized content routes without common mutating route terms; unknown or suspicious paths are skipped. Same-origin requests with mutating route terms are blocked and reported separately. This heuristic cannot establish server-side GET semantics. Public document navigations use `route.fetch({ maxRedirects: 0 })`; any HTTP redirect is blocked before Chromium follows its destination, including same-origin redirects. Redirect-based login/CDN flows are unsupported and reported as coverage limitations. The integrated proxy fixture approves a separate public API origin for resources and proves that a document redirect to it is not contacted. Blocked-resource inventory is separate from valid public HTTPS data-origin candidates; candidates are shown only when blocked fetch/XHR coincides with absent cards after complete DOM sampling and no auth gate, and still require a new exact-origin approval. HTTP, private/reserved, and opaque origins cannot be suggested for approval. Webpage content cannot alter target, journey, origin approvals, or permissions. No arbitrary speculative navigation or state-changing request methods are used. The request method and path heuristics cannot prove that unknown server-side GET handlers are side-effect-free; reports preserve this limitation rather than claim a general read-only guarantee.

**Controlled checks:** Fixtures verify an HTTP 200 empty body, a DOM/text sample beyond the 2,000-node caps, delayed rendering, a same-origin `/api/books` 503, an unauthenticated password gate, a blocked unapproved public data origin, a blocked private-IP data request, and a mutating-looking book link/request that is never accessed. The integrated Chromium-through-proxy fixture also exercises the approved search/details/back journey and verifies unapproved resources are never reached. Private/HTTP origins are excluded from the approval-candidate list. Independent review found and resolved misleading blocked-origin CLI wording, unbounded password scanning, truncated-page misclassification, and page-provided mutating-link access; a final independent review is recorded below. Screenshots and short DOM samples do not persist or transfer to specialists.

**Approved live rerun (2026-10-14):** Fresh unauthenticated Chromium loaded exact URL `https://the-bookfinder-v2.vercel.app/discover`, HTTP 200, then the client changed path to `/login` without a network redirect. After 150 ms render wait and 929 ms bounded network settle, both DOM snapshots were the same login gate: one heading, one form, three visible inputs including password, three buttons, two links, no search control, and no result cards; neither DOM nor text sampling was truncated. A local temporary screenshot was captured and visually confirmed the login screen. All four approved journey steps stopped at the detected auth gate. Observed failures were the visible password gate; there were no HTTP, console, page, same-origin data/network, or broken-link failures. Two same-origin HEAD route probes ran; no unapproved external origins/resources or mutating-route requests were found. Accessibility heuristics reported 0 images missing alt and 0 unnamed controls. No horizontal overflow was observed at 360px or 1280px. Sampled visual-style consistency was 2/3 buttons and 1/2 links sharing their dominant style signature; the sampled CSS variables are observations, not recovered design tokens. No extra API/resource origin was discovered, so none was accessed or requires approval. Earlier fresh-context `/` evidence showed a blank DOM at `DOMContentLoaded` that hydrated into the home UI after bounded waiting; the earlier audit's immediate inspection therefore explains its empty-page report. The `/discover` discrepancy is consistent with the owner's browser having authenticated/persisted state or another delivery state, but that cause is not established without knowing the owner's session; it is not explained by blocked resources, delayed rendering on this route, or a TaskForge inspection failure. The audit is a website auth gate, not a TaskForge failure; no BookFinder code or data was modified. Live journey acceptance remains pending because search/results/details/back are still inaccessible in the approved unauthenticated context.

**Checkpoint status:** Phase 6.10 implementation and fixture acceptance are verified. Overall Phase 6 live acceptance remains IN PROGRESS pending resolution of the owner's reported session discrepancy and an accessible read-only search/results/details/back path; no credentials or personal browser state will be reused. Phase 8 independent developer trial remains pending. Final strict checks and commit are recorded in the next numbered checkpoint.

### Checkpoint 6.10.1 - Autonomous diagnosis and redirect boundary - VERIFIED

**Changes:** Public audits now perform bounded diagnostics automatically, including render/network settling, screenshots, capped DOM inspection, console/request evidence, authentication detection, responsive/accessibility/design heuristics, and safe same-origin route probes. Empty/truncated evidence is not mislabeled as missing data. Findings distinguish observations from hypotheses. Page text and blocked-origin observations cannot alter scope or permissions. Cross-origin resource suggestions remain conditional, public-HTTPS-only, and require a separate exact-origin approval. Top-level public document requests use Playwright `route.fetch({ maxRedirects: 0 })`; redirect responses are blocked before browser navigation. This prevents a resource-origin approval from authorizing a document redirect. Same-origin server redirects are also unsupported and reported as a limitation. The fixture permits the API host through DNS validation but verifies that a redirect to it is not requested. Common camel-case action terms such as `changeFavorite` are now caught by the mutating-route heuristic. Reports and documentation state that route/method heuristics cannot prove unknown server-side GET handlers are side-effect-free.

**Verification:** `npm run typecheck` PASS (strict TS); `npm run build` PASS; `node --test test/browser-audit.test.mjs` PASS (11/11, including integrated Chromium through the HTTPS egress proxy, empty responses, delayed rendering, failed data requests, authentication gates, blocked external resources, cross-origin redirect isolation, and unsafe route terms); `npm test` PASS (151/151; isolated MongoDB database `taskforge_phase610_20261014`); `git diff --check` PASS. An earlier focused run correctly exposed that `route.continue()` lets Chromium follow redirects without re-entering the route handler; implementation was changed to the first-response `maxRedirects: 0` path and the controlled proxy fixture now verifies the actual network boundary.

**Remaining acceptance:** BookFinder's approved fresh unauthenticated `/discover` audit still reaches `/login`, so its search/results/details/back journey is not verified. The earlier `/` blank report was explained by rendering before client hydration. Whether the owner's browser had signed-in or persisted state is unconfirmed; no browser session or credentials were reused and BookFinder was not modified. No extra API/resource origin was required or accessed. Redirect-based login/CDN flows and unknown server-side GET side effects remain explicit limitations. Phase 8 independent developer trial remains pending.

**Commit:** `90c7d05` (`Phase 6.10: add autonomous website diagnostics`), created locally after final review. No push was made.

### Phase 8.7 - Recovery, integration, and current release checks - VERIFIED (historical live observation superseded by Phase 6.9; external trial pending)

**Checks (2026-10-14):** `npm run typecheck` and `npm run build` passed with strict TypeScript. Focused browser/proxy tests passed 19/19, including the integrated Chromium TLS fixture and bidi-control evidence handling. The full suite passed serially with `TASKFORGE_TEST_MONGODB_URI` pointed at a dedicated disposable loopback database: 150 passed, 0 failed, 0 skipped. A captured parallel rerun also passed 150/150. An earlier parallel run under overlapping build/browser activity had 149/150; it did not reproduce in either later run. `git diff --check` passed. `npm pack --dry-run --json` included 41 files, including the updated workflow, README, and third-party notices; it excluded tests and `.env`.

The earlier approved live target navigation at `/` was inspected before client hydration and reported no visible elements. That observation was superseded by Phase 6.9, which found a 200 response, delayed root hydration, and `/discover` client-routing to `/login` in a fresh unauthenticated context. No additional origin was observed or accessed. Intended discovery/results accessibility, responsiveness, visual design, and journey acceptance remain unverified. The prior tunnel failure was the restricted-network environment and resolved by network escalation for this target.

The final review also bounded page-structure counts to the existing 2,000-element DOM walk, escaped Unicode format controls in local journey evidence, and recorded runtime-limited steps with reason codes. These values remain excluded from persisted summaries and specialist evidence. MongoDB diagnosis remains as recorded above: local service and isolated local ping succeed; configured SRV discovery times out before remote TCP/authentication. No dependency or provider changed; Groq remains default and the existing Ollama model was not downloaded again.

### Phase 6.11 - Dedicated ephemeral manual-login flow - IMPLEMENTATION VERIFIED; LIVE ACCEPTANCE PENDING

**Owner confirmation (2026-10-14):** The owner confirmed their BookFinder screenshot showing `/discover` search and filters came from a signed-in session. This explains the prior discrepancy with TaskForge's fresh unauthenticated `/discover` visit, which loaded HTTP 200 and client-routed to `/login`. This is owner-confirmed session-state difference; it is not a TaskForge inspection defect. Do not ask the owner to reconfirm this. BookFinder remains unmodified. The approved read-only journey is still not verified because the earlier unauthenticated browser could not access it.

**Implementation:** `run browser-audit ... --manual-login` launches headed Chromium with a fresh non-persistent context; no personal profile, imported storage state, or storage-state export is used. Credentials are entered by the owner in Chromium; TaskForge does not inspect or record request bodies/headers. Each new HTTPS origin requires a terminal approval before proxy allowlisting, with the existing public-IP DNS checks retained. Only a query-free POST to a recognized static authentication path can be considered, and each exact origin/path request is individually approved. Approval is rechecked after the prompt and the login phase is closed before queued requests are drained, so a queued POST cannot pass after freeze. GET forms, query-bearing or credential-like dynamic auth paths, other mutating methods, and all POSTs after login are blocked. Authentication POSTs use a single-hop fetch; redirect responses are aborted before Chromium can follow them, so redirect-based sign-in is unsupported. The workflow waits for pending approvals and bounded page/network settling, then requests a separate approval for the exact read-only journey. Manual mode suppresses screenshots, DOM/text snapshots, page-derived error/path details, responsive/accessibility/design/link inspection, and specialist handoff; persisted journey evidence is generic. The browser context closes on completion, refusal, failure, or cancellation. The website may retain server-side authentication state; an authentication path name does not prove server semantics.

**Controlled evidence:** Integrated Chromium-through-the-real-egress-proxy fixture covers a synthetic login form and in-memory session cookie, owner-approved query-free auth POST, query and dynamic credential-like path denial, auth redirect-to-mutating-route denial, separately approved journey, no authenticated DOM/screenshots/design/page text in returned metrics, and browser closure on both completion and declined login. Proxy fixture confirms a new exact HTTPS origin is unreachable before approval and DNS validation remains active after approval. Focused browser/proxy tests passed 21/21 after these changes. Strict typecheck and build passed. The fixtures use headless Chromium for repeatability; the actual headed owner prompt sequence and live site session have not been exercised. Live login and search acceptance remain pending owner operation; no live session or credentials were used.

**Build artifact and package audit:** `git ls-files` and `git ls-files -ci --exclude-standard` found no tracked generated build folder; tracked-name review found `.env.example` only among credential/session/build-like names. All 35 legacy root `.taskforge-build-*` folders remain preserved, ignored and untracked; active use cannot be ruled out because Windows denied process-command-line/handle inspection. No folder is confirmed safe to delete. `npm pack --dry-run --json` succeeded with 41 package files and zero generated-folder, credential/session, screenshot/report, or other private-artifact filename matches; package allowlist is `dist`, README, LICENSE, and third-party notices. Tests were excluded. Future TaskForge-owned build runs clean their own verified artifacts; uncertain legacy folders remain intentionally retained pending safe active-use evidence.

**CLI timeout diagnosis:** Two `test/permissions-cli.test.mjs` subprocess checks timed out at their existing five-second limit with `status=null`. Independent read-only diagnostics observed 11–13 Node processes, 99.1–100% CPU, and 82–219 MB free memory; Windows denied process detail inspection. The same checks passed in a focused retry with a 15-second temporary diagnostic limit (no timeout/assertion changes retained). This supports environmental resource contention as the likely cause, not a regression, but the required rerun after competing workload settles and the full serial suite against a dedicated isolated MongoDB database are still pending. No unknown processes were stopped.

### Phase 8.8 - Release recovery and full-suite follow-up - COMPLETE

**Verification (2026-10-14):** The suite already runs serially (`npm test` invokes `node --test --test-concurrency=1`). The previously failing selected-test refusal and TypeScript-build refusal cases reproduced once when isolated: both returned `status=null` at the unchanged 5-second `spawnSync` deadline. Running the selected-test CLI directly took 6.4 seconds while the build-refusal CLI took 1.9 seconds; both returned the expected exit code 2 and interactive-terminal message. After the serial suite completed, the focused pair passed 2/2 in 2.47 seconds total. Then `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_devpush npm test` passed all 152 tests, zero failed and zero skipped, in 167.4 seconds. The MongoDB integration test derives a fresh random database name from this loopback-only URI and drops its database on completion. Assertions and timeout values were not changed.

**Diagnosis:** These failures are environmental load sensitivity, not evidence of a CLI regression: direct CLI runs returned the expected behavior but startup time varied across the unchanged paths, the focused checks passed after the load-heavy suite, and both checks passed in the full run. Earlier diagnostics recorded high CPU load and several concurrent Node processes; process ownership could not be established, so none were stopped. The full serial rerun now clears this suite acceptance gate.

**Artifact audit:** Git reports no tracked generated build folders. The only tracked environment-file match is `.env.example`, which contains placeholders; no `.env`, session state, or real credentials are tracked. `dist`, `.taskforge-build-*`, and `.env` are ignored. `npm pack --dry-run --json` included 41 files and matched zero generated-folder, credential/session, screenshot/report, or private-key artifact names. Tests and the test-only TLS fixture keypair are excluded by the package allowlist. The tracked keypair is documented as disposable and local-fixture-only, not a real service credential. All 35 legacy root `.taskforge-build-*` folders remain preserved, ignored and untracked because active use could not be ruled out; no cleanup was attempted.

**Remaining acceptance:** Keep the independent developer trial pending until another developer performs it. Keep live BookFinder search/results/details/back pending until the owner uses the dedicated manual-login flow and separately approves the read-only journey; any newly observed origin must be approved before access. The confirmed signed-in screenshot explains the earlier route mismatch and must not be asked about again. No push has been made.

### Phase 8.9 - Current capability audit and owner walkthrough - COMPLETE (documentation; owner tests pending)

At that checkpoint, inspected planning documents, current CLI help and dispatch, workflow implementations, focused tests, and recorded live/fixture evidence. Added `CAPABILITY_AUDIT.md` with exact command inputs, setup and grants, outputs, evidence, status, limits, then-current proposal boundaries, and a synthetic PowerShell owner walkthrough. README recorded the then-current model-only chat, fixed workflows, Mongo-only persistence, and non-existent architecture/deployment features. The owner approved those expanded roadmap areas in the continuation below; capability implementation status remains accurately bounded by the audit. Clarified the earlier Phase 5.9 status using the resolved Phase 8.8 full-suite evidence.

**Verification:** `node dist/cli.js --help` passed and lists the current command families; `git diff --check` passed. This is a documentation-only audit; no external provider, public GitHub, or live website workflow was run. The recent full serial suite evidence remains 152/152 in Phase 8.8. Owner-operated BookFinder live journey and the independent developer trial remain pending.

## Approved scope continuation - 14 October 2026

Owner approved the 11 work areas and the development target Sunday 18 October 2026. The target is not currently credible for full verified completion: local/Mongo dual persistence, intent+tool chat, generated approved changes, stronger research citations, bundled Windows runtime, two authorized external services, BookFinder owner acceptance, and another developer's trial are distinct acceptance burdens. No scope or test gate is reduced. Continue through numbered phases and report unfinished work honestly. At recovery start, `origin/main` was at `c0b35cc` and 42 newer local commits were unpushed. Keep all subsequent verified work local; do not push without a new explicit request.

### Phase 9 — Requirements reconciliation — COMPLETE

**Goal:** Align root PRD, TRD, architecture, backend schema, app flow, implementation plan, tracker and README with the approved 11 areas, while keeping current implementation facts separate from planned work.

**Acceptance:** Documents agree on scope, dependency order, permissions/data/provider constraints and status vocabulary; current capabilities remain accurate; each future phase has concrete verification criteria and external human gates are not fabricated.

### Phase 10 — Local-default persistence with optional MongoDB — IN PROGRESS

Depends on Phase 9. The SQLite adapter and CLI backend selector now exist behind the adapter port. New installs select SQLite under OS application data; a configured Mongo URI preserves Mongo selection unless `TASKFORGE_STORAGE` explicitly chooses a backend. There is no migration, deletion, or fallback. Node 24.15 promotes `node:sqlite` to release-candidate status; the current Node 22.13 runtime emits an ExperimentalWarning. Runtime maturity, Windows privacy/durability, and bundled-runtime compatibility remain acceptance risks.

**Acceptance:** Adapter contract passes against isolated temporary local and disposable Mongo stores, including durability, malformed/versioned records, locking/concurrency, interrupted writes, outages and redaction. New-install local default and explicit Mongo use are proven. Data path, ACL/privacy, backup, restore, retention and recovery are documented.

#### Phase 10.1 — Backend-neutral store port — COMPLETE

Added `src/persistence/store.ts` as a public-operation persistence port and moved workflow, software-check, scheduler and CLI callback type boundaries to that port. At this subphase MongoStore remained the sole runtime factory. Updated the pinned Node type definitions to 24.19.2 so the built-in SQLite adapter can use its maintained strict types. Official Node documentation records `node:sqlite` as release candidate from Node 24.15; native package install risks were reviewed, so no runtime package/dependency was added.

**Verification:** `npm run typecheck` passed after the port and type-definition update; `git diff --check` passed. This is a type-boundary-only subphase; no runtime store behavior changed, so the latest full-suite evidence remains Phase 8.8 (152/152 with dedicated Mongo test DB). The local adapter, backend selector, parity suite, packaged Node 24 runtime, and all Phase 10 acceptance criteria remain IN PROGRESS.

#### Phase 10.2 — SQLite store and local-default selection — IMPLEMENTED; ACCEPTANCE PENDING

Added `SqliteStore` for the current `TaskForgeStore` method port using Node's built-in `node:sqlite`. It stores runs, events, checkpoints, schedules, approvals and artifact references, validates bounded values, redacts summaries, and uses `BEGIN IMMEDIATE` for mutations and schedule claims. The factory creates a per-user application-data directory; no path override is exposed. `TASKFORGE_STORAGE=local|mongodb` selects explicitly. Without a setting, no Mongo URI selects local SQLite and a configured Mongo URI retains existing Mongo behavior. The selected backend is shown with a redacted path/URI summary. The factory does not migrate or fall back. `.env.example`, README, capability audit, backend schema and app flow now reflect this behavior. Shared storage error messages are provider-neutral.

**Verification:** `npm run typecheck`, `npm run build`, and the configuration/SQLite/permissions checks passed (24/24). SQLite tests cover reopen persistence, version-mismatch and unrelated-database non-alteration, run state, event/checkpoint persistence, validation/redaction, scoped approvals, two-connection schedule claim behavior, repeated missed occurrences and pending-approval preservation, failed schedule outcomes, closed-store handling and malformed persisted records. CLI configuration/doctor tests prove new-install local selection, configured Mongo compatibility, explicit backend selection, URI redaction and fail-closed unavailable Mongo. The prior 160-case and 179-case results below are historical checkpoints. `node dist/cli.js --help` displays selected-backend wording. The latest package dry-run is recorded in `PHASE19_DISTRIBUTION_AUDIT.md`; it contains compiled `dist` files, not Node or browser runtimes. `git ls-files` found zero matching suspicious paths, and all 35 legacy `.taskforge-build-*` folders remain preserved. A shared contract now exercises run state/redaction, events/checkpoints, artifact references, folder grants and schedule status on both adapters; it does not cover all workflows. Windows ACLs, recovery/backup, interruption/version compatibility and packaged Node 24 runtime remain unverified. Overall Phase 10 remains IN PROGRESS.

#### Phase 10.3 — Shared adapter contract and local-default regression run — IN PROGRESS

Added `test/persistence-store-contract.test.mjs`, which runs the same core persistence contract against a disposable SQLite database and a uniquely named loopback Mongo database. The contract covers sanitized run summaries/state transition, event sequence, checkpoint round-trip/stale-hash rejection, artifact references, folder grant scope/revocation, schedule status and occurrence dispatch/release/recovery API/failure lifecycle (the adapter recovery call clears a matching claim; stale-age policy belongs to its caller), plus fresh and resumed CSV/document analysis and repository inspection on both adapters. A CLI doctor case verifies local storage opens only beneath its isolated `LOCALAPPDATA` root.

**Verification:** Focused contract passed 3/3. The first draft corrected two inaccurate expectations: stale checkpoint loads reject, and `setScheduleStatus` returns the updated schedule record. The integrated serial `npm test` passed **190/190, 0 failed, 0 skipped, 126.6 seconds** with `TASKFORGE_STORAGE=local`, `LOCALAPPDATA` set to a dedicated temporary test root, and `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_phase10_local_cli_20261017d`. Mongo integration derives and cleans its own database. This validates the explicitly isolated local CLI doctor path, selected workflow parity and direct Mongo integration. It is a bounded contract, not parity for every workflow or Windows durability acceptance. A read-only check of the current `%LOCALAPPDATA%` parent ACL found no Everyone, Authenticated Users or built-in Users entries; the TaskForge data directory does not currently exist, so this is parent-inheritance evidence, not a direct production-directory ACL test.

#### Phase 10.4 - SQLite interrupted-transaction recovery - VERIFIED; PHASE 10 IN PROGRESS

Added an isolated child-process fixture that opens a disposable SQLite database, starts a transaction, inserts an uncommitted run row, and exits unexpectedly. Reopening through `SqliteStore` preserves the previously committed row, does not expose the interrupted row, and reports `PRAGMA integrity_check = ok`.

**Verification:** `node --test test/sqlite-store.test.mjs` passed 9/9. The integrated serial `npm test` passed **193/193, 0 failed, 0 skipped, 129.4 seconds** with `TASKFORGE_STORAGE=local`, a dedicated temporary `LOCALAPPDATA`, and the loopback Mongo test base `mongodb://127.0.0.1:27017/taskforge_phase10_interruption_20261017`; Mongo integration used and cleaned its derived test database. This checks SQLite process-exit recovery for an uncommitted transaction. It does not simulate power loss or establish hardware/filesystem durability, production ACLs, backup/restore, or full workflow parity. Phase 10 remains IN PROGRESS.

#### Phase 10.5 — Cross-process SQLite claims and first-open checks — VERIFIED

Added isolated child-process tests for two processes claiming one due schedule and two processes opening a new SQLite database and persisting separate run records concurrently. The competing claim produces exactly one winner; concurrent first-open preserves both committed writes. The existing test fixture closes stores and removes only its own disposable directories.

**Verification:** `node --test test/storage/sqlite-store.test.mjs` passed 11/11. A dedicated Windows temp-root doctor/ACL probe found no broad `Everyone`, `Authenticated Users`, or built-in `Users` ACEs on either the isolated parent or created TaskForge data folder. The data folder inherited its parent ACL, so this is evidence about that disposable test path only, not the owner's real `%LOCALAPPDATA%` or a clean installed machine. The full serial suite passed 218/218 with isolated MongoDB and local temp data after one earlier transient 5-second help-subprocess timeout; the affected CLI test passed 4/4 alone and the unchanged full retry passed. A final stricter installed-task input check after that suite passed strict typecheck/build and focused agent tests 13/13. This does not establish power-loss durability, production ACL guarantees, backup/restore, or full workflow parity; Phase 10 remains IN PROGRESS.

#### Phase 10.6 — Atomic MongoDB run-event persistence — VERIFIED

New MongoDB run events are appended to a bounded `eventLog` on the run document, atomically with `eventCount` and `eventBytes`, using a compare-and-swap condition and bounded retries. Existing `run_events` collection entries remain readable and establish the sequence baseline; no migration or deletion is performed. Listing merges both formats and fails closed if a duplicate event identity has conflicting sequence or metadata. Stop older TaskForge processes before running an upgraded version against the same Mongo database; simultaneous old/new writers cannot coordinate across the old collection-write format.

**Verification:** Strict typecheck/build and `node --test test/storage/mongodb.integration.test.mjs test/storage/store-contract.test.mjs` passed (6/6) against isolated loopback MongoDB 8.2.0 and disposable test databases. The integrated serial `npm test` then passed **218/218, 0 failed, 0 skipped** in 199.0 seconds, using isolated local storage and a dedicated Mongo test database. Fixtures cover legacy read/append sequence continuation, same-version concurrent distinct appends, concurrent idempotent duplicate retries, conflicting duplicate rejection, the 300-event cap, and SQLite/Mongo shared-contract behavior. This addresses atomicity for new writes and same-version races; it does not repair sequence gaps left by older interrupted writes or establish power-loss, replica failover, backup/restore, production ACL, or complete workflow-parity guarantees.

#### Phase 10.7 — Concurrent MongoDB schedule-capacity enforcement — VERIFIED

MongoDB now assigns each new non-deleted schedule a unique bounded capacity slot under a partial unique index. Concurrent inserts that race for a slot retry; a concurrent insert that reaches the 500-schedule limit fails with the same input error as the local adapter. Deleting a schedule releases its slot. Existing schedules without slots remain counted, so this additive field/index requires no migration or deletion.

**Verification:** Strict typecheck/build passed; `node --test test/storage/mongodb.integration.test.mjs` passed 3/3. Its isolated loopback Mongo fixture includes a legacy paused schedule without a slot, races two inserts at 499 active schedules, verifies exactly one succeeds and the count remains 500, then verifies deletion allows one replacement. The integrated serial `npm test` passed **218/218, 0 failed, 0 skipped** in 169.6 seconds with a disposable `LOCALAPPDATA` and dedicated loopback Mongo database. This verifies the cap and same-version insert race; it does not establish power-loss durability, backup/restore, production ACLs, or full workflow parity. Phase 10 remains IN PROGRESS.

### Phase 11 — Validated declarative task registry — COMPLETE

Depends on Phase 9 and Phase 10 interfaces. Definitions include bounded instructions, validated inputs/outputs, fixed tool names, examples and tests; no arbitrary executable code. The verified registry includes the built-in catalog and safely installed local definitions. Registry definition execution remains outside this phase; routing and task execution are tracked under Phase 12.

**Acceptance:** Built-ins/examples load; malformed definitions, unknown tools and attempted permission escalation fail closed; runtime validation and intersection with the central tool allowlist are tested.

#### Phase 11.1 — Built-in validated task catalog — VERIFIED

Added three built-in data-only definitions for CSV summaries, repository inventory, and web research. Each declares bounded instruction text, typed inputs and outputs, fixed capability IDs, an example, and schema-level conformance cases. Runtime validation rejects unknown fields (including any attempted `permissions` or executable-code field), unknown tools, duplicate declarations, malformed input/output schemas, invalid examples, and invalid test inputs. Tool capabilities are intersected with both a central fixed catalog and explicit approvals. Added `tasks list`, `tasks inspect <task-id>`, and `tasks validate <task-id> --inputs-json <object>`; validation prints input field names and never echoes values.

**Verification at Phase 11.1:** `npm run typecheck`, `npm run build`, focused registry/CLI tests (6/6), and the full serial `npm test` passed (166/166, 0 failed, 0 skipped, 182.9 seconds). Tests reject permission injection and unknown tools, validate declared fields, exercise the tool capability intersection and CLI output redaction. They did not execute declarative conformance cases or any task workflow. At that checkpoint, the registry was static; the Phase 11.2 subsection below records the later local-definition implementation. Tasks still cannot be executed or selected by natural-language instructions; arbitrary executable extensions remain deferred.

### Phase 12 — Natural-language one-shot and tool-enabled chat — IN PROGRESS

Depends on Phases 10–11 plus existing approvals/budgets. Groq remains default; no silent provider change. Missing/ambiguous inputs are asked explicitly.

**Acceptance:** Tests cover intent selection, plan disclosure, missing-input questions, multi-turn continuation, approved tool result use, refusal, unknown intent, malformed tool call, provider/storage failure, cancellation, history boundaries and shared worker budgets.

#### Phase 12.1 — Fixed CSV agent action — IMPLEMENTED; ACCEPTANCE PENDING

Added `do <instruction>` and enabled the same fixed `analyze_csv` tool in interactive chat. The provider sees a system message that limits actions to the host-supplied tool, requires clarification for missing/ambiguous details, and states model calls are not permission. CSV arguments use a closed schema with bounded paths/columns and no permission field. The host asks for exact-file consent, requires an existing persistent read-folder grant, and uses the existing bounded CSV workflow/store. Chat shares one 40-request/10-action ledger across turns, retains the system message in its bounded context, and stops when either budget is exhausted. Groq remains selected by config and keeps the existing transfer-consent prompt; Ollama is not an automatic fallback.

**Verification:** `npm run typecheck`, `npm run build`, focused session/tool/CLI tests (5/5), and the final full serial `npm test` with dedicated `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_phase12_final` passed after approval-denial and cancellation handling changes. Full suite: 171 passed, 0 failed, 0 skipped, 111.6 seconds. Fixtures prove fixed tool exposure, validated arguments, tool-result reuse, unknown-tool rejection, shared budget accounting, help disclosure and noninteractive refusal before provider setup. A real TTY provider exchange, exact-file accept/decline, stored-folder grant path, cancellation during approval, and cross-turn live behavior remain unverified. Direct CSV/document analysis and the fixed installed-task CSV adapter are agent-addressable; no generated write, research/web, or chat transcript/history is exposed through this agent path. Phase 12 remains IN PROGRESS until its intent, owner, and lifecycle acceptance matrix is complete.

**Package/tracked artifact recheck:** `npm pack --dry-run --json` lists 46 files and matches no generated-build, `.env`, credentials, session data, private workspace, reports or TLS-key fixture. Git tracks no generated build folder, `.env`, credentials, session state or personal/private workspace artifact. One tracked exception is the documented disposable `test/fixtures/browser-egress-fixture.key` self-signed local-test key; it is not a service credential and is excluded from the package. `.env.example` contains placeholders. All 35 legacy `.taskforge-build-*` folders remain preserved and untracked.
#### Phase 12.2 — Approved document analysis action — IMPLEMENTED; ACCEPTANCE PENDING

Added `analyze_document` to the fixed host tool set for TXT, Markdown, text PDF, DOCX, and XLSX. Unsupported suffixes, permission fields, extra arguments, malformed paths, and oversized inputs fail closed. The CLI uses the same exact-file question, stored-folder read grant, document parser and persistence workflow as the named command; only format/count aggregates are returned to the model. Groq’s consent prompt names both aggregate result types and clarifies that extracted document text/source rows are excluded.

**Verification:** `npm run typecheck`, `npm run build`, focused agent session/CLI tests (6/6), and full serial `npm test` with dedicated `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_phase12_documents` passed. Full suite: 172 passed, 0 failed, 0 skipped, 110.6 seconds. Fixtures select only the host-provided document tool, preserve the host result, and reject permission escalation and unsupported formats. Live-provider/TTY owner checks remain outstanding; Phase 12 stays IN PROGRESS for intent clarification, wider tool coverage, and lifecycle acceptance.

#### Phase 12.3 — Host feedback for missing or invalid tool inputs — VERIFIED

When a known fixed tool receives invalid or missing arguments, the host returns generic non-sensitive feedback to the selected provider instead of executing the tool or immediately aborting. The model can ask the user to clarify; a later chat turn may provide exact details before a fresh tool request. Invalid calls consume the shared action budget, while `AgentRunResult` action/name fields continue to report executed actions only. Unknown tool names remain hard failures. Batch calls are validated before any action runs, and one invalid call rejects the entire batch. If no model request remains to turn host feedback into a question, the host returns a fixed clarification prompt without exceeding the budget.

**Verification:** Strict typecheck/build and agent-session tool/CLI tests passed (13/13). The isolated integrated serial `npm test` passed **211/211, 0 failed, 0 skipped** in 176.4 seconds, using isolated local storage and a dedicated loopback Mongo test database. Tests cover missing paths, safe correction feedback, no execution on invalid input, valid-first/invalid-second all-or-none batching, request-limit clarification, shared budget accounting, and later user-supplied exact paths. Independent review found no remaining correctness issue. The continuation test verifies the agent loop/history protocol, not the full TTY `runChat` integration. No live provider claim is made; Phase 12 remains IN PROGRESS for owner acceptance, broader intent coverage, and lifecycle checks.

#### Phase 12.4 — Installed task routing and bounded CSV execution — VERIFIED

Added the fixed `run_installed_task` agent tool. It exposes only validated registry definitions whose complete declared tool set and input/output shape match the host's CSV adapter. Each task input is checked again against its definition, then the adapter delegates to the existing CSV tool, preserving exact-file approval, persistent read-folder grants, shared tool budgets, and the existing storage workflow. Definition instructions/examples are not sent to the model as authority and cannot expand capabilities. The model receives only eligible task IDs, names, descriptions, and declared input metadata as untrusted matching context. Unsupported repository, web, and other tool requirements are not partially run. The system/tool contract asks for clarification when task intent is unclear; invalid or incomplete task arguments receive the loop's existing bounded correction path.

**Verification:** `npm run typecheck` and `npm run build` passed. Focused installed-task, session-tool, and CLI tests passed 17/17 after catalog metadata was exposed. Fixtures cover a locally defined CSV task through the fixed executor, model-visible task names/purpose/input metadata (excluding instructions/examples), absent/unknown/extra/mistyped inputs with zero execution, unsupported multi-tool definitions excluded atomically, and an ambiguous-intent response with zero execution. A separate synthetic live Groq ambiguity check completed in one model request with zero tool actions and zero executor calls; it sent only two synthetic task definitions and a generic prompt, and accessed no files or database. This demonstrates one live clarification, not general model reliability or TTY owner acceptance. Phase 12 remains IN PROGRESS for broader intent selection, lifecycle/TTY checks, and owner acceptance.

**Provider connectivity check:** `node dist/cli.js model-check` passed through configured Groq with one synthetic fixed tool action in two model requests. The sandboxed attempt was unavailable; the authorized network-enabled retry passed. The request used only TaskForge's built-in fixture prompt and did not exercise user data, project data, or file access.

### Phase 13 — Agent investigation, previews, approved changes and verification — IN PROGRESS

Depends on Phases 11–12 and path/command approvals. **Phase 13.1 — Single-file model replacement preview — IMPLEMENTED; ACCEPTANCE PENDING.** Added `run agent-fix --root <directory> --target <relative-source> --goal <instruction> --test <relative-test.mjs>`. It requires TTY, exact root/target/goal/test consent, active persistent read and write grants, a configured selected provider, and separate approval before transferring one bounded locally redacted source file. The provider receives only `propose_replacement`; it cannot read files, run commands, or write. Credential-like source lines or candidate replacements whose display would be redacted are refused. The candidate is bound to the existing target snapshot and replacement hash, shown before separate apply approval, and stale target changes are rejected. Decline discards the preview. After apply, the owner must separately approve the selected fixed Node test; a declined or failed check does not roll back the patch and is reported as unverified/failed.

**Verification:** `npm run typecheck`, `npm run build`, and focused agent/session/CLI/patch tests passed (initial 14/14; after prevalidating test-file scope, 19/19 including reviewed-command tests). The first full serial run after that validation change passed 176 tests and hit one 5-second subprocess timeout in `tasks list and inspect`; the failed CLI test passed alone (2/2), then the clean full serial rerun passed **177/177, 0 failed, 0 skipped** in 125.8 seconds with `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_phase13_agentfix_retry`. This isolated failure/recovery indicates transient host load rather than a behavior regression; no assertion or timeout was changed. `npm pack --dry-run --json` listed 46 files with no generated-build, credential, session, private-workspace or test-key paths. A live TTY/provider exchange, owner review of the exact candidate, seeded project repair end-to-end, and Windows filesystem race/durability acceptance remain pending. This is full-file single-target replacement, not a multi-file diff, automatic diagnosis, arbitrary check selection, or OS sandbox; the independent developer trial remains pending.

**Acceptance:** Synthetic seeded bug has a reproducible failing check; model produces an exact hash-bound patch preview; refusal leaves bytes unchanged; approval applies only the preview; stale target is rejected; relevant fixed check is separately approved and reported truthfully; no Git publication. Also verify the TTY/provider path with the owner and retain accurate failure/cancellation outcomes.

### Phase 14 — Evidence-cited web research — IN PROGRESS

Depends on Phase 12 and exact external-transfer consent. **Phase 14.1 — Citation provenance and uncited-sentence reporting — IMPLEMENTED; ACCEPTANCE PENDING.** Groq `citation_options` is explicitly enabled. Inline `〖n†Lx-Ly〗` markers are mapped only to validated HTTPS sources returned in the same provider response. The CLI prints each marker's mapped URL and bounded excerpt, reports unmapped citation markers, and heuristically lists answer sentences without an inline citation. Comparison still runs separate searches and reports exact shared URLs; it makes no unsupported agreement/disagreement claim.

**Verification:** Strict typecheck/build and focused research provider-contract tests passed (6/6), covering request citation configuration, valid mapping, invalid source references, uncited statements, comparison source mapping, unsafe/missing sources, provider error redaction and cancellation. First full run passed 176/178 and timed out two existing 5-second CLI subprocesses; all four CLI guard/help checks then passed alone in 4.6 seconds. The clean serial rerun passed **178/178, 0 failed, 0 skipped** in 136.0 seconds with dedicated `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_phase14_research_retry`. No timeout or assertion changed. Groq is configured locally, but live synthetic retrieval/citation-format validation requires owner consent at the CLI's exact-query transfer prompt; owner review also remains pending.

**Acceptance:** Fixtures tie comparison claims to mapped retrieved passages/URLs, surface unsupported/uncited claims, source disagreement, retrieval failure, invalid URLs and escaping. Actual citations must map to returned evidence; citation mapping does not establish semantic entailment. Live synthetic retrieval is separately recorded and never inferred from fixtures.

### Phase 15 — Cancellation, resume and history contract — IN PROGRESS

Depends on Phases 10, 12 and 13. **Phase 15.1 — Checkpoint state binding and lifecycle audit — COMPLETE.** Audited exact current signal/decline boundaries, resumable workflow set, persisted history and retention. Fixed document resume state so its workflow hash includes the normalized document format; an identical byte sequence cannot resume through a different parser mode. Existing version-1 uncertain document checkpoints without a stored format now fail the state-hash check safely and remain preserved rather than replaying under an assumed format. Added fixtures for format mismatch and local history's 50-item listing bound while older records remain stored.

**Verification:** Focused document and SQLite persistence tests passed (11/11), including changed bytes, changed format, exact-format resume, newest-50 listing, redaction, and retention of an older record. The first full serial run reported 175 passed and 4 CLI subprocess timeouts (0 skipped); the affected `test/agent-session-cli.test.mjs` then passed 4/4 by itself. An unchanged clean serial retry passed **179/179, 0 failed, 0 skipped** in 148.5 seconds with `TASKFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27017/taskforge_recovery_retry_20261017`; the MongoDB integration used its derived isolated database and cleaned it up. `npm test` ran the strict TypeScript build. No timeout/assertion was changed and no stored history is deleted. Independent read-only review found no actionable defect in the document state-hash change; the Phase 10.3 shared adapter contract now verifies exact-format document resume and CSV resume against both SQLite and MongoDB using matching synthetic input/checkpoint hashes; this does not cover interruption at every workflow boundary.

**Remaining Phase 15 acceptance:** Broader per-workflow cancellation and interruption coverage remains open, including side-effect uncertainty, duplicate replay prevention and database-failure behavior. Unsupported general resume remains explicit. A future history deletion/retention command requires a separately reviewed policy; current history is retained by the selected store with no automatic purge or CLI delete.

### Phase 16 — Browser and specialist end-to-end acceptance — PARTIAL; acceptance PENDING

Depends on existing browser/specialist boundaries and Phases 12, 14 and 15. The dedicated ephemeral manual-login path and controlled browser/proxy cases are implemented; no authenticated session/profile is imported. Integrated specialist-budget coverage and actual owner-operated BookFinder search/results/details/back evidence remain pending.

**Acceptance:** Automated synthetic integration covers ephemeral login, separate journey approval, no session/profile import, specialist limits/shared budgets/tool denials. BookFinder search/results/details/back requires owner manual login and journey approval in the fresh ephemeral browser. It remains pending until owner-operated evidence exists; the earlier authorization remains valid.

### Phase 17 — Evidence-based architecture reports/diagrams — IN PROGRESS

Depends on Phases 11–12 and approved path access.

**Phase 17.1 - Exact-file evidence reports and import diagrams - IMPLEMENTED; acceptance PARTIAL.** Offline architecture reports for an explicitly selected set of 1–20 files under an approved repository root. The CLI requires interactive exact-root/file-set approval and persistent read-folder approval. The analyzer recognizes line-based JavaScript/TypeScript imports/exports and Python imports, cites file and line, labels dependency-role statements as inference, reports unsupported languages and missing evidence, and emits a Mermaid flowchart import graph with structured node metadata and an evidence reference per edge. It reuses bounded local heuristic redaction, does not execute source, and does not walk the repository. Other languages, aliases, compiler/package resolution, and whole-repository inventory remain unimplemented.

**Phase 17.2 - Selected-file relative import resolution - IMPLEMENTED; acceptance PARTIAL.** Relative JS/TS specifiers are heuristically matched against only the exact selected files using common source suffixes, including .js to .ts source mapping. Windows path comparison follows the filesystem case-insensitive behavior while retaining report paths. Resolved edges point to selected file nodes; package imports and unresolved relatives remain module nodes. No additional files are read.

**Phase 17.3 - Selected-file Python import evidence - IMPLEMENTED; acceptance PARTIAL.** Line-based `import` and `from ... import` statements are reported. Relative Python imports, including `from . import sibling`, resolve only against explicitly selected `.py` files (including selected `__init__.py` files); standard-library, third-party, and unselected modules stay module nodes. Multiline/dynamic imports, aliases across package configuration, and full Python resolution are not implemented.

**Verification (17 October):** `npm run typecheck`, `npm run build`, and `node --test test/architecture-report.test.mjs` passed (6/6); latest integrated full serial `npm test` passed 194/194, zero failed or skipped, in 125.9 seconds with `TASKFORGE_STORAGE=local`, isolated temporary `LOCALAPPDATA` (`taskforge_phase17_python_sibling_20261017`), and dedicated loopback Mongo base `mongodb://127.0.0.1:27017/taskforge_phase17_python_sibling_20261017`. Fixtures cover cited JS/TS/Python evidence, relative TS/JS-suffix and Python resolution (including `from . import sibling`) only within selected files, Windows case-insensitive selected paths, unresolved package/unselected modules, line evidence, inference/coverage, unsupported-language/missing-evidence reporting, redaction, exact file selection, and unapproved/out-of-root rejection. The report remains heuristic and does not establish runtime architecture.

**Integrated verification history:** The first full run after the diagram and Vercel 404-classification change passed **187/187, 0 failed, 0 skipped** in 121.7 seconds; later runs are recorded under Phases 10.3, 10.4 and this phase. A preceding launch without the required isolated URI was interrupted after 14 passing cases and before Mongo integration; it made no normal-data changes. The latest 194/194 result above supersedes these counts.

**Acceptance:** Synthetic repositories produce reports/diagrams with verifiable file/line evidence, bounded scope, inference/coverage labels, redaction and unsupported-language handling; no source execution or outside-root reads. Broader language coverage, compiler/package aliases, whole-repository discovery, and runtime dependency validation remain.

### Phase 18 — Read-only GitHub/Vercel deployment tracing — IN PROGRESS

Depends on Phase 12 and permission/secret handling. No deployment actions.

**Implemented subphase:** Interactive CLI tracing for an exact public GitHub `owner/name`, Vercel `prj_...` project ID and optional `team_...` ID. The adapter performs only allowlisted GitHub Actions and Vercel deployment-list GETs, rejects redirects, limits each response to 256 KiB/25 records and 15 seconds, validates returned records/links, reports providers independently, joins validated deployment/run commit SHAs, and accepts the Vercel token only as an ephemeral call argument. No deployment operation is implemented. A prior read-only public check of `shazzark/taskforge` returned zero workflow runs; that is not BookFinder deployment evidence.

**Verification:** `npm run typecheck`, `npm run build`, and `node --test test/deployment-tracing.test.mjs` passed (5/5 after adding a Vercel 404-classification regression case). Fixtures cover allowlisted GETs, SHA joins, independent auth/partial states, response/input validation, caps, and token/error non-disclosure. Vercel 404 is reported as not-found-or-inaccessible, not as proven authentication failure. No live Vercel request was made. Live verification is blocked on owner identifying the exact project/team scope and providing local `TASKFORGE_VERCEL_TOKEN`; do not record or display the token.

**Acceptance:** API fixtures prove minimum read scopes, no writes, source links, redaction and honest auth/expiry/partial-result states. Live tracing waits for authorized account/project setup and is separately verified.

### Phase 19 — Guided setup and Windows bundled-runtime distribution — IN PROGRESS

Depends on Phase 10 and stable CLI/integrations. Evaluate licensing, architecture, browser runtime, size and updates before choosing distribution mechanics.

**Phase 19.1 — Distribution inventory — COMPLETE (documentation only).** `PHASE19_DISTRIBUTION_AUDIT.md` records the npm artifact, Node and Playwright runtime/browser requirements, data-retention boundary, candidate portable-ZIP and installer paths, and dependency ordering. No installer/runtime implementation or clean-machine acceptance is claimed. Phase 19.2 below corrects Playwright's runtime classification and verifies production consumer module loading. The latest packed artifact has 63 files (144.8 kB compressed, 671.1 kB unpacked) and excludes checked secret/session/private/report paths; it does not include a Node runtime or browser binaries.

**Phase 19.2 — Runtime browser dependency and production package import — VERIFIED.** Moved Playwright from development-only to runtime dependencies and pinned it to the lockfile's exact 1.64.0 version. Built and packed the CLI, installed that tarball with production dependencies only into a disposable Windows consumer, imported Playwright and `dist/workflows/browser-audit-workflow.js`, and ran the packaged CLI version command successfully (`0.1.0`). The existing browser cache was not copied or downloaded, and no browser launch/live target was part of this package import check. A bundled Node runtime, browser installation strategy, clean-machine run, setup wizard, license/SBOM scan, upgrade and uninstall retention remain unimplemented.

**Phase 19.3 — Read-only setup guide — VERIFIED.** Added `setup` as a local informational CLI command. It reports the selected storage backend and whether a provider configuration parses, redacts secrets/paths, and lists manual Node, storage, provider and optional Chromium steps. It does not connect to MongoDB or a model provider, write configuration, or download Node, Chromium, or models. This is an initial guide and does not provision settings or replace a bundled runtime/installer.

**Verification:** `npm run typecheck`, `npm run build`, and focused setup/config tests passed (15/15). The integrated serial `npm test` passed **221/221, 0 failed, 0 skipped** in 150.5 seconds with disposable local storage and dedicated loopback MongoDB. Fixtures cover fresh local setup, configured Mongo/Groq secret redaction, invalid storage, and independent Ollama status. Setup remains partial; Phase 10 Windows ACL, durability, recovery/backup and full-parity gates still precede runtime bundling and clean-machine acceptance.

**Next subphase:** Finish applicable Phase 10 Windows/storage and compatibility gates, then choose and verify the browser binary strategy and Node runtime compatibility for Windows distribution. The production-only package dependency/import check is already verified above. After those prerequisites, implement the bundle mechanism, integrity/SBOM, clean-machine, upgrade and uninstall-retention acceptance. No owner decision blocks local diagnostics; a clean Windows operator/machine is needed for final acceptance.

**Acceptance:** Clean Windows machine without preinstalled Node launches documented workflows with bundled runtime; package excludes credentials/session/private artifacts; integrity, license, data preservation, upgrade/side-by-side and uninstall-retention checks pass. No service provisioning or model download.

### Phase 20 — Owner and independent developer acceptance — PENDING EXTERNAL TRIAL

Depends on all applicable prior acceptance gates.

**Acceptance:** Owner synthetic walkthrough covers approval, cancellation, failure and expected artifacts. A different developer completes clean Windows trial. BookFinder live journey is recorded separately. Neither can be marked complete from agent review.

## Cross-cutting code organization and maintainability — COMPLETE

This structural refactor does not change the approved 11 product work areas. It preserves the CLI contract, persisted-data schema, permission boundaries, and strict TypeScript settings. See the source placement guidance in `CONTRIBUTING.md`.

### Refactor checkpoint 1 — Extract task-registry CLI command — VERIFIED

Moved the `tasks list|inspect|validate` handler and its task-registry imports from `src/cli.ts` to `src/cli/commands/tasks.ts`. Moved its CLI and registry tests into `test/cli/` and `test/agent/`. Top-level argument dispatch and command semantics remain unchanged; package and compiler output paths remain unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and `node --test test/cli/tasks.test.mjs test/agent/task-registry.test.mjs` passed (6/6). CLI tests cover output (including the em-dash separator), exit status, rejected input, and value redaction. `git diff --check` is required before each local checkpoint.

**Next:** Storage-boundary extraction and configuration relocation are recorded in checkpoints 2 and 3 below. Continue with bounded capability and CLI-handler moves, verifying each affected feature. Run the integrated serial suite before declaring this refactor complete.

### Refactor checkpoint 2 — Consolidate storage contracts and adapters — VERIFIED

Moved persistence contracts, shared domain types/errors, SQLite and MongoDB adapters into `src/storage/`. Replaced the persistence port's dependency on the `MongoStore` class with explicit adapter-neutral methods. Updated workflows, scheduler and CLI imports; moved persistence tests under `test/storage/`. Mongo collections, SQLite schema, backend-selection behavior and saved record shapes were not changed.

**Verification:** `npm run typecheck`, `npm run build`, and isolated `node --test test/storage/sqlite-store.test.mjs test/storage/mongodb.integration.test.mjs test/storage/store-contract.test.mjs` passed (15/15), using a dedicated temporary `LOCALAPPDATA` and loopback Mongo test URI. The tests cover adapter contracts, connection errors, record persistence, and SQLite recovery after process exit.

### Refactor checkpoint 3 — Move configuration — VERIFIED

Moved configuration loading and validation to `src/config/configuration.ts`; updated provider, integration, storage, CLI, and test imports. Environment-variable names, validation rules, redaction, provider defaults, and storage selection are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and the focused config/provider/storage/CLI test command passed (43/43), including tests in nested feature directories.

### Refactor checkpoint 4 — Move software capabilities — VERIFIED

Moved reviewed command execution, patch application, model investigation, and Git diff review from `src/software/` into `src/tools/software/`. Moved their feature tests under `test/tools/software/`; updated CLI and MongoDB integration imports. This changes file organization only; capabilities, approvals, command allowlist, and behavior remain unchanged.

**Verification:** `npm run typecheck` and `npm run build` passed; `node --test --test-concurrency=1 test/tools/software/*.test.mjs` passed (15/15). `git diff --check` passed. The focused tests include generated and approved file patching, seeded failure reproduction, approved command constraints, Git diff redaction, and model finding bounds.

**Integrated verification:** `npm test` passed (194/194, 0 failed, 0 skipped) in 124.3 seconds with `TASKFORGE_STORAGE=local`, isolated temporary `LOCALAPPDATA`, and a dedicated loopback Mongo test base. The first integrated attempt had two existing five-second CLI subprocess tests time out under load (192/194); the complete affected CLI test file passed 4/4 on focused rerun, and the full serial rerun passed 194/194. No timeout or behavior was changed.

**Next:** Move remaining feature capabilities and continue splitting CLI command families by responsibility, then run the full serial test suite to confirm recursive test discovery and integrated behavior.

### Refactor checkpoint 5 — Extract GitHub issue CLI command — VERIFIED

Moved public GitHub issue command parsing, terminal confirmation, adapter invocation, and result presentation to `src/cli/commands/github-issues.ts`. `src/cli.ts` keeps only command dispatch. Added CLI subprocess coverage for malformed arguments and valid non-interactive invocations; both stop before network access. The read-only adapter and its behavior are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and `node --test --test-concurrency=1 test/cli/github-issues.test.mjs test/github-public-issues.test.mjs` passed (3/3). Independent review found no behavioral regression; cancellation also returns before the adapter call by source order. `git diff --check` passed.

### Refactor checkpoint 6 — Extract deployment-trace CLI command — VERIFIED

Moved deployment-trace argument handling, TTY/config/token preflight, explicit consent, adapter invocation, and result display to `src/cli/commands/deployment-trace.ts`; `src/cli.ts` retains dispatch. The established sequence and read-only behavior are preserved. Added CLI tests for malformed scope, non-interactive refusal, and token non-disclosure.

**Verification:** `npm run typecheck`, `npm run build`, and deployment CLI/adapter tests passed (6/6). Independent review confirmed the preflight order and safe output. Interactive credential loading and affirmative live API calls remain covered by source/fixture behavior only; no live Vercel request was made. `git diff --check` passed.

### Refactor checkpoint 7 — Move CSV data capability under tools — VERIFIED

Moved the bounded CSV analysis/parser module to `src/tools/data/csv-analysis.ts` and its core tests to `test/tools/data/`. Updated workflow, specialist-sampling, report-export, CLI test references and the contribution/codebase map. Parser behavior, workflow semantics, approvals, and data records are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and CSV analysis/export/CLI/data-specialist tests passed (20/20). Independent review found no stale import or behavior change. `git diff --check` passed.

### Refactor checkpoint 8 — Move document parsers and conversion under tools — VERIFIED

Moved the DOCX, PDF, TXT/Markdown, XLSX parsers and plain-text conversion capability to `src/tools/documents/`; moved their focused tests to `test/tools/documents/`. Updated document workflow, data-specialist sampling, CLI, report-generation test imports and codebase/capability maps. Parsing, conversion, approvals, and persistence behavior are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and parser/conversion/workflow/data-specialist tests passed (26/26). The initial focused run exposed two test imports of the PDF renderer at the old relative depth; both were corrected and the complete focused group then passed. Independent review found no remaining stale active paths or behavior changes. `git diff --check` passed.

### Refactor checkpoint 9 — Move artifact capabilities under tools — VERIFIED

Moved PDF rendering, validated report exports, local draft rendering, and approved create-only output helpers to `src/tools/artifacts/`; moved the five feature-focused test files to `test/tools/artifacts/`. Updated CLI, document/data cross-feature tests, capability audit, and codebase map. Approval and write semantics are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and the combined artifact/document/data capability suite passed (49/49). Initial checks found stale relative imports from the new source/test depth; the paths were corrected and the complete suite passed. Independent review found no remaining old active paths or behavior changes. `git diff --check` passed.

### Refactor checkpoint 10 — Move task registry under workflows — VERIFIED

Moved the built-in declarative task registry to `src/workflows/task-registry.ts` and its feature tests to `test/workflows/`. Updated the `tasks` CLI import, test imports, contribution map, and capability audit. The definitions remain validated non-executable data and do not grant permissions; CLI behavior and registry validation are unchanged.

**Verification:** `npm run typecheck` and `npm run build` passed. The combined registry and CLI task tests passed (6/6) with local storage and a dedicated temporary `LOCALAPPDATA`; the direct registry tests also passed (4/4). The first focused CLI attempt without the local-storage test environment hit the existing five-second subprocess timeout; rerunning in the isolated test environment passed. Independent review found no stale active paths or behavior changes. `git diff --check` passed.

### Refactor checkpoint 11 — Place architecture reporting under workflows — VERIFIED

Moved the evidence-based architecture report implementation to `src/workflows/architecture-report-workflow.ts` and its feature tests to `test/workflows/`. Updated its imports, the CLI import, contribution map, capability audit, and Phase 19 package inventory. Added a build clean step that deletes only generated `dist/` output before `tsc`, preventing stale compiled copies of moved source files from entering packages. No report behavior, read approval, source-execution, or exact-file-scope behavior changed.

**Verification:** `npm run typecheck`, clean `npm run build`, and the architecture report fixture suite passed (6/6). The first focused run found a stale relative `WorkspacePathPolicy` test import after the move; it was corrected and the full focused suite passed. `npm pack --dry-run --json` reported 52 entries (136,793 compressed bytes; 641,346 unpacked), including the new workflow output and no old `dist/architecture-report.js` copy. Independent review found no issues beyond the stale package path, which was corrected. `git diff --check` passed. The full integrated suite remains required before the overall code-organization refactor is complete.

### Refactor checkpoint 12 — Extract read-only repository inspection CLI commands — VERIFIED

Moved the repository inventory, selected-source review, and architecture-report CLI handlers into `src/cli/commands/repository-inspection.ts`. The shared persistent-approval error now lives in `src/cli/command-errors.ts`; the dispatcher passes existing storage and approval helpers into these handlers. Consent text, validation order, exit codes, exact file/root scope, and read-only workflow calls are preserved. Added CLI tests for malformed architecture arguments and non-interactive refusal across all three commands.

**Verification:** Strict typecheck and clean build passed. The new CLI gate test plus repository inspection, source review, and architecture report tests passed (11/11). Independent review found no ordering, output, error, or permission regression; the TTY test is a gate-level smoke test, while the workflow approval paths remain covered by existing fixture tests. `git diff --check` passed. The integrated suite remains required before the overall code-organization refactor is complete.

### Refactor checkpoint 13 — Extract scheduling CLI command — VERIFIED

Moved schedule argument validation, creation/list/status/recovery commands, foreground tick handling, and scheduled CSV/document execution wiring into `src/cli/commands/scheduling.ts`. The dispatcher injects the existing storage and approved-file helpers. Scheduler service logic remains in `src/scheduling/`; approval on each occurrence, cancellation, persistence, and schedule semantics are unchanged. Added CLI checks for invalid definitions and unattended creation refusal.

**Verification:** Strict typecheck and clean build passed. The scheduling CLI gate test plus scheduler fixtures passed (6/6). Independent review confirmed argument validation, approval ordering, per-occurrence read approval, uncertain-run resume, claim recovery, SIGINT cleanup, and store lifetime are unchanged. Interactive confirmation and SIGINT are source-reviewed but not newly driven end-to-end. `git diff --check` passed. The integrated suite remains required before the overall refactor is complete.

### Refactor checkpoint 14 — Extract CSV and document CLI workflows — VERIFIED

Moved CSV analysis/export, document analysis/export/conversion, and CSV/document resume handlers plus CSV argument parsing into `src/cli/commands/data-documents.ts`. The CLI entry point continues to own approved file reading, storage lifecycle, and persistent-folder grants and injects those same helpers. No workflow, data, approval, preview, artifact, or persistence behavior is intended to change.

**Verification:** Strict typecheck and clean build passed. CSV/document CLI, workflow, export, and conversion tests passed (16/16). Independent review confirmed read/write grant ordering, preview/hash approval, artifact reference persistence, and resume routing are unchanged. Existing tests do not drive successful interactive approval or artifact-reference failure end-to-end; those remain covered in parts by workflow/export tests. The new command module is still substantial, so further responsibility separation remains in scope. `git diff --check` passed. The full integrated suite remains required before overall refactor completion.

### Refactor checkpoint 15 — Extract artifact CLI commands — VERIFIED

Moved the PDF-report and local-draft command handlers into `src/cli/commands/artifacts.ts`. They continue to use the CLI's existing approved-input and persistent-folder helpers; artifact generation, exact preview/hash consent, create-only writes, and no-network behavior are unchanged. Added CLI tests for input and output consent gates.

**Verification:** Strict typecheck and clean build passed. The new artifact CLI gate test and draft/PDF capability tests passed (11/11). Independent review confirmed read consent, output grants, preview/hash prompts, create-only writes, error handling, and dispatch are unchanged. `git diff --check` passed. Overall CLI organization and full integration remain in progress.

### Refactor checkpoint 16 — Extract browser-audit CLI command — VERIFIED

Moved browser-audit argument parsing, target/consent gates, manual-login prompts, result presentation, local screenshot output, and optional specialist handoff wiring into `src/cli/commands/browser-audit.ts`. The entrypoint injects the existing store lifecycle and specialist-review operation. Browser workflow, network protections, and owner-login boundaries are unchanged. Added non-interactive gate coverage for loopback and public manual-login modes; neither test starts a browser or contacts a site.

**Verification:** Strict `npm run typecheck` and clean `npm run build` passed. Focused browser workflow, CLI, and egress-proxy tests passed (22/22); `git diff --check` passed. Independent review found no blocking issues and confirmed consent, manual-login privacy, sanitization, and specialist boundaries are preserved. The CLI tests exercise non-interactive consent gates; interactive approval success is not directly covered. No live owner login or deployment access was attempted. At this checkpoint, remaining CLI decomposition and the integrated suite were still pending; see checkpoints 17–20 for their completion.

### Phase 9 documentation checkpoint — COMPLETE

Updated in this checkpoint: `prd.md`, `trd.md`, `architecture.md`, `backendschema.md`, `appflow.md`, `implementation-plan.md`, `CAPABILITY_AUDIT.md`, and README record the approved scope and distinguish target design from current behavior. Cross-document proposal/status scan and `git diff --check` passed. No code changed, so the Phase 8.8 full-suite evidence remains the latest full-suite result; no new test claim is made. Commit this verified documentation checkpoint locally before starting Phase 10.

**Phase 9 verification:** Searched all seven planning/tracker documents plus README and capability audit for stale claims that the newly approved areas remain unapproved; only explicitly historical notes marked superseded remain. `git diff --check` passed. Existing CLI help was observed as `node dist/cli.js --help`; the walkthrough and exact current commands remain in `CAPABILITY_AUDIT.md`. Typecheck/build/full-suite were not rerun because this checkpoint changes documentation only; full serial suite evidence remains Phase 8.8 (152/152, isolated MongoDB test database).

### Refactor checkpoint 17 - Extract folder-permission CLI command - VERIFIED

Moved folder approval listing, grant/revoke validation and consent, and result/error presentation into `src/cli/commands/permissions.ts`; the entrypoint injects its existing store lifecycle. Canonical path validation, non-sensitive-root checks, exact read/write scope, terminal escaping, cancellation behavior, storage error handling, and exit codes are unchanged.

**Verification:** Strict typecheck and clean build passed. Permission CLI and path-policy tests passed (14/14); `git diff --check` passed. Independent review found no behavior or security regression. Interactive approve/revoke success remains untested at CLI level, as before this move. After this checkpoint, the integrated serial `npm test` passed 200/200 (0 failed, 0 skipped) in 182.5 seconds using isolated local storage and a dedicated MongoDB test database. At checkpoint 17, remaining CLI decomposition and the final integrated run were pending; checkpoints 18-20 completed them.

### Refactor checkpoint 18 - Extract natural-language and chat CLI commands - VERIFIED

Moved `do` and `chat` command handling and CSV/document agent-tool wiring into `src/cli/commands/agent-session.ts`. The entrypoint injects the existing approved-file reader and store lifecycle. Provider consent, exact-file approval, fixed tool exposure, shared per-session budget, cancellation, and message-window behavior are intended to remain unchanged.

**Verification so far:** Strict typecheck and clean build passed. Agent session CLI and tool tests passed (9/9); `git diff --check` passed. Independent review found no behavioral differences: provider consent, exact-file approval, cancellation, shared budgets, bounded message history, and fixed tool exposure remain intact. Interactive approval and history success paths remain untested at CLI level, as before the move. The final integrated suite passed after subsequent checkpoint 19; see checkpoint 20.

### Refactor checkpoint 19 - Extract reviewed software CLI workflows - VERIFIED

Moved software checks, static and generated file patches, model-assisted single-file fixes, approved file moves, and staged Git diff review into `src/cli/commands/software-workflows.ts`. The module receives the established store lifecycle and persistent-folder approval function from the entrypoint. Command allowlists, preview/hash checks, exact consent order, source redaction, cancellation, and error/exit behavior are unchanged.

**Verification:** Strict typecheck/build passed. Focused agent-session/permissions CLI, reviewed-command, patch-application, and Git diff review tests passed (21/21); `git diff --check` passed. Independent review found no behavior changes or approval-boundary regression. Interactive success paths remain only partially covered at CLI level; the final integrated run after this extraction passed: serial `npm test`, 200/200, 0 failed, 0 skipped, 157.4 seconds, using isolated local storage and a dedicated MongoDB test database.

### Refactor checkpoint 20 - Integrated structural verification - VERIFIED

The code-organization work moved persistence/configuration/workflow/tool responsibilities under feature-focused folders, added the CONTRIBUTING codebase map, and extracted the major CLI command families while preserving the public CLI entrypoint. The CLI remains responsible for top-level dispatch, shared exact-file approval/storage lifecycle, configuration/diagnostics, and smaller command flows; there are no empty backend folders or generic helper buckets.

**Verification:** Final strict build through `npm test` passed serially with 200/200 tests, 0 failed, 0 skipped (157.4 seconds). The full run used an isolated local-storage root and a dedicated MongoDB test database. Focused checks and independent reviews passed at each extraction checkpoint. `git diff --check` passed. No live owner login, Vercel trace, deployment action, or provider call was made for this structural refactor.

#### Phase 11.2 - Local declarative definition loading and management - VERIFIED

Bounded scope: load/install validated JSON definitions from the TaskForge per-user data directory and expose built-in plus valid local definitions through `tasks list`, `inspect`, and `validate`. Add create-only validated installation from an explicitly approved source file. Enforce direct-child `.json` discovery, file/count/total-size limits, ID collisions, symlink/path checks, and sanitized invalid-file reporting. Definitions remain data only: no task execution, plugins, permissions, provider selection, custom budgets, or natural-language routing in this subphase.

Verification used isolated temporary data roots and fixtures. The normal selected backend and application data were not reset or modified.

Implemented per-user local JSON definition loading, validate-only inspection, and exact-file-approved create-only installation. `tasks list`, `inspect`, and input validation merge valid local entries with built-ins and label their origin. The registry is independent of SQLite/MongoDB selection, reads only direct-child `.json` files, validates filename/ID and schema, refuses built-in collisions, symlinks and path escapes, bounds entries to 64 KiB each/100 files/1 MiB aggregate, and reports invalid entries without echoing contents. Definitions remain non-executable data with no permissions, provider, network, plugin, budget, or natural-language authority. An exclusive install lock protects capacity checks across concurrent installers; stale-lock recovery is documented in `CONTRIBUTING.md`.

**Verification:** `npm run typecheck`, `npm run build`, focused registry/config/CLI tests passed (24/24), `git diff --check` passed, and the isolated serial `npm test` passed **207/207, 0 failed, 0 skipped** in 168.0 seconds with isolated local storage and a dedicated loopback MongoDB test database. Independent review confirmed terminal-control escaping and concurrent install serialization. Phase 11's approved registry acceptance is complete. Definition execution and natural-language routing belong to Phase 12 and remain partial; they are not registry capabilities claimed here.

**Command-level follow-up:** A focused CLI command test passed as part of 10/10 task CLI/registry tests. It verifies `validate-definition` and `install` use the injected bounded approved-reader dependency, validation does not persist, and install persists the validated definition. This tests the command boundary with an injected reader, not an actual TTY approval interaction.
