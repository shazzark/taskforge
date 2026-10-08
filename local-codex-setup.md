# Local Codex Setup and Skills Discovery

## Step 1 - Repository
Repository: https://github.com/shazzark/taskforge. Clone to C:\Users\chido\Developer\taskforge, outside OneDrive. The repository includes README, Node .gitignore and MIT. Keep all planning Markdown files, including AGENTS.md, in the repository root. Do not copy model keys, MongoDB credentials or private screenshots.

## Step 2 - Inspection prompt
Paste this into your locally installed Codex from the TaskForge folder:

Use the build-in-verified-phases skill if installed. This is Phase 0 inspection only; do not implement runtime code, install packages, edit global settings, publish or push. Inspect repository state, applicable AGENTS.md and planning documents. List actual available global/project skills with name, path and one-sentence purpose, especially build-in-verified-phases. Inspect standard skill catalogs/directories first; do not search unrelated private files. Check Node, npm, Git and Codex versions/help plus whether local MongoDB, Ollama and browser tooling are installed. Report configuration variable NAMES and presence only, never values, tokens or connection strings. Identify prerequisites and proposed Phase 1 scope, acceptance and verification commands. Use read-only subagents only if useful. Return observed facts, missing items, requirement conflicts and next setup steps. Do not infer local skill availability from this chat.

## Step 3 - Return evidence
Share the inspection summary and repository URL here, with secrets removed. We will resolve setup gaps and then issue the bounded Phase 1 build prompt. The local machine inventory below is based on this Phase 0 inspection.

## Recommendations awaiting review
Accept run budgets and format boundaries in PRD/TRD; summary-first history and 30/90-day retention; clarify login journeys, document OCR needs, email draft inputs and schedule triggers. No fixed numerical defaults become immutable until actual model and workload testing.

## Observed local setup (8 October 2026)

- Node.js v22.13.0; npm 11.1.0; Git 2.47.1.windows.2; Codex CLI 0.162.0.
- MongoDB server command `mongod` is unavailable and the MongoDB Windows service is stopped. The `mongosh` client is available. No database connection was tested.
- Ollama command is unavailable.
- Google Chrome and Microsoft Edge are installed. A Playwright browser cache exists, but Playwright, `@playwright/test` and Puppeteer do not resolve as Node packages.
- No `package.json` or dependency lockfile exists yet.
- The local `build-in-verified-phases` skill was not found in inspected global or project skill locations. Installed global skills include `engineering-workflow` (`C:\Users\chido\.codex\skills\engineering-workflow\SKILL.md`) for substantial implementation workflows, `debugging-workflow` (`C:\Users\chido\.codex\skills\debugging-workflow\SKILL.md`) for evidence-based diagnosis and fixes, and `review-agent` (`C:\Users\chido\.codex\skills\.system\review-agent\SKILL.md`) for read-only code review.
- Chrome, Edge, and the Playwright browser cache are present; browser automation package availability is not established.

No services were started or dependencies installed during Phase 0. Configure a MongoDB instance and choose its supported version before Phase 1 integration work. Keep connection strings and provider credentials in local secret configuration, never in these documents.