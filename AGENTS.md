# TaskForge Agent Instructions

## Authority
Read this file and the current PRD, technical requirements, architecture and implementation plan before changes. Preserve existing user work and inspect git status. Confirmed user decisions outrank recommendations. Do not silently reduce release scope or introduce unrequested services.

## Verified phases
Apply the installed build-in-verified-phases skill when available. Inspect first, state bounded scope, implement targeted changes and verify integrated behavior. States: NOT STARTED, IN PROGRESS, BLOCKED, COMPLETE. Stop phase advancement on required failed/missing checks; diagnose within scope. Report actual commands/results, changed files, limitations and next step. Mocks do not establish real-provider verification.

## Stack and boundaries
Node.js + TypeScript, MongoDB, Windows first. No mandatory Fastify server without a concrete need. No secrets in Git, tool output, model context or reports. Use runtime argument validation and reviewed tool permissions. Every worker shares parent budgets; no silent provider switch, implicit whole-disk scan or unrestricted shell bypass. No send, publish, purchase or deployment implementation in first-release execution paths.

## Delegation and skills
Use relevant installed skills and appropriate agents/subagents for independent substantial tasks. Assign nonoverlapping ownership; primary reviews diffs and checks integrated results. Inventory actual local skills before assuming they exist. Never print config secret values. TaskForge's runtime extension definitions cannot grant themselves authority.

## Documentation
Update behavior and phase status truthfully. Keep requirements, CLI flow, persistence schema and acceptance evidence aligned. Maintain task.md as implementation tracker when created. Do not invent passing tests, coverage, scanner guarantees or completed integrations.
