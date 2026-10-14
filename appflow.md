# Application Flow

## Setup
Install prerequisites -> clone -> install dependencies -> configure MongoDB -> choose local/online model -> configure credentials outside Git -> doctor checks model, database and enabled tools -> grant workspace roots -> run a sample workflow. Credentials are never pasted into planning documents.

## One task
Receive goal -> resolve named workflow or interpret request -> ask for missing inputs -> show plan, scope and model destination -> inspect within approved roots -> preview required mutations -> obtain batch approval -> execute bounded actions -> collect evidence -> validate -> save artifacts and final status. 'Test website' requires URL, permitted target, scope and relevant journeys before execution.

## Chat
Keep conversation context for the active session. Follow-up requests can revise the task, but expanded filesystem/tool scope needs new authorization. Explicitly identify whether a new run or continuation is created. Save transcript only if configured.

## Approval
Show exact action, target, side effect and relevant content. User accepts or rejects a batch. Approval covers only those actions; new scope, changed target state or different command requires a new approval. Denial is reported honestly and can result in a partial task.

## Failure/cancel
Unavailable model -> explain -> offer configured alternative without switching. Tool failure -> bounded retry only where safe -> report unresolved issue. Budget -> checkpoint and stop. Ctrl+C -> cancel and record state. Persistence failure -> stop further effects. None of these paths produces a success label.

## Resume
Select run -> load checkpoint -> inspect current state -> invalidate outdated plan/approvals -> identify completed and uncertain actions -> show revised continuation -> proceed within renewed authority. Never assume a previous failed request had no effect.

## Schedule
Select tested named workflow and explicit inputs -> set timezone and trigger -> document local runner requirement -> save schedule. At execution, use authorized scope; pause on fresh approval needs. Email drafting produces a local artifact only. Publishing, purchasing and deployment have no first-release execution path.

## Contributions
Add definition with schema, tools, examples and tests -> validate locally -> open GitHub PR -> reviewed checks -> merge by maintainer. No task definition can add new executable code at runtime or override permissions.

## Current behavior boundary - 14 October 2026

The flows above describe the intended product behavior, not the current CLI. Today commands use fixed dispatch; `chat` is bounded model-only text with no tools or transcript persistence. There is no natural-language workflow resolver or task registry. Current capabilities and exact commands are recorded in `CAPABILITY_AUDIT.md`. Do not use these target-flow descriptions as evidence that an area is implemented.

## Approved target flows and required gates

### Goal and interactive conversation

One-shot goal -> classify against validated registry -> request missing required inputs -> show workflow, exact proposed actions, required permissions, provider/data destination and budget -> obtain each necessary approval -> execute through the existing central tool/permission boundary -> perform relevant approved verification -> show evidence-linked outcome and resume identifier where safe. Unknown or ambiguous goals ask the owner or stop; model text cannot select a broader tool, origin, path, or permission. Interactive chat uses the same resolver and orchestrator, retains only the active session context by default, marks new run versus continuation, and obtains fresh approval when a follow-up expands scope. Provider consent applies to the exact disclosed transfer.

### Agent-generated software change

Inspect only approved files -> identify evidence and uncertainty -> generate bounded diff against captured target hashes -> display exact files/changes and verification command -> owner approves or declines -> revalidate target snapshots and grants -> apply only approved diff -> run the relevant fixed check under separate command approval -> report changed files, check output status and remaining issues. A decline or stale target changes no file. A failed check is not a successful task. Git commit/push is outside this workflow.

### Registry and tools

Load versioned declarative definitions from the trusted local registry -> validate instruction length, input/output schemas, example shape and fixed tool names -> resolve tools by intersecting definition requirements with the host catalog and current grants -> reject unknown/invalid definitions. Definitions may not contain executable code or mint permissions. Arbitrary community executable tasks remain deferred.

### Storage selection

New setup defaults to local storage. A user who elects to keep/use MongoDB explicitly selects its adapter and configures it. The selected adapter is shown in diagnostics. Failure stops the task; there is no silent storage fallback. Existing MongoDB data is preserved and neither migrated nor deleted automatically.

### Research and connected read-only reports

Research query -> exact transfer consent -> retrieve bounded sources -> validate source metadata -> connect each factual comparison claim to cited evidence -> show disagreements, unsupported claims and retrieval limitations. Architecture reports inspect only approved project files and cite path/line evidence. GitHub/Vercel tracing uses only authorized read scopes and identifies the account/project scope and evidence URL for every conclusion. Network denial, expired access or incomplete results produce blocked/partial status rather than a guessed report.

### Lifecycle and retention

Every workflow declares whether it can be cancelled, checkpointed, resumed, and what side effects may be uncertain. Cancellation records the observed terminal/interrupted state; it does not imply rollback of an already completed side effect. Resume reloads validated checkpoints, rechecks workflow/input/target hashes and permissions, prompts for renewed approvals, and refuses unsafe duplicate replay. `history` displays redacted metadata and documents retention/deletion; conversation and source contents remain excluded by default. Existing CSV/document resume and foreground CSV/document schedule semantics remain supported during expansion.

### Human acceptance

The owner walkthrough uses only temporary synthetic fixtures, tests at least one approval, denial, cancellation and failure path, and checks produced output hashes/content. BookFinder testing uses a fresh headed ephemeral context; owner login and a separate read-only journey approval are required. The independent developer trial is performed by a different developer from a clean Windows setup and cannot be marked complete by implementation agents or owner self-test.
