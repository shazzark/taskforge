# Implementation Plan

## Method and status
Phase 0 inspection and document alignment are COMPLETE. Planning baseline commit `45c949e` is present and verified. Phase 1 is COMPLETE. Phase 2 is COMPLETE for its bounded provider and read-only tool-loop scope: Groq live verification remains the default path, and a live Ollama 4K-context run made a real tool call and used its result; CPU inference and available-memory headroom were slow/low on the laptop. Phases 3 and 4 are COMPLETE for their declared bounded v1 workflows: approved-root/action-preview foundations, MongoDB run persistence, and durable scoped folder approvals are verified; CSV run/history/resume CLI is verified on local MongoDB. Atlas authenticated ping is verified outside the sandbox; sandbox DNS timeout was an environment restriction. Phase 4 acceptance reconciliation maps all PRD file/data workflows to verified bounded inventory, parsing, deterministic analysis, export, conversion, and exact-file move workflows; unsupported OCR/legacy formats are documented. Phase 5.1–5.9 are COMPLETE for their declared scopes; the full serial suite passed with the isolated MongoDB integration enabled on 2026-10-14. Phase 6.1-6.9 implementation and controlled fixture verification are complete for bounded checks; the approved unauthenticated `/discover` route returns HTTP 200 and client-routes to `/login`, so live journey acceptance remains IN PROGRESS pending an accessible approved state. Phase 7.1-7.6 are COMPLETE for their bounded slices, including approved browser/data specialist integration and retained schedule semantics. Phase 8.1–8.2 and 8.4–8.5 package/dependency checks are verified, including a fresh production-only Windows consumer install; the prepared independent developer trial remains pending, so Phase 8 is IN PROGRESS. Continue numbered phases in dependency order while allowing independent work whose prerequisites pass. Commit verified substantial subphases locally using their phase number. Never push without an explicit user request. Stop only for unresolved required verification failures, missing credentials/setup that cannot be safely resolved, or material decisions outside agreed scope. Record actual results in `task.md`; no date overrides checks. Dates below are planning windows, not commitments.

Phase 4.10 adds verified aggregate-only CSV exports in JSON, CSV, or Markdown. It uses persistent write-scope approval plus an interactive content/path/hash confirmation and create-only hash-verified output. Phase 4.11 links those exports to completed CSV runs through metadata-only artifact references. The implementation passed strict typecheck and the full isolated MongoDB suite (98 passed, zero skipped); peer review found one reporting gap, which was fixed and confirmed resolved. Phase 4.12–4.14 add document conversion, selected numeric totals, and approved exact-file moves; Phase 4 is COMPLETE for the declared v1 workflow list after acceptance reconciliation recorded in task.md.

Phase 4.12 implements plain-text conversion for bounded TXT, Markdown, text PDF, DOCX, and XLSX inputs, with a 64 KiB output limit, fresh folder/write approval, create-only hash verification, and metadata-only document-run artifact references. Strict typecheck and the full isolated MongoDB suite passed (101 passed, zero skipped); independent review findings were fixed. Phase 4 is COMPLETE for the declared v1 workflow list after acceptance reconciliation recorded in task.md.

Recovery status (19 October 2026): `origin/main` is at `c0b35cc`; the 42 commits ahead at recovery start were unpushed, and current work remains local. Phase 9 is COMPLETE. Phases 10–14 remain in progress with gates in `task.md`; Phase 10.3 has a shared adapter contract, Phase 10.4 verifies process-exit rollback, Phase 10.5 adds cross-process SQLite claim/first-open checks, and Phase 10.6 makes new Mongo event writes atomic with their run budgets while retaining legacy event reads. Full workflow parity, production ACL policy, backup/restore, and power-loss durability remain. Phase 12.4 routes eligible installed CSV definitions through the fixed approved adapter; task metadata now helps the provider choose among eligible definitions, while ambiguous-intent fixtures ask for clarification and execute nothing. Live model intent behavior and owner TTY acceptance remain unverified. Phase 15.1 checkpoint binding/history-list work is verified; broader lifecycle remains IN PROGRESS. Phase 16 has the bounded manual-login implementation but still needs synthetic end-to-end and owner-operated BookFinder acceptance. Phase 17 is IN PROGRESS: exact-file JS/TS reports and Mermaid graphs, selected-file JS/TS resolution, and line-based Python import evidence with selected-file relative resolution are implemented and fixture-tested; broader languages, aliases, compiler/package resolution, multiline/dynamic Python imports, and whole-repository inventory remain. Phase 18 is IN PROGRESS: bounded read-only GitHub/Vercel adapters, CLI approval, and fixtures are implemented; live Vercel mapping/token verification remains. Phase 19.1 inventory and 19.2 Playwright production-dependency/package import checks are verified; a bundled runtime, guided setup and clean-machine acceptance remain unimplemented and depend on further Phase 10 gates. Phase 20 remains pending owner and independent developer acceptance. The full isolated integrated suite passed 218/218, zero failures/skips; one earlier transient help-subprocess timeout passed alone and on the unchanged full retry. A subsequent input-validation hardening passed strict typecheck/build and focused agent tests 13/13.

