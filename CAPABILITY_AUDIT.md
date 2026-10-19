# TaskForge capability audit and owner testing walkthrough

Audit date: 2026-10-19. This audit checks the PRD, TRD, architecture and implementation plan against `node dist/cli.js --help`, explicit command dispatch in `src/cli.ts`, implementation paths, tests, and `task.md`. Planning statements alone are not treated as implementation evidence. The latest integrated serial suite passed 223/223, zero failed or skipped in 163.4 seconds with isolated local storage and a dedicated loopback Mongo test database. This continuation verified synthetic `do` and `agent-fix` CLI journeys plus disposable SQLite backup/restore. Live BookFinder login is waiting for the owner; Vercel project mapping/access and the independent developer trial remain pending.

Tracked/package artifact recheck: the latest packed artifact contains 63 files (144.8 kB compressed; 671.1 kB unpacked), including the installed-task adapter and Phase 17/18 runtime modules. It contains no `.taskforge-build-*`, `.env`, credential, session, private workspace, report, or test-private-key paths (the compiled `dist` directory is expected). Playwright is a production dependency, but browser binaries and the Node runtime are not bundled. Git tracks no generated build folder, `.env`, credentials, session state, or personal/private workspace artifacts. It does track `test/fixtures/browser-egress-fixture.key`, a disposable self-signed key documented in `test/fixtures/README.md`, used only by the local proxy integration fixture; it is excluded from the npm package and is not a service credential. `.env.example` contains placeholders only. All 35 legacy `.taskforge-build-*` folders remain preserved and untracked; none was removed.

## Capability table

