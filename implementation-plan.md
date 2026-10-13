# Implementation Plan

## Method and status
Phase 0 inspection and document alignment are COMPLETE. Planning baseline commit `45c949e` is present and verified. Phase 1 is COMPLETE. Phase 2 is COMPLETE for its bounded provider and read-only tool-loop scope: Groq live verification remains the default path, and a live Ollama 4K-context run made a real tool call and used its result; CPU inference and available-memory headroom were slow/low on the laptop. Phase 3 is IN PROGRESS: approved-root/action-preview foundations, MongoDB run persistence, and durable scoped folder approvals are verified; CSV run/history/resume CLI is verified on local MongoDB. Atlas authenticated ping is verified outside the sandbox; sandbox DNS timeout was an environment restriction. Phase 4 is IN PROGRESS: bounded parser/render cores, metadata-only analysis, document conversion, aggregate exports, numeric totals, artifact references, and approved exact-file moves are verified; additional file workflows remain. Phase 5.1–5.6 foundations are COMPLETE. Phase 6.1 loopback browser foundation and 6.2 Groq browser research are COMPLETE for their bounded slices; broader browser/design workflows and owner-approved real-site acceptance remain. Phase 7.1–7.4 are COMPLETE for their stated slices; richer tool-bearing/browser/data specialist integrations remain, so Phase 7 is IN PROGRESS. Phase 8.1–8.2 and 8.4 dependency remediation are verified; the prepared independent developer trial remains pending, so Phase 8 is IN PROGRESS. Continue numbered phases in dependency order while allowing independent work whose prerequisites pass. Commit verified substantial subphases locally using their phase number. Never push without an explicit user request. Stop only for unresolved required verification failures, missing credentials/setup that cannot be safely resolved, or material decisions outside agreed scope. Record actual results in `task.md`; no date overrides checks. Dates below are planning windows, not commitments.

Phase 4.10 adds verified aggregate-only CSV exports in JSON, CSV, or Markdown. It uses persistent write-scope approval plus an interactive content/path/hash confirmation and create-only hash-verified output. Phase 4.11 links those exports to completed CSV runs through metadata-only artifact references. The implementation passed strict typecheck and the full isolated MongoDB suite (98 passed, zero skipped); peer review found one reporting gap, which was fixed and confirmed resolved. Phase 4.12–4.14 add document conversion, selected numeric totals, and approved exact-file moves; Phase 4 remains IN PROGRESS because additional file workflow families remain.

Phase 4.12 implements plain-text conversion for bounded TXT, Markdown, text PDF, DOCX, and XLSX inputs, with a 64 KiB output limit, fresh folder/write approval, create-only hash verification, and metadata-only document-run artifact references. Strict typecheck and the full isolated MongoDB suite passed (101 passed, zero skipped); independent review findings were fixed. Phase 4 remains IN PROGRESS because additional file workflow families remain.

Phase 4.13 wires explicitly selected numeric CSV columns into the persisted workflow and all structured report formats. Selection names affect the checkpoint hash; strict typecheck and the full isolated MongoDB suite passed (105 tests, zero skipped), and independent review found no remaining issues after prototype-key and Markdown-label fixes.

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

Phase 6.2 query-only research is implemented with Groq's built-in browser search. It requires interactive consent, a supported GPT OSS model, validates returned source metadata, and persists nothing. It uses existing Groq credentials; no separate search account or key is required. Phase 6.1 uses Playwright 1.64 and project-local Chromium for a consented loopback-only audit fixture, blocks external requests and unsafe methods, and persists aggregate counts only. The local fixture slice is verified; real-site acceptance and broader design/audit workflows remain pending.

## Phase 7 - Connections, scheduling and specialist agents (20-22 October)
Goal: GitHub read/drafts, local schedules, email drafts and bounded delegation. Dependencies: preceding tool/permission foundations. Acceptance: mocked and real read integration where authorized, no accidental sending/publishing, shared budgets, repeat-run suppression and worker review. Requires clarified integration inputs. No unrestricted third-party executable plugins.

## Phase 8 - Release gate (22-24 October)
Goal: clean Windows consumer trial, documented workflows, contribution guide, licence/dependency review and distribution checks. Dependencies: all declared release workflows COMPLETE. Acceptance: another developer runs documented scenarios; all required checks recorded. Clone release first. npm publish only after tarball consumer verification and explicit publication authorization. Check naming availability before package release.

## Deadline policy
Before 25 October is ambitious for the whole scope. If any required workflow is unfinished, publish an honestly labelled development preview only or revise target with owner. Do not cut owner scope without discussion or call partial scope complete. Prioritize verification over adding more tasks.

## Agent use
Implementation may delegate independent adapter/tool work after shared contracts are stable. Give each worker owned files, goal, constraints and checks; primary integrates and verifies. Reviewer checks permissions and claims. TaskForge's runtime specialist agents are separate from Codex subagents used to build it.


Phase 4.14 adds a persistent-scope-gated exact-file move for supported document/data suffixes. It refuses existing destinations and uses a verified same-volume hard link before unlinking the source. Acceptance includes source digest/path revalidation, collision/change tests, interactive CLI gating, and independent review; the full isolated MongoDB suite is required before completion.