## Cross-cutting code organization and maintainability

Status: COMPLETE at checkpoint 20. The final isolated serial suite passed 200/200, 0 failed, 0 skipped in 157.4 seconds after the browser, permissions, agent-session, and reviewed-software CLI extractions.

This refactor does not add a twelfth product work area. It reorganizes existing implementation behind responsibility-based modules while preserving public CLI behavior, persistence compatibility, strict TypeScript, and permission boundaries. See the codebase map in `CONTRIBUTING.md`.

**Checkpoint 1 — CLI task-registry command extraction: VERIFIED.** Moved the built-in `tasks` command handler into `src/cli/commands/tasks.ts`; `src/cli.ts` retains package entry, top-level dispatch, and all other commands. No package or TypeScript configuration changes were needed.

**Verification:** `npm run typecheck`, `npm run build`, and `node --test test/cli/tasks.test.mjs test/agent/task-registry.test.mjs` passed (6/6). The command's output, status codes, schema validation, em-dash output formatting, and secret-safe field reporting remain covered by the feature-adjacent tests.

### Checkpoint 2 — Shared storage boundary and adapters: VERIFIED

Moved persistence contracts, shared domain types/errors, SQLite and MongoDB adapters into `src/storage/`; the cross-adapter port is now explicit and no longer derives from the Mongo implementation type. Updated workflow/scheduler/CLI imports and moved storage tests into `test/storage/`. Mongo collections, SQLite schema, and CLI backend selection are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and isolated `node --test test/storage/sqlite-store.test.mjs test/storage/mongodb.integration.test.mjs test/storage/store-contract.test.mjs` passed (15/15), using a dedicated temporary `LOCALAPPDATA` and loopback Mongo test URI. This includes the interrupted SQLite transaction check and both adapter contracts.

### Checkpoint 3 — Place configuration in its responsibility folder: VERIFIED

Moved configuration loading and validation to `src/config/configuration.ts`; updated provider, integration, storage, CLI, and test imports. Configuration behavior and environment-variable contracts are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and the focused config/provider/storage/CLI test command passed (43/43), including nested tests under `test/config/`, `test/agent/`, `test/cli/`, and `test/storage/`.

### Checkpoint 4 — Move software capabilities under tools: VERIFIED

Moved reviewed command execution, patch application, model investigation, and Git diff review into `src/tools/software/`, with matching tests under `test/tools/software/`. Updated the CLI and Mongo integration imports and the codebase map. Permission boundaries, CLI behavior, and saved data remain unchanged.

**Verification:** Strict typecheck and build passed; focused software capability tests passed (15/15); the integrated serial suite passed (194/194, zero failed/skipped) using isolated local storage and loopback MongoDB. The initial integrated attempt had two existing five-second CLI subprocess timeouts under load; the focused CLI test file passed (4/4) and the full serial rerun passed. No timeout was changed.

### Checkpoint 5 — Extract public GitHub issue command: VERIFIED

Moved the public issue reader's argument/TTY/consent/result handler from `src/cli.ts` to `src/cli/commands/github-issues.ts`. The top-level CLI retains the executable entry and dispatch. Read-only adapter behavior and consent ordering are unchanged.

**Verification:** `npm run typecheck`, `npm run build`, and `node --test --test-concurrency=1 test/cli/github-issues.test.mjs test/github-public-issues.test.mjs` passed (3/3). Independent source review confirmed the network adapter is called only after consent; malformed and non-interactive CLI cases are tested. This checkpoint does not make live GitHub/Vercel access claims.

### Checkpoint 6 — Extract read-only deployment tracing CLI command: VERIFIED

Moved deployment-trace argument parsing, terminal/config/token preflight, exact-scope consent, adapter call, and result presentation into `src/cli/commands/deployment-trace.ts`. Kept the original preflight ordering and output protections. Added subprocess coverage for malformed input, non-interactive refusal, and token non-disclosure.

**Verification:** Strict typecheck/build and deployment CLI/adapter tests passed (6/6). Independent source review confirmed argument validation → TTY → local environment → token check → consent → adapter order. No live Vercel call or interactive token path was exercised.

