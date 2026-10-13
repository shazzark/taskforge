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

### Phase 3 — Permissions, events and resume — IN PROGRESS

**Goal:** Add approved roots, secret denials, batch previews, bounded events/checkpoints and state revalidation.

**Acceptance checks:** Escape, changed-target and denial checks pass; cancel/resume and database-failure behavior are verified. No new task family until boundary checks pass.

#### Phase 3.1 — Approved roots and action previews — COMPLETE (in-memory foundation)

Implemented explicit realpath-resolved root approval, read/write path checks, secret-path denials, symlink/junction escape rejection, bounded file fingerprints, write/move previews, approval tokens and changed-target invalidation. This foundation performs no file mutations and keeps approvals in memory; it does not yet provide persistence-backed checkpoints or resume.

**Checks:** `npm run typecheck` passed; `npm test` passed (28 passed, 1 skipped: the dedicated MongoDB integration lacked its test URI). Approved-root traversal, secret denial, junction escape, content-change invalidation, junction replacement invalidation and preview limits passed.

**Pending:** This general root/preview foundation remains in-memory. `file-patch`, `pdf-report`, and local `draft` each enforce their own approved, content-bound operation path; durable scoped folder approvals are implemented in Phase 3.4. This preview layer still does not authorize mutations.

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

### Phase 4 — Files, data and report adapters — IN PROGRESS

**Goal:** Implement inventory, deterministic CSV calculations, approved organization, input parsers and requested outputs.

**Acceptance checks:** Fixture counts/totals and file integrity match; PDF renders; unsupported formats fail clearly. Verify paths, format fixtures, malformed input and artifact hashes.

#### Phase 4.1 — Deterministic CSV analysis core — COMPLETE (pure input module)

Added a bounded CSV parser and analyzer for caller-supplied text: BOM/CRLF, escaped quotes, quoted delimiters and embedded newlines; header/row validation; duplicate and missing-cell counts; selected-column totals using exact decimal arithmetic. It does not open files, create exports, or expose a new workflow/CLI task.

**Checks:** `npm run typecheck` passed; `npm test` passed (33 passed, 1 skipped dedicated MongoDB integration). Fixtures cover known exact totals, missing values, duplicate rows, malformed quoting/width, invalid numeric values, and size/record/column/precision limits.

**Integrated:** File access is wired through explicit approval and Phase 3 metadata persistence in the CSV analysis/resume and document-analysis workflows. Create-only validated PDF output is in Phase 4.8. **Remaining:** requested structured export formats and additional file workflow families.

#### Phase 4.2 — PDF report rendering core — COMPLETE (in-memory output)

Added a PDFKit renderer for validated title/section text that returns PDF bytes in memory, with metadata, a standard-font character boundary, and bounded input/output size. No filesystem writes or untrusted HTML rendering are performed.

**Checks:** `npm run typecheck` passed; `npm test` passed (36 passed, 1 skipped dedicated MongoDB integration). Generated output had a valid PDF header/EOF and expected metadata; malformed, unsupported-character, oversized and excessive-section cases failed closed.

**Integrated:** Phase 4.8 writes a new PDF only after path/content approval and verifies the resulting hash. **Remaining:** persisted artifact references and other requested output formats.

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

**Pending:** Rich workflow artifact references and document conversion remain future subphases.

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

### Phase 5 — Software workflow — IN PROGRESS

**Goal:** Support repository inspection, seeded bug investigation, approved patches, reviewed command execution and local diffs.

**Acceptance checks:** Reproduce and correct a seeded failure, run relevant tests, and retain secret/path controls. Verify in a disposable repository. No Git push or deployment from the workflow.

#### Phase 5.1 — Approved-root repository inventory — COMPLETE (metadata-only foundation)

Added `run repo-inspect --root <directory>`. The command requires interactive approval for the exact root, then uses the in-memory path policy to inventory bounded directory/file metadata. It skips secret paths, symlinks, and common generated/dependency directories. It does not read file contents, run commands, modify files, or persist paths/content; MongoDB receives only redacted counts and typed lifecycle events. Limits cap traversal depth, directories, and files.

**Checks:** `npm run typecheck` passed; full `npm test` passed against a loopback MongoDB URI, 49 passed, 0 skipped. Unit fixtures verified excluded dependency/VCS folders, `.env` denial, metadata redaction, unapproved-root rejection, and lifecycle events. Integration verified completed inventory run/events in a unique database that the test dropped afterward. Noninteractive CLI smoke stopped before root access. `git diff --check` passed.

**Integrated:** Source review and model-assisted investigation are in Phase 5.3/5.6; approved patching is Phase 5.4; staged diff review is Phase 5.5. This metadata inventory itself remains read-only and is not bug diagnosis or a sandbox.

#### Phase 5.2 — Reviewed test/check execution — COMPLETE (fixed command set)