| Feature/workflow | Exact supported command and inputs | Setup and permissions | Output | Verification evidence | Status | Important limitations |
|---|---|---|---|---|---|---|
| Natural-language task execution and chat | One-shot: `node dist/cli.js do "Analyze <path> and report row counts."`; chat: `node dist/cli.js chat`, then enter instructions at `You>`. | Requires interactive TTY and the selected provider. Groq requires per-session data-transfer consent; user messages and approved aggregates (including selected column labels, excluding source rows and extracted document text) are sent. Ollama is loopback-only. CSV/document/task tools separately ask for exact-file approval and require an existing persistent read grant for the containing folder. | Provider response; fixed CSV/document results or installed task results routed through the fixed CSV workflow. | `src/cli/commands/agent-session.ts`, `src/agent/installed-task-tool.ts`, `src/agent/tool-loop.ts`, `test/agent-installed-task.test.mjs`, session/CLI/provider tests; synthetic live Groq ambiguity clarification and actual `do` CLI on approved CSV (2 rows, `amount=20`), recorded in Phases 12.4–12.5. | **Synthetic journey verified; broader acceptance partial** | One ordinary-language CSV request completed via actual TTY CLI with provider/file approvals. Installed definitions still execute only when they match the fixed CSV adapter. No broad intent-reliability evidence, interactive chat success journey, broader task capabilities, output writes, general internet tools, or saved transcript/history. |
| Validated declarative task registry | `tasks list`, `tasks inspect <task-id>`, `tasks validate <task-id> --inputs-json '<json-object>'`, `tasks validate-definition --file <definition.json>`, and `tasks install --file <definition.json>`. | Local CLI only. Definition-file operations require exact-file read approval; registry storage is per-user and independent of the selected SQLite/MongoDB backend. | Built-in and valid local definitions, origin, declared inputs/outputs, examples/tests counts, and validation results with field names only. Invalid entries produce sanitized warnings. | `src/workflows/task-registry.ts`, `src/workflows/local-task-registry.ts`, `src/agent/installed-task-tool.ts`, `test/agent-installed-task.test.mjs`, registry/CLI tests; Phase 11.2 and 12.4 evidence in `task.md`. | **Implemented with execution scope limited** | Definitions remain validated data and cannot replace permissions or execute code. Definitions matching the fixed CSV adapter can run through natural-language execution with exact-file approval and the existing folder read grant; unsupported capabilities and conformance-case execution remain unavailable. |
| Configuration and storage | `config`, `doctor`, `permissions list [--all]`; optional `TASKFORGE_STORAGE=local|mongodb`. | New installations use local SQLite under the operating-system application-data root. Existing `TASKFORGE_MONGODB_URI` selects MongoDB unless a backend is explicitly selected. `TASKFORGE_STORAGE=mongodb` requires a named-database URI. Provider is optional for storage-only workflows. | Redacted storage settings summary; doctor storage status; folder grant list. | `src/config/configuration.ts`; `test/config/configuration.test.mjs`, `test/storage/sqlite-store.test.mjs`, `test/storage/mongodb.integration.test.mjs`, `test/storage/store-contract.test.mjs`; Phase 10.3–10.9 in `task.md`. Actual no-Mongo/default-local `doctor` and CSV workflow passed; isolated closed-store SQLite backup/restore test passed. | **Implemented with acceptance pending** | No migration, deletion, or automatic fallback. Adapter contract, SQLite process/cross-process checks, Mongo atomic event persistence and concurrent 500-schedule cap, selected cross-backend semantics, and closed-store SQLite backup/restore are verified; Windows ACL privacy, Mongo backup/restore, power-loss durability, and full workflow parity remain open. |
| Fixed named workflow commands | `node dist/cli.js run <name> ...` for the rows below. | Each command has its documented provider, selected database, TTY, folder-grant, and operation-approval needs. | Workflow-specific result, artifact, or local display. | `src/cli.ts` explicit dispatch plus CLI/contract tests listed per workflow. | **Implemented and verified** | Unsupported registry capabilities do not dispatch workflows. New local backend end-to-end parity remains pending. |
| CSV analysis and export | `run csv-analyze --input <csv> [--numeric-column <header>]... [--output <new-report-path>]` (output suffix `.json`, `.csv`, or `.md`) | selected database; TTY exact-file read approval; persistent read grant. Export also needs persistent output-folder write grant and separate path/content/hash approval. | Deterministic row/duplicate/missing-cell counts and selected exact decimal totals; optional metadata/aggregate-only report and artifact reference. | `test/csv-analysis-cli.test.mjs`, `test/tools/data/data-analysis.test.mjs`, `test/tools/artifacts/csv-analysis-export.test.mjs`, `test/storage/mongodb.integration.test.mjs`; Phase 4 checkpoints and current verified suite evidence in `task.md`. | **Implemented and verified** | Bounded CSV parser; output omits source rows and unselected cell values. No spreadsheet formulas/macros or arbitrary data-agent behavior. |
| Document analysis and conversion | `run document-analyze --input <file> [--output <new-report-path>]` (suffix `.json`, `.csv`, or `.md`); `run document-convert --input <file> --output <new.txt>` | selected database; TTY exact-file approval and read grant. Export/conversion needs persistent output write grant and create-only preview/hash approval. | Format and parser counts; optional aggregate report. Conversion creates bounded plain text. | `test/document-analysis.test.mjs`, `test/tools/artifacts/document-analysis-export.test.mjs`, `test/tools/documents/plain-text-conversion.test.mjs`, parser tests under `test/tools/documents/`, Mongo integration. | **Implemented and verified** | TXT, Markdown, text-based PDF, DOCX and XLSX only. No scanned-PDF OCR, legacy DOC/XLS, macros, or encrypted documents. Exports do not contain extracted content; conversion intentionally does. |
| Data specialist | `run data-specialist --input <file> --goal <question>` | selected database for exact-file approval; configured Groq or Ollama provider; TTY; explicit file-read approval followed by a separate exact evidence/goal transfer approval. | Bounded locally parsed/redacted sample goes to one specialist and a parent review; findings print as unverified and are not persisted. | `test/data-specialist-evidence.test.mjs`, `test/specialist-review.test.mjs`; Phase 7.6 and Phase 8.8 in `task.md`. | **Implemented with acceptance pending** | CSV/XLSX/PDF/DOCX/TXT/Markdown bounded inputs. Heuristic redaction can miss values. No real provider run is claimed by contract fixtures; no files or result are written. |
| Local PDF report artifact | `run pdf-report --input <report.json> --output <new.pdf>` | selected database exact-file read approval; TTY; output-folder write grant and separate create-only content/path/hash confirmation. | New bounded PDF plus metadata-only artifact reference. | `test/tools/artifacts/approved-pdf-output.test.mjs`, `test/tools/artifacts/pdf-report.test.mjs`, Mongo integration. | **Implemented and verified** | Does not overwrite an existing file; accepts the implemented report JSON shape and supported characters only. |
| Repository inventory and source review | `run repo-inspect --root <directory>`; `run source-review --root <directory> --file <relative-path> [--file <relative-path> ...]` | selected database and TTY exact-root/file confirmation; persistent read grant. | Inventory counts/metadata only; selected bounded source printed locally after heuristic credential redaction. | `test/repository-inspection.test.mjs`, `test/source-review.test.mjs`, Mongo integration. | **Implemented and verified** | Inventory does not read file contents or run commands. Source review reads only selected files; redaction is heuristic and content is not sent or persisted. |
| Model-assisted source investigation | `run model-investigate --root <directory> --file <relative-path> [--file <relative-path> ...]` | selected database read grant and root/file approval; configured provider; separate confirmation of the exact redacted excerpts before transfer. | One bounded model finding, displayed as unverified; no tools or persistence. | Phase 5.4 in `task.md` records a live Groq check using a synthetic seeded bug; `test/tools/software/model-investigation.test.mjs` covers limits, transfer, errors and escaping. | **Implemented and verified** | Only selected source excerpts, at most five files/24 KiB; no code changes or tool execution. Heuristic redaction can miss secrets. |
| Specialist source review | `run specialist-review --root <directory> --file <relative-path> [--file <relative-path> ...]` | selected database read grant, TTY root/file/goal prompts, configured provider, separate exact transfer approval. | Up to two bounded worker findings and one parent review, labeled unverified; no files/results persisted. | `test/specialist-review.test.mjs`; Phase 7.3/7.6 in `task.md`. | **Implemented with acceptance pending** | Up to five selected files and 24 KiB; workers can only literal-search approved excerpts. No live provider result is established by these fixtures; no edits, general delegation, or nested workers. |
| Software checks | `run software-check --root <directory> --check node-test [--test <relative JavaScript file>]`; or use `--check typescript-check` or `--check typescript-build`. | selected database persistent write grant; TTY exact root and command approval. | Run status, exit code, duration and output byte counts; command output is suppressed. | `test/tools/software/reviewed-command.test.mjs`, `test/permissions-cli.test.mjs`; current full-suite evidence is recorded in the latest verified checkpoint in `task.md`. | **Implemented and verified** | Executes approved repository code; not an OS sandbox. Only fixed Node test, local TypeScript no-emit, or local TypeScript build commands. Build output uses a temporary owned folder. |
| File patch and move | `run file-patch --root <directory> --target <relative-path> --content-file <relative-path>`; `run file-move --source <file> --target <new-file>` | selected database; TTY; patch requires persistent read+write grants and exact replacement preview/hash approval. Move requires source read+write and destination write grants plus exact path/hash approval. | Patch replaces one target with the exact approved content-file bytes; move creates a verified destination and removes the source after same-volume verification. | `test/tools/software/patch-application.test.mjs`, `test/permissions.test.mjs`, Mongo integration. | **Implemented and verified** | Patch is exact whole-file replacement. Move is limited to matching TXT/Markdown/CSV/PDF/DOCX/XLSX suffixes, same volume, and a destination that does not exist. |
| Agent-generated change preview | `run agent-fix --root <directory> --target <relative-source> --goal <instruction> --test <relative-test.mjs>` | TTY; configured selected provider; exact root/target/goal/test consent; persistent root read+write grants; separate consent for sending selected redacted source/test evidence; separate exact patch approval; separate root and selected Node test approval. | One full-file replacement candidate with SHA-256, locally displayed before approval; then one selected test status. | Actual synthetic `agent-fix` CLI journey in Phase 13.2: selected baseline failed, Groq proposed the correct fix, explicit approval applied it, and separately approved post-apply test passed. Focused storage/agent tests are noted in the active checkpoint. | **Synthetic journey verified; broader acceptance partial** | One existing source file only; selected source/test are bounded and heuristically redacted. The model cannot read other files or run checks. Test execution can read/write other files or cause side effects; no OS sandbox. No multi-file diff, automatic commit/push, or independent developer trial. |
| Staged Git diff review | `run git-diff --root <repository>` | selected database read-scope grant, TTY root and exact staged-file list approval. | Bounded locally redacted staged diff. | `test/tools/software/git-diff-review.test.mjs`, `test/storage/mongodb.integration.test.mjs`. | **Implemented and verified** | Staged tracked files only; no unstaged/untracked changes, model analysis, commit, push, or remote publication. Heuristic redaction. |
| Website audit | Local: `run browser-audit --url <http://127.0.0.1:port/...>`. Public: `run browser-audit --url <https-url> --journey '<json-array>' [--origin <https-origin>]...`. | selected database aggregate metadata; TTY exact-target and journey approval; Playwright Chromium. Public HTTPS origins and each additional origin require separate approval. | Bounded browser/network/console/DOM/accessibility/responsive/passive-header observations; local screenshots/DOM evidence in unauthenticated mode; aggregate metadata only persisted. | `test/browser-audit.test.mjs`, `test/browser-egress-proxy.test.mjs`; controlled fixture evidence and current pending BookFinder owner step in `task.md`. | **Implemented; live owner acceptance pending** | Heuristic, bounded inspection; not a comprehensive security/WCAG audit. Arbitrary forms/buttons, redirects, and unknown GET side effects are unsupported. The approved BookFinder session is open in dedicated Chromium and waiting for owner login, then exact journey approval. |
| Browser manual login | Public HTTPS command above plus `--manual-login` (not `--specialist`). | Headed fresh Chromium context; owner enters credentials directly. Exact additional origins and eligible query-free static-path auth POSTs require individual approval; exact read-only journey requires separate approval. | Generic journey status and aggregate counts; no authenticated screenshot, DOM/text, design/accessibility inspection, or specialist transfer. Context/cookies close on completion. | Network-enabled CLI run reached the manual-login prompt in the approved dedicated Chromium context; the session is currently waiting for the owner. The command and JSON journey validate against the actual CLI parser. | **Owner login pending** | No stored profile/session import. Authentication redirects and general POSTs are blocked; website server may retain its own login session. The live journey is incomplete until the owner logs in and approves the exact read-only steps. |
| Web research | `run research --query <question>`; compare: `run research --compare <question> --against <question>`. | Groq only, configured supported model/key, TTY exact-query transfer consent. | Unverified answer with provider inline citations mapped to validated returned HTTPS source URLs and bounded excerpts; uncited sentences and unmapped markers are surfaced. Comparison lists each search's evidence and exact shared URLs. No persistence. | `test/groq-browser-search.test.mjs` (6/6); Phase 14.1 in `task.md`; strict typecheck/build; full isolated-Mongo suite 178/178. Groq is configured; exact-query owner consent/live response evidence is pending. | **Implemented with acceptance pending** | Groq citation mapping and uncited-sentence detection are validated fixtures only until a live run. Mapping does not prove semantic entailment; exact shared URLs do not prove claim agreement. No project files are sent; provider availability/limits are external. |
| Public GitHub issue read | `run github-issues --repository <owner/name>` | TTY confirmation; network. No token for public repositories. | At most 20 open issue titles and links; no writes. | `test/github-public-issues.test.mjs`; Phase 7.1 in `task.md` records a live tokenless public read. | **Implemented and verified** | Public API only; excludes pull requests. No private-repository auth, GitHub deployment tracing, Vercel access, or write action. |
| Local draft | `run draft --input <draft.json> --output <new.md>` | selected database exact input approval; TTY; destination write grant and preview/hash confirmation. | New local Markdown issue/email draft. | `test/tools/artifacts/drafts.test.mjs`; Mongo integration/artifact checks. | **Implemented and verified** | No GitHub/email service contact, send, publish, or overwrite. |
| Scheduling | `schedule add --workflow csv-analyze --input <file> --once <future-UTC-ISO>` or `--workflow document-analyze ...`; replace `--once` with `--every-minutes <1..10080>` for recurring. Also `schedule list`, `pause <id>`, `resume <id>`, `delete <id>`, `recover <id>`, `run [--once]`. | selected database and TTY; persistent input read grant; exact file/schedule approval. Each due execution requests fresh file/action approval. | Schedule state and normal CSV/document run output. | `test/scheduler.test.mjs`, `test/storage/mongodb.integration.test.mjs`; Phase 7 schedule evidence. | **Implemented and verified** | CSV/document-analysis only. Runs only while the foreground process is active; no Windows Task Scheduler job, daemon, unattended approval, or other workflow schedule. |
| History | `history list` | selected database. | Up to 50 newest redacted run summaries and metadata-only artifact references. | `test/storage/sqlite-store.test.mjs` newest-50/redaction/older-record case (Phase 15.1); `test/storage/mongodb.integration.test.mjs` history coverage. The 17 October full isolated-Mongo suite passed 179/179. | **Implemented and verified** | SQLite and MongoDB retain older records indefinitely. No automatic purge, retention policy, or history delete command/API. Chat transcripts and source/browser contents are not stored as history; artifact files remain in their folders. |
| Resume | `resume <run-id> --input <path> [--numeric-column <header>]...` | selected database, TTY exact-file read approval and stored read grant; same workflow/input must be available. | Deterministically resumed CSV/document analysis summary. | `test/document-analysis.test.mjs` verifies changed bytes/format rejection and exact-format replay; `test/storage/mongodb.integration.test.mjs` covers storage integration. | **Implemented and verified** | Only uncertain CSV/document runs, with checkpointed state and matching input/workflow hashes. Document state binds format; legacy v1 checkpoints fail closed. A stale `running` record must first pass the two-minute stale claim. No general chat/task/session resume. |
| Cancellation | Ctrl+C on signal-aware `do`, `chat`, `agent-fix`, model-investigate, specialist, research, browser audit, software-check, model-check, and foreground scheduler paths; or decline a guarded prompt with `N`. | TTY for interactive approval; provider/network only when that work needs it. | Stops the guarded/unstarted or supported active operation and records a cancelled/uncertain result where implemented. | Provider, specialist, reviewed-command, scheduler, browser fixtures; see `LIFECYCLE_AUDIT.md` for current boundaries. | **Partial** | No `cancel <run-id>` command. CSV/document commands do not install their own active-run SIGINT handler; interruption may leave `running` until stale recovery. No cancellation undoes a completed side effect; file patch is not crash-atomic. |
| Evidence-based architecture reports | `run architecture-report --root <directory> --file <relative-path> [--file <relative-path> ...]` (1–20 exact files). | TTY exact-root/file-set approval and persistent read grant for the selected folder. No provider/network. | Bounded local report with line evidence, labeled inferences, a Mermaid import graph with per-edge evidence, missing evidence, coverage, and limitations. | `src/workflows/architecture-report-workflow.ts`, CLI dispatch in `src/cli.ts`, `test/workflows/architecture-report-workflow.test.mjs`; latest integrated suite and architecture report fixture evidence in `task.md`. | **Partial** | Rules recognize line-based JS/TS import/export and Python import statements. Relative JS/TS and Python imports are heuristically matched only against the exact selected file set; aliases and compiler/package resolution remain unsupported. Python multiline/dynamic imports are unsupported. Whole-repository inventory and other language support are not implemented. Heuristic evidence does not establish runtime architecture. |
| Read-only GitHub/Vercel deployment tracing | `run deployment-trace --repository <owner/name> --project-id <prj_id> [--team-id <team_id>]`. | TTY exact-scope confirmation. GitHub public Actions read is unauthenticated; Vercel requires local `TASKFORGE_VERCEL_TOKEN`, sent only to `api.vercel.com`. No deployment actions. | Up to 25 recent workflow runs/deployments per source, validated links and matching commit-SHA joins; source failures are reported independently. | `src/integrations/deployment-tracing.ts`, CLI dispatch in `src/cli.ts`, `test/deployment-tracing.test.mjs`; typecheck/build and focused tests passed 5/5. A prior read-only public check of `shazzark/taskforge` returned zero runs. | **Partial** | Fixture tests do not establish live account permissions or response compatibility. No BookFinder repository/project mapping or live Vercel trace is confirmed. Live Vercel verification needs exact owner-selected project/team scope and local token. |
| Guided setup and bundled Windows runtime | `setup` gives local, read-only prerequisites and status; distribution remains developer install with Node.js, `npm ci`, and `npm run build`. | Node.js must already be installed; setup neither writes configuration nor contacts providers; Chromium installation remains manual. | Current npm package contains compiled CLI files and production Playwright dependency, but no Node runtime or Playwright browser binaries. | `src/cli/commands/setup.ts`, `test/cli/setup-guide.test.mjs`, and `PHASE19_DISTRIBUTION_AUDIT.md`; actual no-Mongo/default-local doctor and CSV CLI execution returned 2 rows/`amount=20`; the separate package consumer imported Playwright/workflow and ran the CLI version command. That package import check did not install or launch a browser binary. | **Partial** | Phase 19.1 inventory, 19.2 runtime dependency/package import, and 19.3 read-only setup guide are verified. No runtime bundle, installer, SBOM/scan pipeline, upgrade, or uninstall lifecycle exists. Browser binary strategy, clean-machine acceptance and bundled-runtime compatibility remain open; Phase 10 Windows/storage gates precede bundle implementation. |