### Checkpoint 7 — Move CSV analysis capability under tools: VERIFIED

Moved the bounded parser and analyzer to `src/tools/data/csv-analysis.ts`, moved its core tests to `test/tools/data/`, and updated the workflow, data-specialist sample, aggregate-export and CLI test imports. Updated contribution guidance to describe the current map.

**Verification:** Strict typecheck/build and focused CSV parser/export/CLI/data-specialist tests passed (20/20). Independent source review found no stale path or behavior change. No stored record or permission contract changed.

### Checkpoint 10 — Place the declarative task registry under workflows: VERIFIED

Moved `src/agent/task-registry.ts` and its feature test to `src/workflows/task-registry.ts` and `test/workflows/task-registry.test.mjs`. Updated current CLI/test imports, contribution map, and capability audit. The registry remains non-executable validated data; public CLI behavior and permission boundaries did not change.

**Verification:** Strict typecheck/build passed, and the registry plus task CLI tests passed (6/6) under isolated local-storage settings. A first CLI-only attempt without that test environment hit its existing five-second subprocess timeout; the isolated rerun passed. Independent source review found no stale active paths or behavioral changes. `git diff --check` passed.

### Checkpoint 11 — Place architecture reporting under workflows: VERIFIED

Moved the implementation and fixture tests from repository root into `src/workflows/architecture-report-workflow.ts` and `test/workflows/architecture-report-workflow.test.mjs`; updated imports and current codebase/capability maps. Added a build clean step for generated `dist/` output so stale outputs from moves do not enter packages. The report remains a local, exact-file, read-approved analysis and source is never executed.

**Verification:** Strict typecheck, clean build, all six architecture-report fixtures, `git diff --check`, and package dry-run passed. The moved test's stale relative import and the package audit's old compiled path were corrected. Independent review found no behavior or scope issue. The package inventory is now 52 entries and contains only the new architecture workflow output. Full integration remains pending before the overall refactor is called complete.

### Checkpoint 12 — Extract read-only repository inspection commands: VERIFIED

Moved repository inventory, selected-source review, and architecture-report handlers into `src/cli/commands/repository-inspection.ts`; the existing dispatcher injects the same store and persistent-read-approval helpers. Moved the shared approval error to `src/cli/command-errors.ts`. Added CLI coverage for exact argument and non-interactive TTY gates. No permission or workflow behavior was intended to change.

**Verification:** Strict typecheck and clean build passed. New CLI gate coverage and related repository-inspection, source-review, and architecture-report tests passed (11/11). Independent review confirmed the original consent, approval, workflow-call and error paths were preserved. `git diff --check` passed; full integration remains pending for the overall refactor.

### Checkpoint 13 — Extract scheduling CLI command: VERIFIED

Moved schedule argument parsing, schedule lifecycle output, recovery confirmation, foreground runner control, and scheduled CSV/document execution wiring into `src/cli/commands/scheduling.ts`. Existing store and approved-file behavior are injected by the entrypoint; scheduler mechanics stay in `src/scheduling/`.

**Verification:** Strict typecheck and clean build passed. Scheduling CLI gate coverage and scheduler fixtures passed (6/6). Independent review confirmed persistent and per-occurrence approval order, resume/recovery, SIGINT cleanup and store lifetime. The interactive path was source-reviewed, not driven end-to-end. `git diff --check` passed; the full integrated suite remains pending for overall refactor completion.

### Checkpoint 14 — Extract CSV and document CLI workflows: VERIFIED

Moved CSV analysis/export, document analysis/export/conversion, and CSV/document resume handlers and CSV argument parsing into `src/cli/commands/data-documents.ts`. The CLI entry point retains and injects the current file-read, storage, and persistent-folder approval helpers.

**Verification:** Strict typecheck and clean build passed. CSV/document CLI, workflow, export, and conversion tests passed (16/16). Independent review found no behavior or approval-order changes. Successful interactive approval, artifact-reference failure, and resume CLI paths are not newly exercised end-to-end; existing tests cover related workflow portions. Further responsibility separation and full integration remain before the overall refactor is complete.

### Checkpoint 15 — Extract artifact CLI commands: VERIFIED

Moved PDF-report and local-draft command handlers into `src/cli/commands/artifacts.ts`, injecting the existing approved-input and persistent-folder-approval helpers. Create-only output and exact content approval behavior remain unchanged.

**Verification:** Strict typecheck and clean build passed. The artifact CLI gate and draft/PDF capability suites passed (11/11). Independent review confirmed input consent, write grants, preview/hash confirmation, create-only writes, and dispatch behavior. `git diff --check` passed; the CLI and full-suite refactor remains in progress.