Added `run software-check --root <directory> --check <node-test|typescript-check>`. The CLI requires interactive approval for the exact root and a second confirmation for the selected fixed check. The runner invokes Node directly with `shell: false`, allows only `node --test` or the repository-local TypeScript compiler with `--noEmit`, filters inherited environment variables, caps runtime at 120 seconds, drains output without displaying or persisting it and reports only a capped observed-byte count; timeout termination targets the full process tree, and records only outcome/exit metadata. This executes code from the approved repository and is not an OS sandbox; arbitrary command strings and arguments are unsupported.

**Checks:** `npm run typecheck` passed; `npm test` passed against an isolated local MongoDB database (53 passed, 0 skipped). A disposable fixture reproduced an assertion failure and passed after the fixture test was corrected. Database integration verified failed/completed run state and a successful TypeScript no-emit check; the isolated database and fixture roots were cleaned up. Persisted summaries/events contain no command output or paths.

**Integrated:** Local source review, consented model-assisted investigation, patch preview/application, and staged diff review are in Phases 5.3–5.6. **Remaining:** finer-grained test selection and any broader workflow not covered by the fixed reviewed commands.

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

**Remaining:** Tool-bearing specialists and browser/data specialist integrations are not implemented.

### Phase 8 — Release gate — IN PROGRESS

**Goal:** Complete a clean Windows consumer trial, workflow documentation, contribution guide, license/dependency review and distribution checks.

**Acceptance checks:** Another developer runs documented scenarios and all required checks are recorded. Release by clone first. npm publication requires tarball consumer verification and explicit publication authorization; check package naming before release.

#### Phase 8.1 — Package metadata and Windows consumer smoke — COMPLETE (offline cached consumer)

Added the MIT license and verified GitHub repository URL to package metadata and the lockfile. The generated local tarball installed offline in a temporary Windows consumer using 240 cached packages; its generated `taskforge.cmd` returned version `0.1.0` and help including `run research`. A full `npm ls --prefix <consumer> --omit=dev --all --json` dependency-tree check exited 0 and counted 554 installed dependency nodes. The temporary consumer was removed. The package dry-run contained 33 files and no `.env` or test/tracker files. No package was published. This verifies the cached offline consumer path; it does not establish a clean online install on another developer's machine.

**Dependency review at this checkpoint:** `npm audit --omit=dev --audit-level=high` passed with 0 reported production vulnerabilities. The then-current production tree included deprecated transitive `glob@7.2.3` and `inflight@1.0.6`; `buffers@0.1.1` and `png-js@2.0.0` lacked license metadata. `jszip@3.10.2` declares `(MIT OR GPL-3.0-or-later)`. Phase 8.4 records the subsequent remediation and current evidence.

#### Phase 8.2 — Contributor guidance and package-content check — COMPLETE (documentation slice)

Added `CONTRIBUTING.md` with Windows/Node setup, isolated test database instructions, quality gates, strict TypeScript requirements, consent boundaries and local-only checkpoint rules. `npm pack --dry-run --json` completed after the sandbox denied its npm cache write; the escalated read-only retry listed 33 package files including the new research adapter in `dist`, with no `.env`, tests or tracker files. `npm ls --omit=dev --all` exited 0; npm reported unmet optional platform/provider packages that are intentionally optional. `git diff --check` passed.

**Pending at this checkpoint:** Resolve deprecated transitive packages; obtain another developer's documented workflow trial. Phase 8 remains incomplete.

**Dependency review follow-up at this checkpoint:** `npm ls --omit=dev --all` exited 0. `buffers@0.1.1` was reached through ExcelJS to unzipper to binary and lacked license metadata or a package license file. `png-js@2.0.0` has no SPDX field but its installed upstream license text states MIT. `glob@7.2.3` and `inflight@1.0.6` were deprecated transitive packages in the ExcelJS archive path. `jszip@3.10.2` explicitly allows an MIT or GPL-3.0-or-later choice; TaskForge selects MIT and records that in `THIRD_PARTY_NOTICES.md`. Phase 8.4 remediates the ExcelJS chain. These are inventory notes, not a legal determination.

#### Phase 8.3 — Independent developer trial — PREPARED, PENDING EXTERNAL TRIAL

Added `DEVELOPER_TRIAL.md` as a clean Windows clone checklist covering install, strict TypeScript, local configuration, isolated MongoDB workflows, document fixtures, scheduling and optional Groq. Another developer must complete it; no external trial is claimed.

#### Phase 8.4 — Production dependency remediation — VERIFIED, TRIAL PENDING

Added ExcelJS-scoped overrides to `archiver@7.0.1` and `unzipper@0.12.5`, plus a `glob@13.0.6` override for archiver-utils. This removes `buffers@0.1.1` (missing license metadata) and the deprecated `glob@7.2.3`/`inflight@1.0.6` chain. The selected archive dependencies declare MIT; glob 13 declares Blue Oak Model License 1.0.0 and its required license URL is recorded in `THIRD_PARTY_NOTICES.md`. The existing `png-js` upstream MIT text and selected JSZip MIT option are also recorded.