### Cross-cutting configuration

- New installs use local SQLite in the operating-system application-data directory. `TASKFORGE_STORAGE=local` selects it explicitly. `TASKFORGE_STORAGE=mongodb` selects MongoDB and requires `TASKFORGE_MONGODB_URI`. For compatibility, an existing Mongo URI still selects MongoDB when `TASKFORGE_STORAGE` is unset; without either setting, local SQLite is selected. An ignored repository-root `.env` may supply settings. There is no migration, deletion, or silent backend fallback. MongoDB integration evidence uses a separate disposable database.
- Runtime provider selection is required for model-backed features; the checked-in `.env.example` selects Groq. Set `TASKFORGE_PROVIDER=groq` with `TASKFORGE_GROQ_API_KEY` and optional `TASKFORGE_GROQ_MODEL`, or `TASKFORGE_PROVIDER=ollama` with `TASKFORGE_OLLAMA_BASE_URL`, `TASKFORGE_OLLAMA_MODEL`, and optional context length. Ollama endpoints are loopback-only; install/pull models separately. There is no silent provider fallback.
- `doctor` checks the selected database, not live provider health. `model-check` sends a fixed synthetic prompt and requires one read-only tool call; Phase 2 records live Groq evidence and a live local Ollama evaluation. These do not prove every model-backed feature works with every model.
- Persisted folder grants are separate from per-operation approvals. A read/write folder grant does not itself approve a file read, edit, export, command, website, or provider transfer.