### Checkpoint 16 — Extract browser-audit CLI command: IN PROGRESS

Moved browser-audit CLI parsing, approvals, manual-login interaction, diagnostics presentation, screenshot paths, and optional aggregate specialist handoff into `src/cli/commands/browser-audit.ts`. The CLI entrypoint supplies the same store lifecycle and specialist review callback. No browser workflow or network policy changes are intended.

**Verification so far:** Strict typecheck/build, browser CLI gate and fixture tests, independent review, and final diff check remain before commit.

### Checkpoint 8 — Move document parsers and conversion under tools: VERIFIED

Moved the five bounded parser/conversion modules from `src/documents/` to `src/tools/documents/` and their feature tests to `test/tools/documents/`. Updated orchestration/sampling/CLI imports and current docs; workflows remain responsible for approvals and persistence.

**Verification:** Strict typecheck/build and focused parser, conversion, analysis-workflow, and data-specialist tests passed (26/26). Two deeper test imports initially retained the old relative path to the PDF renderer; after correcting them, the entire focused group passed. Independent review found no remaining active old imports.

### Checkpoint 9 — Move artifact rendering/output capabilities under tools: VERIFIED

Moved PDF rendering, CSV/document aggregate export, local draft rendering, and approved create-only output into `src/tools/artifacts/`; moved their tests under `test/tools/artifacts/`. Updated CLI and cross-feature test imports, the capability audit and contribution map. Workflows and commands continue to own consent, orchestration and persistence.

**Verification:** Strict typecheck/build and the combined artifact/document/data tests passed (49/49). Initial validation caught old relative imports in moved modules/tests; after fixing them, all affected tests passed. Independent review found no stale active paths or behavior changes.

**Next checkpoints:** Move feature capabilities in small dependency-aware slices and split additional CLI handlers by responsibility, retaining `dist/cli.js` as the executable entry. Run the integrated serial suite after the structural migrations. No unrelated behavior changes or new dependencies are included.

Phase 4.13 wires explicitly selected numeric CSV columns into the persisted workflow and all structured report formats. Selection names affect the checkpoint hash; strict typecheck and the full isolated MongoDB suite passed (105 tests, zero skipped), and independent review found no remaining issues after prototype-key and Markdown-label fixes.

Phase 6.3 extends the loopback browser fixture command with aggregate HTTP/request failures, console/page errors, bounded link checks, basic accessibility heuristics, mobile/desktop overflow, and selected passive response-header checks. Mixed-content coverage is marked skipped for HTTP fixtures. Strict typecheck, all 110 isolated MongoDB tests, fixture checks, and independent review passed. Real-site scope remains owner-provided and pending.

Phase 6.5 adds two-query research comparison. It performs two separately consented-in-one-prompt Groq browser searches, shows each unverified synthesis with its validated source excerpts, and marks exact shared URL matches without inferring claim-level agreement. Strict typecheck/build, focused contracts, 121 full isolated MongoDB tests, and independent review passed; live research remains optional and uses the existing Groq consent/configuration boundary.

## Phase 0 - Baseline and Windows setup (8-9 October)
Goal: reviewed documents, public repository, local folder and skills/tool inventory. Scope: README, MIT, Node ignore rules, root planning Markdown files and phase tracker. Repository: https://github.com/shazzark/taskforge (origin URL verified). Acceptance: requirements and unresolved proposals visible; local Git baseline is recorded. Checks: planning baseline commit `45c949e` exists; Node/npm/Git and Codex versions, skills and current AGENTS instructions inspected; no secrets printed. No runtime implementation.

## Phase 1 - CLI, configuration and MongoDB (9-10 October)
Goal: CLI command shell, validated settings, MongoDB connection, doctor and errors. Dependencies: Phase 0. Acceptance: clean Windows setup, redacted logs and deterministic failure when DB unavailable. Verify typecheck, CLI smoke tests and disposable DB integration. No browser or mutation tools.

## Phase 2 - Providers and agent loop (10-12 October)
Goal: interactive chat, local/free-tier adapters, validated tool calls, budgets, cancellation. Dependencies: Phase 1. Acceptance: real model completes a small read-only tool task; unsupported tools/provider quota errors are honest. Verify mock contract/error cases plus real provider runs. No arbitrary shell access.

## Phase 3 - Permissions, events and resume (12-13 October)
Goal: roots, denied secrets, batch previews, bounded events/checkpoints and state revalidation. Dependencies: Phase 2. Acceptance: escape/changed-target/denial tests, cancel/resume and DB-failure checks pass. No new task family until boundary checks pass.

