# Technical Requirements

## CLI contract
Proposed commands: taskforge "goal"; taskforge chat; taskforge run <workflow> --input <path-or-url>; taskforge workflows list; taskforge config; taskforge doctor; taskforge resume <run-id>; taskforge history list; taskforge history delete <run-id>; taskforge schedule list/add/remove. Names are provisional. Omitted required inputs trigger questions, never guesses. Exit codes distinguish verified success, failed task, cancellation and setup errors. Support spaces in Windows paths and UTF-8 output. Interactive approval is unavailable in noninteractive runs, so approval-required actions stop.

## Input/tool contract
Validate task inputs and tool arguments with runtime schemas. Every tool declares name, description, input schema, access requirements, effect classification, timeout and output limits. Reject unknown tools and invalid arguments. Tool results include status, evidence and bounded output. Treat model responses as untrusted input. Include idempotency identifiers for operations where supported. Persist action intent before mutation and outcome afterward.

## Provisional run budgets
30 tool actions; 40 model requests; 15 minutes of active runtime excluding approval waiting; 3 equivalent consecutive failures. Limits apply across parent and workers, not per agent. Maximum two workers; bounded context and tool-output sizes. Stop at a limit, save progress and offer a deliberate extension. Provider spending ceiling only when usage/pricing can be measured; do not promise exact costs from a request count. Provider quotas remain independent.

## Cancellation and recovery
Ctrl+C requests cancellation, stops new actions, aborts supported requests and terminates child processes with a bounded grace period. Record cancelled or uncertain outcomes. Preserve completed artifacts. Resume validates checkpoint version and current inputs and requires fresh approvals where necessary. Cancellation cannot reverse an already completed external action.

## History recommendation
Save detailed run summaries and redacted, truncated tool events by default, not full chats. Full transcripts are opt-in with disclosure. Proposed defaults: raw events/transcripts expire after 30 days, summaries after 90 days, maximum 5 MB stored event/transcript payload per run; oversized outputs become local artifacts. Artifacts have separate cleanup rules and no implicit TTL deletion. Secret redaction precedes persistence. User deletion removes a run's database records and only its owned artifacts when explicitly requested.

## Checks by capability
Files: path escape, junctions, secret filtering, unchanged-content moves, duplicate-name conflicts. Data: known totals, duplicates, missing values, encodings and malformed CSV. Software: reproduce seeded regression, inspect approved diff and rerun relevant tests. Browser: controlled HTTP errors, failed requests, console failures, broken link and mobile overflow; login checks only with supplied accounts. Research: sources actually retrieved, timestamps, contradiction/unsupported-claim handling. Agents: budget sharing, denied tools, write conflicts and parent review. Scheduling: missed runs, duplicate suppression and approval-required state.

## Security and privacy
No credentials in logs, screenshots intended for sharing, reports, fixtures or Git. Explicit online-transfer disclosure and user choice. Restrict network destinations where needed; protect against private-network access when processing untrusted URLs. Browser tests against localhost require explicitly approved local targets. Avoid rendering untrusted HTML directly into reports. No claim of comprehensive penetration testing or security certification.

## Distribution
Document tested Node version, MongoDB installation/connection, local model and browser setup on Windows. Pin dependencies and commit lockfile. npm package must declare actual files, executable and engine requirements. Validate tarball on a separate Windows consumer project before publishing. MIT covers TaskForge code, not automatic relicensing of model weights or dependencies.