## Numbered owner testing walkthrough

Use local storage and synthetic data for the owner walkthrough. MongoDB integration tests use a separate disposable database. These are supported CLI commands, not evidence that the pending independent developer trial or BookFinder journey is complete. Run interactive commands from a terminal. Never paste `.env`, API keys, personal source, or production data into prompts.

### 1. Build and check configuration

```powershell
$env:TASKFORGE_STORAGE = 'local'
$env:LOCALAPPDATA = Join-Path $env:TEMP ("taskforge-owner-data-" + [guid]::NewGuid().ToString('N'))
$env:TASKFORGE_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/taskforge_owner_test'
npm ci
npm run typecheck
npm run build
node dist/cli.js --help
node dist/cli.js config
npm test
```

`config` should report local SQLite with the path redacted. For a full test run, set `TASKFORGE_TEST_MONGODB_URI` to a dedicated loopback test URI and run `npm test`; the harness derives and drops a fresh random test database. Expected: strict typecheck/build/help and the full suite pass. Then run `node dist/cli.js doctor`; expect local storage available. `doctor` does not test the provider. To check MongoDB selection separately, use only a disposable local database with `TASKFORGE_STORAGE=mongodb` and `TASKFORGE_MONGODB_URI` set; never point the walkthrough at production data.

### 2. Create a disposable fixture folder and grant scopes