## Phase 4 - Files, data and report adapters (13-15 October)
Goal: inventory, CSV calculations, approved organization, input parsers and requested outputs. Dependencies: Phase 3. Acceptance: fixture counts/totals and file integrity match; PDF renders; unsupported formats fail. Verify paths, format fixtures, malformed input and artifact hashes.

## Phase 5 - Software workflow (15-17 October)
Goal: repository inspection, seeded bug investigation, approved patch, reviewed command runner and local diff. Dependencies: Phase 3; report adapters for final output. Acceptance: seeded failure reproduced and corrected, relevant tests run, secret/path controls remain. Verify against disposable repository. No Git push/deploy.

## Phase 6 - Browser, research and design observations (17-20 October)
Goal: Playwright journeys, network/console/link checks, passive security, responsive/a11y observations, design report and sourced comparisons. Dependencies: providers, permissions and artifacts. Acceptance: seeded failures detected, exact executed check inventory, source references and inferred labels. Verify fixture site and approved real site. Active security and sensitive form actions are separately gated.

Phase 6.2 query-only research is implemented with Groq browser search after interactive consent. Phases 6.6-6.9 add owner-approved public HTTPS journeys using an isolated unauthenticated browser and DNS-pinned allowlisted egress; the integrated controlled fixture verifies Chromium-through-proxy behavior, delayed hydration, and authentication-gate stopping. Phase 6.10 adds bounded autonomous diagnostics: local screenshots and capped DOM snapshots, observed console/network/route failures, suspected-cause separation, and conditional additional-origin approval. Fixtures cover empty responses, delayed rendering, failed data requests, authentication gates, and blocked external resources. The approved live `/discover` URL returned HTTP 200 and ended at `/login` without stored browser state; the earlier `/` audit inspected before client hydration. Detailed evidence and remaining owner acceptance are recorded in task.md.

## Phase 7 - Connections, scheduling and specialist agents (20-22 October)
Goal: GitHub read/drafts, local schedules, email drafts and bounded delegation. Dependencies: preceding tool/permission foundations. Acceptance: mocked and real read integration where authorized, no accidental sending/publishing, shared budgets, repeat-run suppression and worker review. Requires clarified integration inputs. No unrestricted third-party executable plugins.

## Phase 8 - Release gate (22-24 October)
Goal: clean Windows consumer trial, documented workflows, contribution guide, licence/dependency review and distribution checks. Dependencies: all declared release workflows COMPLETE. Acceptance: another developer runs documented scenarios; all required checks recorded. Clone release first. npm publish only after tarball consumer verification and explicit publication authorization. Check naming availability before package release.

## Deadline policy
Before 25 October is ambitious for the whole scope. If any required workflow is unfinished, publish an honestly labelled development preview only or revise target with owner. Do not cut owner scope without discussion or call partial scope complete. Prioritize verification over adding more tasks.

## Agent use
Implementation may delegate independent adapter/tool work after shared contracts are stable. Give each worker owned files, goal, constraints and checks; primary integrates and verifies. Reviewer checks permissions and claims. TaskForge's runtime specialist agents are separate from Codex subagents used to build it.

## Recovery scope update — 14 October 2026

The owner approved browser and data specialists and public-site URL auditing. Phase 6.6 implements explicit approval of a public HTTPS target, exact read-only journey, and up to seven additional HTTPS resource origins. Phase 6.10 adds autonomous bounded screenshots, DOM snapshots with truncation reporting, console/network findings, same-origin safe-route probes, suspected-cause separation, and conditional additional-origin approval. Link destinations are restricted to recognized content routes without mutating route terms; this conservative classifier cannot establish server-side GET semantics. The audit uses an unauthenticated isolated browser, bounded DNS-pinned egress, GET/HEAD-only requests, no form submission or WebSockets, and aggregate persistence. Public document responses are fetched with automatic redirects disabled; redirect responses are blocked and not followed, so redirect-based login/CDN flows are a documented coverage limit. Supported journey actions include exact visible-text checks, constrained same-origin GET search, first visible Harry Potter result link, classified same-origin links, and browser back. Targeted visible waits, redirect isolation, and authentication-gate stopping are covered by controlled Chromium-through-proxy fixtures. The approved `https://the-bookfinder-v2.vercel.app/discover` returned HTTP 200 and client-routed to `/login`; no additional resource origin was accessed. The earlier `/` audit inspected before client hydration. Live discovery acceptance remains pending; details are recorded in task.md. GET route heuristics do not prove unknown server handlers are side-effect-free. This is not a comprehensive security or accessibility audit.

