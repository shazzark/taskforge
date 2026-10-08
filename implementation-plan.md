# Implementation Plan

## Method and status
Phase 0 inspection and document alignment are COMPLETE. Planning baseline commit `45c949e` is present and verified. Phase 1 is IN PROGRESS (subphase 1.1); phases 2-8 are NOT STARTED. Use build-in-verified-phases where installed. Each phase records goal, scope, dependencies, acceptance, checks and actual results. Stop dependent advancement on failed required verification. No date overrides checks. Dates below are planning windows, not commitments.

## Phase 0 - Baseline and Windows setup (8-9 October)
Goal: reviewed documents, public repository, local folder and skills/tool inventory. Scope: README, MIT, Node ignore rules, root planning Markdown files and phase tracker. Repository: https://github.com/shazzark/taskforge (origin URL verified). Acceptance: requirements and unresolved proposals visible; local Git baseline is recorded. Checks: planning baseline commit `45c949e` exists; Node/npm/Git and Codex versions, skills and current AGENTS instructions inspected; no secrets printed. No runtime implementation.

## Phase 1 - CLI, configuration and MongoDB (9-10 October)
Goal: commands/chat shell, validated settings, MongoDB connection, doctor and errors. Dependencies: Phase 0. Acceptance: clean Windows setup, redacted logs and deterministic failure when DB unavailable. Verify typecheck, CLI smoke tests and disposable DB integration. No browser or mutation tools.

## Phase 2 - Providers and agent loop (10-12 October)
Goal: local/free-tier adapters, validated tool calls, budgets, cancellation. Dependencies: Phase 1. Acceptance: real model completes a small read-only tool task; unsupported tools/provider quota errors are honest. Verify mock contract/error cases plus real provider runs. No arbitrary shell access.

## Phase 3 - Permissions, events and resume (12-13 October)
Goal: roots, denied secrets, batch previews, bounded events/checkpoints and state revalidation. Dependencies: Phase 2. Acceptance: escape/changed-target/denial tests, cancel/resume and DB-failure checks pass. No new task family until boundary checks pass.

## Phase 4 - Files, data and report adapters (13-15 October)
Goal: inventory, CSV calculations, approved organization, input parsers and requested outputs. Dependencies: Phase 3. Acceptance: fixture counts/totals and file integrity match; PDF renders; unsupported formats fail. Verify paths, format fixtures, malformed input and artifact hashes.

## Phase 5 - Software workflow (15-17 October)
Goal: repository inspection, seeded bug investigation, approved patch, reviewed command runner and local diff. Dependencies: Phase 3; report adapters for final output. Acceptance: seeded failure reproduced and corrected, relevant tests run, secret/path controls remain. Verify against disposable repository. No Git push/deploy.

## Phase 6 - Browser, research and design observations (17-20 October)
Goal: Playwright journeys, network/console/link checks, passive security, responsive/a11y observations, design report and sourced comparisons. Dependencies: providers, permissions and artifacts. Acceptance: seeded failures detected, exact executed check inventory, source references and inferred labels. Verify fixture site and approved real site. Active security and sensitive form actions are separately gated.

## Phase 7 - Connections, scheduling and specialist agents (20-22 October)
Goal: GitHub read/drafts, local schedules, email drafts and bounded delegation. Dependencies: preceding tool/permission foundations. Acceptance: mocked and real read integration where authorized, no accidental sending/publishing, shared budgets, repeat-run suppression and worker review. Requires clarified integration inputs. No unrestricted third-party executable plugins.

## Phase 8 - Release gate (22-24 October)
Goal: clean Windows consumer trial, documented workflows, contribution guide, licence/dependency review and distribution checks. Dependencies: all declared release workflows COMPLETE. Acceptance: another developer runs documented scenarios; all required checks recorded. Clone release first. npm publish only after tarball consumer verification and explicit publication authorization. Check naming availability before package release.

## Deadline policy
Before 25 October is ambitious for the whole scope. If any required workflow is unfinished, publish an honestly labelled development preview only or revise target with owner. Do not cut owner scope without discussion or call partial scope complete. Prioritize verification over adding more tasks.

## Agent use
Implementation may delegate independent adapter/tool work after shared contracts are stable. Give each worker owned files, goal, constraints and checks; primary integrates and verifies. Reviewer checks permissions and claims. TaskForge's runtime specialist agents are separate from Codex subagents used to build it.