**Checks:** `npm install --ignore-scripts` completed and audited 0 vulnerabilities; `npm audit --omit=dev --audit-level=high` reported 0 production vulnerabilities; `npm ls --omit=dev --all --parseable` exited 0. `npm explain` resolves glob only through archiver-utils and the production tree contains no `buffers` or `inflight`. Strict TypeScript and the full isolated MongoDB suite passed (91 passed, 0 skipped, 0 failed), including synthetic XLSX generation, DOCX/XLSX extraction, malformed/oversized/formula-bearing workbook rejection, and parser integration. `npm pack --dry-run --json` listed 36 files, includes `THIRD_PARTY_NOTICES.md`, and excludes `.env`. Another developer's trial remains external and pending, so Phase 8 remains IN PROGRESS.

**Security note:** The unzipper GitHub advisory is internally inconsistent: its title says affected versions through 0.12.4, its affected-version body says through 0.12.3, and it lists no patched release. Installed 0.12.5 is outside both ranges but upstream does not explicitly certify it as patched. ExcelJS uses unzipper's streaming parser; the advisory discusses the filesystem extraction API. The distinction and upstream reference are documented in `THIRD_PARTY_NOTICES.md`; recheck before release.

## Prerequisite checklist milestone

**Status: COMPLETE (documentation and prerequisites).** Added root `setup-checklist.md` and placeholder-only `.env.example`; the real `.env` remains ignored. The owner corrected the Atlas URI locally; redacted authenticated ping passes and no IP access-list or database-user changes were made. Local MongoDB responds to ping and passes isolated workflow integration checks. The synthetic Groq model-check passes. PDFKit, PDF.js, XLSX and DOCX dependencies are installed and bounded parser cores pass. Ollama is installed and the Phase 2 live trial used the already-downloaded qwen3 model; no additional model was downloaded. Remaining optional-provider choices and limitations are in the checklist.

## Recovery

- **Latest checkpoint:** Phase 4.10 aggregate CSV exports are committed as `570e0c0`; Phase 4.11 artifact references are committed as `ccc4fcc`; Phase 4.12 document conversion is committed as `20dd290`; Phase 4.13 selected numeric totals passed strict typecheck, the full 105-test isolated MongoDB suite, and independent review, and is ready for local commit. Phase 4 remains IN PROGRESS because additional file workflow families remain. Resume with `git status --short` and `git log -1 --oneline`; commit 4.13 before continuing. The independent developer trial remains pending until another developer performs it.
- **Phase 4.10 evidence:** `npm run typecheck` passed; the loopback isolated MongoDB test suite passed (98 passed, 0 failed, 0 skipped); independent review reported no findings; CLI tests verify invalid formats and interactive approval gates. Changed files: `src/cli.ts`, `src/artifacts/drafts.ts`, `src/artifacts/csv-analysis-export.ts`, `test/csv-analysis-export.test.mjs`, `test/csv-analysis-cli.test.mjs`, README, architecture, implementation plan, and this tracker. `git diff --check` passed.
- **Current phase/subphase:** Phase 2.1 and live Phase 2.2 are COMPLETE for their stated slices; Phase 2 is COMPLETE. Phases 3.1–3.4 and 4.1–4.9 have verified bounded foundations; richer artifact references/report workflows remain. Phase 5.1–5.6 foundations are COMPLETE. Phase 6.1 local loopback foundation and 6.2 query-only Groq research are COMPLETE for their bounded slices; broader browser/design workflows and owner-approved target acceptance remain. Phase 7.1–7.4 are COMPLETE for their stated slices; tool-bearing/browser/data specialist integrations remain, so Phase 7 remains IN PROGRESS. Phase 8.1–8.2 and 8.4 dependency remediation are verified; Phase 8.3's prepared independent developer trial remains pending, so Phase 8 is IN PROGRESS.
- **Last completed work:** Phase 8.1 offline cached Windows consumer and dependency-tree verification; Phase 8.2 contributor guidance/package-content audit; Phase 6.2 consented live-verified Groq browser research (`af724b7`); Phase 7.3 bounded read-only specialist review (`d1c0a01`).
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
- **Current integrated verification:** `npm run typecheck`, `npm run build`, `npm test` (86 passed, 0 skipped, 0 failed, isolated local MongoDB), Playwright loopback/Chromium fixture, document resume, and metadata-persistence checks passed. Phase 6.2's live synthetic Groq browser-search request returned 10 validated sources, including an official Groq source; no query content or secret was printed. A temporary offline Windows consumer installed 240 cached packages, ran the CLI shim/version/help, and passed the full production dependency-tree listing across 554 nodes. `npm pack --dry-run --json` listed 34 files, including browser audit and document resume modules, with no `.env` or test/tracker files. Atlas SRV DNS resolved three nodes and redacted authenticated ping succeeded outside the sandbox; no database credential or IP-list change was made.
- **Outstanding:** Phase 6 candidate website/journey awaits owner target selection before an audit; broader browser/design workflows remain. Phase 7.4 scheduling is verified with canonical awaiting-approval runs, stable occurrence IDs, non-replaying completion recovery and explicitly confirmed stale-claim recovery. Phase 7 tool-bearing/browser/data specialist integrations remain future work. Phase 8.4 dependency remediation and document fixture verification are complete for the current locked tree; the prepared independent developer trial remains external and pending. No push.