Phase 7.6 implements browser/data specialist handoff with explicit disclosure and transfer approval, selected-provider-only execution, shared request/action/time budgets, zero retries, cancellation, and parent review. Data extraction and heuristic redaction happen locally; only approved bounded evidence is transferred. Existing schedule semantics remain accepted and unchanged.

At the time of this note MongoDB was the only approved persistence choice. The owner's 14 October decision below supersedes proposal status for local-default storage, guided setup, architecture analysis, and read-only GitHub/Vercel tracing. Deployment actions remain deferred. Phase 8 remains IN PROGRESS until another developer completes the independent trial.

## Approved scope continuation - Phases 9–20 (14 October 2026)

The approved target is Sunday 18 October 2026. Four days are not credibly sufficient on current evidence for all new runtime layers, dual-storage acceptance, bundled Windows runtime, authorized external integrations, and separately operated human gates. This is an honest feasibility assessment, not a scope cut or date change. Continue the phases in dependency order and retain all unfinished work in the tracker. Every phase stays IN PROGRESS until its concrete gates pass.

| Phase | Work and dependencies | Acceptance gate |
|---|---|---|
| 9 — Requirements reconciliation | Current baseline plus approved 11 areas; update PRD/TRD/architecture/schema/app flow/plan/tracker. No runtime change. | Cross-document scope, status, authority and acceptance language agrees; proposals are no longer confused with approved-but-unimplemented work. |
| 10 — Persistence adapters | Local-default storage and explicit MongoDB adapter; depends on Phase 9. Preserve existing MongoDB records; no migration/deletion/fallback. | Adapter contract passes on isolated local and Mongo databases; parity, restart, locking, interrupted-write, schema-validation and unavailable-store checks pass; new-install default and explicit selection are proven; data/backup/restore policy is documented. |
| 11 — Declarative task registry | Local validated definitions over a fixed tool catalog; depends on Phase 9 and stable storage/config contracts. | Built-ins and examples validate; invalid schemas, unknown tools and permission escalation are rejected; definitions contain no executable plugin path; registry CLI/help and tests match. |
| 12 — Natural-language execution and tool-enabled chat | Shared intent resolver/orchestrator; depends on Phases 10–11 and existing approval/budget primitives. | Synthetic one-shot and multi-turn tests cover required-input questions, ambiguous/unknown intent, provider consent, tool result use, unapproved-tool rejection, shared budgets, denial, cancellation and failure. Groq remains default; no silent provider switch. |
| 13 — Agent investigation and approved changes | Evidence-backed code investigation, model-generated preview, exact approval/application and relevant checks; depends on Phases 11–12 and current safe file/command primitives. The current Phase 13.1 provides one source file and a complete-file replacement candidate. | Seeded synthetic bug fails relevant check; generated preview is hash-bound; decline leaves bytes unchanged; approval applies exactly previewed change; stale targets fail closed; relevant fixed check is separately approved and reported truthfully; no commit/push. Live provider/TTY and owner review acceptance remain required; multi-file agent edits are not implemented. |
| 14 — Research citations | Retrieval provenance, claim-linked citations and evidence-based comparisons; depends on consent/provider boundaries and Phase 12. Phase 14.1 enables Groq inline citations and maps provider source references to validated retrieved results. | Deterministic fixtures verify valid citation references map to retrieved evidence and unmapped citations/uncited sentences are surfaced; source disagreement/unsupported claims, escaping/partial provider failures are handled. Citation mapping does not prove semantic entailment. An approved live synthetic retrieval and owner review remain required. |
| 15 — Cancellation, history and resume | Complete lifecycle matrix; depends on Phase 10 and Phases 12–13. Preserve existing safe CSV/document recovery. | Per-command capability table; cancellation at each supported boundary, uncertain side effect handling, stale-state checks, no duplicate replay, retention/redaction/delete behavior, DB failure and crash/restart tests pass. Unsupported workflows explicitly remain non-resumable. |
| 16 — Browser and specialist acceptance | Retain tested boundaries; end-to-end browser and specialist scenarios; depends on Phases 12, 14 and 15. | Synthetic integration covers manual login + separate journey consent, worker shared budgets and tool limits. BookFinder search/results/details/back is separately owner-operated using fresh ephemeral browser/manual login; no profile import. Until done, live acceptance is pending. |
| 17 — Architecture reports and diagrams | Evidence-backed reports using approved project access; depends on permission/registry contracts and Phase 12. | Synthetic repo report cites actual inspected file/line evidence; scope escape, secret redaction, unsupported language, missing evidence and inference labeling fixtures pass; source is never executed. |
| 18 — GitHub/Vercel deployment tracing | Read-only APIs from explicitly authorized access; depends on Phase 12 and access-scope design. | Fixtures prove least-read scope, source links, redaction, no write endpoints, auth denial/expiry handling and partial status. Live verification waits for owner-authorized project/account access; no deployment action. |
| 19 — Guided setup and Windows distribution | Installer/bootstrap and bundled required runtime; depends on Phase 10 and stabilized CLI/provider/browser integrations. | Phase 19.1 documentation-only distribution inventory is complete in `PHASE19_DISTRIBUTION_AUDIT.md`. Then a clean Windows machine without preinstalled Node installs/runs; license/SBOM/package scan, no secret/session/private artifacts, package/runtime integrity, data preservation, upgrade/side-by-side and uninstall retention checks pass. No service provisioning/model download. |
| 20 — Acceptance and release readiness | Owner synthetic walkthrough plus independent developer trial; depends on all applicable implementation phases. | Owner approves or records each scenario result; another developer completes clean setup/trial; BookFinder live gate is recorded; full serial suite with isolated MongoDB, local storage tests, strict typecheck/build and package audit pass. No fabricated external acceptance. |

