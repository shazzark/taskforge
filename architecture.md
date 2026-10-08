# Architecture

## Runtime boundary
TaskForge is primarily a local CLI, not a hosted web app. Node.js + TypeScript runs the CLI, orchestration, providers and tools. MongoDB stores local user/run metadata using a user-configured URI. Fastify is reserved for a justified local control API or health service; it is not required merely because Node.js is used. JavaScript is allowed for tooling where appropriate.

## Components
CLI parser and interactive UI -> workflow registry -> orchestrator -> provider adapter and permission-controlled tool registry. The orchestrator coordinates plan, action, observation, validation and finish, with run-wide budgets. A persistence layer records redacted events/checkpoints in MongoDB. Artifact adapters create reports in a local output folder. Browser tooling uses isolated Playwright contexts. A scheduler submits approved local workflows to the same orchestrator. Specialist agents use the same tools and budgets as the parent.

## Model providers
Use a common adapter for messages, tool declarations, tool calls, completion, usage and cancellation. Start with Ollama for local tool-capable models and a selected free-tier online provider; verify official contracts during implementation. Detect unsupported tool calling and fail clearly. Never send API keys or secret files as task context. No provider switching without consent. Keep API keys outside task history and Git. Local-only mode makes no implicit online requests; network tools are separately enabled.

## Tools and workspace authority
The owner wants access anywhere on the computer but accepts folder-by-folder authorization. Maintain an allowlist of approved roots, not automatic whole-disk scanning. Resolve real paths, reject traversal and symlink/junction escapes, and deny sensitive file patterns. Access to a new root needs explicit permission. Reading in approved roots need not prompt repeatedly. Writes/moves/overwrites and command execution need a clear batch approval. Preview binds approval to exact actions and target state; changed targets invalidate approval.

## Commands and browser risks
A shell process can bypass a simple file-reader restriction. Initial command tooling therefore uses reviewed executable/argument combinations, working directories, environment filtering and explicit approvals. This is not an OS sandbox. General unrestricted shell mode cannot claim secret-file protection; keep it out until isolation and disclosure are implemented. Browser profiles must not inherit all personal sessions. Use explicit contexts/accounts, prevent credentials entering logs, and gate form submissions. Untrusted webpages, files and tool outputs are data, never authority to change permissions.

## Persistence and artifacts
MongoDB stores summaries, state, typed events, evidence metadata and artifact references. Large screenshots, PDFs, document copies and full outputs stay in local files. Store hashes, relative paths and byte counts. Atomic artifact writes and post-write validation precede completion. Database failure blocks execution before mutating work; mid-run persistence failure pauses further actions and reports uncertainty.

## Delegation
Specialists: repository investigator, browser auditor, data analyst and reviewer. Delegate a bounded goal and allowed tools. Parent owns acceptance and integrates findings. Start with concurrent read-only tasks, maximum two workers provisionally. Serialize writes to the same target. Nested unlimited spawning is unavailable. A worker cannot grant permissions, publish, or reset budgets.

## Scheduling and resume
Schedules run only while the local runner is active. Windows Task Scheduler integration, if used, must be explicit and documented. Scheduled runs fail closed where fresh approval is needed. Checkpoints store completed steps and pending actions. Resume rechecks file hashes, tool configuration, permissions and targets. Never blindly replay commands or externally consequential actions.