```powershell
$trialRoot = Join-Path $env:TEMP ("taskforge-owner-trial-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $trialRoot | Out-Null
@'
item,amount
coffee,12.50
tea,7.25
water,0
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'sample.csv')
@'
TaskForge synthetic document.
This text contains two short lines.
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'sample.txt')
@'
export const fixtureStatus = "READY";
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'sample.mjs')
@'
import assert from "node:assert/strict";
import test from "node:test";
test("synthetic owner trial passes", () => assert.equal(2 + 2, 4));
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'sample.test.mjs')
@'
export const patchTarget = "before";
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'patch-target.mjs')
@'
export const patchTarget = "after";
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'patch-replacement.mjs')
@'
export const repairValue = 1;
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'repair-target.mjs')
@'
import assert from "node:assert/strict";
import test from "node:test";
import { repairValue } from "../repair-target.mjs";
test("seeded repair passes", () => assert.equal(repairValue, 2));
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'repair.test.mjs')
node dist/cli.js permissions approve --root $trialRoot --access read
node dist/cli.js permissions approve --root $trialRoot --access write
node dist/cli.js permissions list
```

Approve only the displayed temporary folder and the requested scope. Expected: both exact canonical grants appear. At any later confirmation prompt, answer `N` once to check cancellation; expect a cancellation message and no read/write/network action for that prompt.