### Dependency graph and external gates

```text
9 -> 10 -> 11 -> 12 -> 13 -> 15 -> 16 -> 20
                    |      |      |
                    |      +-> 14 -+
                    +-> 17 --------+
                    +-> 18 --------+
10 + 12 + stable integrations -> 19 -> 20
```

Phase 16 BookFinder acceptance requires the owner to operate the already-open dedicated ephemeral headed browser, enter credentials manually, then approve the exact read-only journey. Phase 18 live Vercel tracing requires the owner to identify the exact Vercel project/team and configure a local read-only token; the CLI and fixture gate are implemented, and live access remains pending. Phase 20 independent trial requires another developer. Keep these external gates pending until actually performed. No personal browser profile, credentials in reports, or model downloads.

### Verification cadence

Before each phase, record a bounded scope and status. Add focused tests with implementation; run them before proceeding. For changes to shared runtime, CLI dispatch, storage, permissions or workflow state, also run strict `npm run typecheck`, `npm run build`, and serial `npm test` with `TASKFORGE_TEST_MONGODB_URI` set to a dedicated loopback test URI; include local-adapter tests as soon as Phase 10 exists. Browser/provider fixtures are not live service proof. Inspect `git diff`, `git diff --check`, package contents and secrets/artifacts before each local numbered checkpoint. Do not push further commits without a new explicit request.


Phase 4.14 adds a persistent-scope-gated exact-file move for supported document/data suffixes. It refuses existing destinations and uses a verified same-volume hard link before unlinking the source. Acceptance includes source digest/path revalidation, collision/change tests, interactive CLI gating, and independent review; the full isolated MongoDB suite is required before completion.

Phase 4.15 adds optional aggregate JSON, CSV, and Markdown exports for document analysis, with validated count-only output, persistent write grants, exact path/content-hash consent, create-only verification, and metadata-only artifact references. Strict typecheck, focused tests, isolated MongoDB integration, independent review and local commit f5ffdbe passed. Phase 4 acceptance is COMPLETE for the declared v1 workflows; unsupported formats and generalized organization are documented limits.


Phase 5.7 adds an exact relative-file selector to the reviewed Node test runner. Only in-root regular .js, .cjs, and .mjs test files are allowed; it adds no arbitrary runner flags or shell. Targeted-vs-unselected fixtures and path/race rejection passed; strict typecheck and the full isolated MongoDB suite passed (113 tests, zero skipped), and independent review found no remaining issues.

Phase 5.8 adds a fixed local TypeScript build check to the reviewed command runner. Build output is constrained to a fresh ignored directory under the approved root; external `outFile`, trace, and CPU-profile outputs are refused. Strict typecheck, focused tests, the full isolated MongoDB suite (118 passed, zero skipped), and independent permission-focused review passed.

Phase 5.9 (build artifact lifecycle; implementation verified, full suite rerun pending) corrects retained compiler output: each run owns one ignored `.taskforge-build-*` directory for ESM dependency resolution and removes it in `finally`; the next build conservatively reaps only old directories whose owner marker matches a UUID-bound random directory ID, whose recorded process is gone, and whose contents are generated-only. Unknown and active folders remain. npm package inclusion is constrained by the existing `files` allowlist.

### Code-organization checkpoint 16 — Browser-audit CLI extraction — VERIFIED

