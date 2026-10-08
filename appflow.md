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