### 3. Run local file and document workflows

```powershell
node dist/cli.js run csv-analyze --input (Join-Path $trialRoot 'sample.csv') --numeric-column amount --output (Join-Path $trialRoot 'csv-summary.json')
node dist/cli.js run document-analyze --input (Join-Path $trialRoot 'sample.txt') --output (Join-Path $trialRoot 'document-summary.md')
node dist/cli.js run document-convert --input (Join-Path $trialRoot 'sample.txt') --output (Join-Path $trialRoot 'converted.txt')
node dist/cli.js run source-review --root $trialRoot --file sample.mjs
node dist/cli.js run repo-inspect --root $trialRoot
$csvPath = Join-Path $trialRoot 'sample.csv'
node dist/cli.js do "Analyze $csvPath and total amount."
node dist/cli.js chat
```

Approve the exact input, operation, and output preview when asked. Expected CSV result: 3 rows and an `amount` total of 19.75; the JSON export contains aggregate data, not source rows. Document analysis prints counts; its Markdown export contains counts only. Conversion previews and writes bounded text to a new file. Source review prints only the selected file locally. Inventory prints bounded counts and does not read source contents or run commands. For `do` or `chat`, Groq first asks to send the instruction/messages and approved aggregate summary (including the selected header label, not source rows); then TaskForge asks approval for the exact CSV path. The existing folder read grant from Step 2 is required. Expected tool observation includes 3 rows and total 19.75; model wording may vary. Declining Groq consent makes no provider request. Declining exact-file approval means no file read; if the model request was already authorized, TaskForge reports the cancellation back to that provider. In chat, follow with a harmless question, then `/exit`; chat history is not saved.