Moved browser-audit argument parsing, consent and manual-login prompts, result presentation, screenshot output, and optional specialist handoff into `src/cli/commands/browser-audit.ts`; the entrypoint injects the existing store lifecycle and specialist operation. Strict typecheck/build and focused browser CLI/workflow/egress-proxy tests passed (22/22), `git diff --check` passed, and independent review found no blocking issues. Interactive owner login was not attempted. Remaining CLI decomposition and the integrated suite are still required before this refactor is complete.

### Code-organization checkpoint 17 � Folder-permission CLI extraction � VERIFIED

Moved folder permission command handling to `src/cli/commands/permissions.ts`, with the existing store lifecycle injected from `src/cli.ts`. Strict typecheck/build and focused permissions/path-policy checks passed (14/14), `git diff --check` passed, and independent review found no behavior or permission-boundary regression. The contributing code map now includes the permissions command module. The interactive approval success paths remain a pre-existing coverage gap; remaining CLI decomposition and the full integration suite are still required.

### Code-organization checkpoint 18 - Natural-language and chat CLI extraction - VERIFIED

Moved `do` and `chat` command handling and CSV/document agent-tool wiring into `src/cli/commands/agent-session.ts`. The entrypoint injects the existing approved-file reader and store lifecycle. Focused agent session CLI/tool tests passed (9/9), strict typecheck/build passed, and `git diff --check` passed. Independent review found no behavioral differences: provider consent, exact-file approval, cancellation, shared budgets, bounded message history, and fixed tool exposure remain intact. Interactive approval and history success paths remain untested at CLI level, as before the move. The final integrated suite for this refactor remains required.

### Code-organization checkpoint 19 - Reviewed software CLI workflows - VERIFIED

Moved approved software checks, patch/fix/move actions, and staged Git diff review into `src/cli/commands/software-workflows.ts` with the existing store and persistent-grant helpers injected. Strict typecheck/build and focused tests passed (21/21); `git diff --check` passed; independent review found no approval or behavior regression. The final integrated serial `npm test` after this checkpoint passed 200/200, 0 failed, 0 skipped in 157.4 seconds with isolated local storage and a dedicated MongoDB test database.

### Code-organization checkpoint 20 - Final integrated verification - VERIFIED

The responsibility-based source relocation and CLI extraction are complete for the current approved product scope. `src/cli.ts` remains the executable entrypoint and top-level dispatcher, with shared storage/file-approval and diagnostic responsibilities; command families live in `src/cli/commands/`. The final serial `npm test` passed 200/200 with 0 failed and 0 skipped in 157.4 seconds against isolated local/Mongo test data. No deployment action or live owner-only acceptance was performed.

#### Phase 11.2 - Local declarative definition loading and management - VERIFIED

Bounded scope: load/install validated JSON definitions from the TaskForge per-user data directory and expose built-in plus valid local definitions through `tasks list`, `inspect`, and `validate`. Add create-only validated installation from an explicitly approved source file. Enforce direct-child `.json` discovery, file/count/total-size limits, ID collisions, symlink/path checks, and sanitized invalid-file reporting. Definitions remain data only: no task execution, plugins, permissions, provider selection, custom budgets, or natural-language routing in this subphase.

Verification used isolated temporary data roots and fixtures; the normal selected backend and application data were not reset or modified. Strict typecheck/build and focused registry/config/CLI checks passed. The final isolated integrated `npm test` passed 207/207, 0 failed, 0 skipped in 168.0 seconds with local storage isolated under `LOCALAPPDATA` and a dedicated loopback MongoDB test database. Independent review found the installation lock closes the concurrent capacity race and confirmed terminal-control escaping; stale locks fail closed and have a documented exact-file recovery procedure. Phase 11 is COMPLETE for the approved registry acceptance criteria. Definitions remain non-executable data; routing/execution belongs to Phase 12.

A later focused command-level check passed 10/10 task CLI/registry tests, including an injected approved-reader test for validate-only and install paths. It proves the CLI forwards the 64 KiB read bound and does not persist validation-only input; manual TTY approval is still unverified.

#### Phase 12.3 - Host feedback for invalid tool inputs - VERIFIED

The agent loop now returns generic, non-sensitive correction feedback for invalid arguments to a known fixed tool without executing any call in the batch. These attempts consume the shared tool budget but do not appear as completed actions in the run result. Unknown tool names still fail closed. If the request budget is exhausted, the host returns a fixed clarification prompt without making another provider request. Strict typecheck/build, focused agent session/CLI tests (13/13), and independent review passed. The isolated integrated suite passed 211/211 with 0 failures or skips in 176.4 seconds. Evidence covers agent-loop history continuation, not a live provider's ability to interpret ambiguous instructions or the full interactive TTY chat flow; Phase 12 remains IN PROGRESS.
