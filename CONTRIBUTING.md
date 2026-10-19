# Contributing to TaskForge

TaskForge is an early-development Windows-first TypeScript CLI. Contributions should preserve the permission boundaries and documented phase scope.

## Codebase map

`src/cli.ts` remains the executable entry point and top-level dispatcher. Command-specific parsing, validation calls, and terminal output belong in `src/cli/commands/`; add a thin handler there for a new command and delegate its behavior to the relevant workflow or application service. The task command is in `src/cli/commands/tasks.ts`. Agent planning, tool loops, and specialist coordination belong in `src/agent/`. Repeatable task behavior and definition validation belong in `src/workflows/`; built-in schemas are in `task-registry.ts`, and local registry filesystem handling is in `local-task-registry.ts`. Keep feature-specific validation and tests beside that feature (`test/workflows/` and `test/cli/`); create shared validation only when multiple features genuinely use the same rule. Evidence-based architecture reporting also belongs in `src/workflows/`. File, data, document, software, browser, and artifact capabilities belong under `src/tools/`; software, CSV, document, and artifact tools now live in `src/tools/software/`, `src/tools/data/`, `src/tools/documents/`, and `src/tools/artifacts/`. Provider APIs and provider contracts belong in `src/providers/`; external search, GitHub, and Vercel adapters belong in `src/integrations/`.

Persistence contracts, shared domain types/errors, and SQLite/MongoDB adapters now live under `src/storage/`; this is a structural relocation only and the persisted schema is unchanged. Approval and access-grant code currently lives in `src/security/`; place permission policy there or in `src/permissions/` when the permission boundary is separated. Network protections, path safety, untrusted-input handling, and redaction belong in `src/security/`. Schedule state and execution belong in `src/scheduling/`. Configuration loading and validation now live in `src/config/configuration.ts`. Add `src/shared/` only for types, errors, or utilities genuinely shared across features. Do not create empty backend-style folders or broad `helpers.ts`/`utils.ts` modules.

Keep validation, types, and helpers with the feature they describe. Put focused tests under matching feature directories in `test/` (for example, `test/agent/`, `test/cli/`, `test/storage/`, and `test/tools/`), and update direct compiled-module imports when source files move. Preserve NodeNext `.js` import specifiers, the `dist/cli.js` package entry point, strict TypeScript options, CLI output/exit codes, storage compatibility, and permission boundaries during structural changes.

## Development setup

- Use Node.js 22.13.0 or later and npm.
- Clone the repository and run `npm ci`.
- Copy `.env.example` to the ignored `.env` only when local services are needed. Fill placeholders locally; never commit or paste `.env` values into issues, logs, screenshots, or model prompts.
- MongoDB integration tests require a dedicated disposable database through `TASKFORGE_TEST_MONGODB_URI`. Use a local isolated test database, never a production URI.
- Live provider checks are optional for ordinary changes. Use synthetic inputs and explicit consent; do not reuse credentials intended for another project.

## Local task-definition registry

`tasks install --file <definition.json>` and `tasks validate-definition --file <definition.json>` require the existing exact-file read approval. Valid local definitions are stored as data under `%LOCALAPPDATA%\TaskForge\task-definitions` (or the configured per-user data root). Definitions matching the host's fixed CSV adapter can be selected through `do` or `chat`; they still use the same exact-file approval and persistent read grant as direct CSV analysis. Other declared capabilities do not execute until a reviewed host adapter exists. An interrupted installation can leave `.install.lock` in that directory. Installation fails closed while the lock exists. To recover, first close TaskForge commands, read the decimal process ID recorded in `.install.lock`, and check it with `Get-Process -Id <process-id>`. Remove only that exact `.install.lock` with `Remove-Item -LiteralPath <lock-path>` when the process ID is absent; if it is present, do not remove the lock. A reused process ID may cause a safe false block, in which case retry after that process exits.

## Before submitting changes

Run the applicable checks:

```powershell
npm run typecheck
npm run build
npm test
git diff --check
```

TypeScript must remain strict, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Validate untrusted input at runtime; do not use `any`, `@ts-ignore`, or unsafe assertions to silence errors. Keep tests bounded and avoid live services unless the change requires a documented integration check.

Update `task.md` and the relevant architecture/requirements documentation when behavior or phase status changes. Mark a phase complete only after its required live and mocked checks pass; mocks do not prove provider connectivity. Record blocked checks and evidence precisely.

## Safety and Git

- Preserve the approved-root, explicit-consent, bounded-action, and create-only artifact rules.
- Do not add send, publish, purchase, deployment, unrestricted shell, or automatic provider-switch behavior without an approved scope change.
- Never include credentials, database URIs, private source data, or generated `.env` files in a change.
- Use focused commits with the phase number when a substantial subphase is verified. Do not push unless explicitly requested. Do not rewrite published history.

## Reporting a change

Describe the behavior, evidence and commands run, known limitations, and any required owner setup. Keep claims aligned with the current `task.md` tracker and the actual test results.