### 4. Test a controlled edit, move, and reviewed software command

```powershell
node dist/cli.js run file-patch --root $trialRoot --target patch-target.mjs --content-file patch-replacement.mjs
Get-Content (Join-Path $trialRoot 'patch-target.mjs')
Set-Content -Encoding utf8 (Join-Path $trialRoot 'move-me.txt') 'synthetic move fixture'
node dist/cli.js run file-move --source (Join-Path $trialRoot 'move-me.txt') --target (Join-Path $trialRoot 'moved.txt')
node dist/cli.js run software-check --root $trialRoot --check node-test --test sample.test.mjs
```

For the patch, inspect the displayed old/new text and hash, then approve; expected target contains exactly the replacement content. For the move, approve the exact paths/hash; expected source is gone and the new same-volume destination exists. For `software-check`, approve the temporary fixture root and exact selected test. Expected: a passed status and exit 0, with test output suppressed. This runs approved code and is not an OS sandbox. Declining either mutation prompt should leave the target/source unchanged.

The agent-generated fix flow needs a configured provider and a live TTY. First run `node dist/cli.js run software-check --root $trialRoot --check node-test --test repair.test.mjs`; approve the exact command and expect its seeded assertion to fail (nonzero exit). Then run `node dist/cli.js run agent-fix --root $trialRoot --target repair-target.mjs --goal "Change repairValue from 1 to 2 and preserve the module export." --test repair.test.mjs`. The root prompt must display the exact root, paths and goal. Declining provider-transfer consent makes no request and leaves bytes unchanged. After transfer, inspect the complete candidate and SHA-256; decline patch approval once and verify `repair-target.mjs` still exports 1. Repeat, approve the patch, then separately approve the exact Node test; expected: applied replacement and a passed check. To exercise check refusal, restore the synthetic target to its seeded value, repeat and approve the patch, then decline the test approval; expected: patch remains applied and no passing verification is claimed. If transfer, provider, or test fails, expect a truthful cancellation/failure and no success label. Model output varies, so manually confirm it meets the synthetic goal before approval. Redaction is heuristic; do not use real source or secrets for this trial.

### 5. Exercise cancellation and safe failure

- Run `node dist/cli.js run csv-analyze --input (Join-Path $trialRoot 'missing.csv')`. Approve only the synthetic path if prompted. Expected: a safe file-read failure and nonzero exit, not a successful run.
- Repeat a read workflow after revoking the temporary read grant with `node dist/cli.js permissions revoke --root $trialRoot --access read`. After declining or approving the exact read prompt as appropriate, expected: the missing persistent grant blocks access. Restore read scope before continuing.
- Start `node dist/cli.js chat` only with a configured provider. With Groq, declining the initial prompt must cancel before transfer. If testing a response, ask a harmless synthetic question; for CSV analysis, use the fixture and approve or decline the exact-file prompt. In a separate `do` run, decline exact-file approval and verify no analysis summary appears. Enter `/exit` to finish chat. Ctrl+C during a provider request or approval prompt requests cancellation; inspect history before retrying an interrupted operation.
- There is no general `cancel <run-id>` command. Do not terminate a process during a real write to test cancellation.

### 6. Check website auditing on a loopback fixture

Create this local server fixture bound only to `127.0.0.1`, then start it in a second terminal:

```powershell
@'
import { createServer } from "node:http";
createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body><main><h1>TaskForge synthetic fixture</h1><p>Local audit sample.</p></main></body></html>");
}).listen(4173, "127.0.0.1");
'@ | Set-Content -Encoding utf8 (Join-Path $trialRoot 'fixture-server.mjs')
node (Join-Path $trialRoot 'fixture-server.mjs')
```

Then, from the TaskForge checkout in the first terminal, run:

```powershell
node dist/cli.js run browser-audit --url http://127.0.0.1:4173/
```

Approve only the exact loopback URL. Expected: a bounded audit summary and local diagnostic evidence; aggregate run metadata is persisted. HTTP mixed-content checks are marked not applicable/skipped. Stop the server and repeat only if you want to observe a navigation failure; expect an incomplete/failure status, not a pass. Playwright Chromium must already be installed. This local fixture does not verify authenticated manual login or the live BookFinder journey.

### 7. Check history and supported resume behavior

```powershell
node dist/cli.js history list
node dist/cli.js resume <uncertain-run-id> --input (Join-Path $trialRoot 'sample.csv') --numeric-column amount
```

History should show redacted run summaries and aggregate artifact references, not chat text or source rows. Only an actually uncertain/checkpointed CSV or document run can be resumed; provide its run ID and the same unchanged input, then reapprove the exact file. Do not substitute an arbitrary/completed run to manufacture a resume result. There is no general chat or workflow-session resume.

### 8. Exercise a schedule without unattended execution

```powershell
$due = (Get-Date).ToUniversalTime().AddMinutes(2).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
node dist/cli.js schedule add --workflow csv-analyze --input (Join-Path $trialRoot 'sample.csv') --once $due
node dist/cli.js schedule list
```

Record the displayed schedule ID, then check `schedule pause <id>`, `schedule resume <id>`, and `schedule delete <id>` (delete asks for confirmation). A schedule runs only in a foreground process; it is not a Windows service. Each due occurrence needs fresh interactive file and operation approval. To run due work, start `node dist/cli.js schedule run --once` after its scheduled time. Stop continuous foreground scheduling with Ctrl+C. Remove only this test schedule; do not use `schedule recover` unless the prior scheduler is confirmed stopped.

### 9. Optional model-backed features

Only with an already configured provider and synthetic content, optionally try:

```powershell
node dist/cli.js model-check
node dist/cli.js run model-investigate --root $trialRoot --file sample.mjs
node dist/cli.js run data-specialist --input (Join-Path $trialRoot 'sample.csv') --goal 'Report the row count and selected numeric total.'
node dist/cli.js run specialist-review --root $trialRoot --file sample.mjs
node dist/cli.js run research --query 'What is two plus two?'
```

Review every exact transfer prompt. `model-check` sends fixed synthetic data; research sends the exact query to Groq; the source/data specialists send bounded heuristically redacted evidence only after separate approval. Declining is a successful cancellation check. Findings are unverified. Live provider availability is not guaranteed by mocked contract tests.

Do not use BookFinder or another live account site in this walkthrough. Owner-operated BookFinder search/results/details/back and the independent developer trial remain pending. No email send, GitHub write, publish, purchase, or deployment command exists.
