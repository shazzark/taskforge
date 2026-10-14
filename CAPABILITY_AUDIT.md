# TaskForge capability audit and owner testing walkthrough

Audit date: 2026-10-14. This audit checked the PRD, TRD, architecture and implementation plan against `node dist/cli.js --help`, the explicit command dispatch in `src/cli.ts`, implementation paths, tests, and `task.md`. Planning statements alone are not treated as implementation evidence.

## Capability table

| Feature/workflow | Exact supported command and inputs | Setup and permissions | Output | Verification evidence | Status | Important limitations |
|---|---|---|---|---|---|---|
| Natural-language task execution and chat | `node dist/cli.js chat`; enter text at `You>`. Named work uses `node dist/cli.js run <workflow> ...`. | Chat needs a configured provider and TTY; Groq asks before sending text. Named workflows need their own inputs and approvals. | Chat prints model text for the active session. Named commands produce their workflow-specific output. | `src/cli.ts` dispatch is an explicit command chain; `runChat` passes zero tools and a zero tool-action budget. `test/providers.test.mjs`; Phase 2.1 in `task.md` records a TTY consent-decline smoke, not a completed live chat exchange. | **Partial** | No general instruction parser, workflow selection, tool use, file access, or persistent chat transcript. Chat can answer text but cannot execute “analyze this file” or invoke a workflow. No declarative or runtime workflow registry. |
| Configuration and storage | `config`, `doctor`, `permissions list [--all]`; configuration variables are documented below. | MongoDB URI with a named database is required for config and persisted workflows. Provider is optional for storage-only workflows. Folder grants are stored in MongoDB. | Redacted settings summary; doctor database status; folder grant list. | `test/configuration.test.mjs`; `test/mongodb.integration.test.mjs`; Phase 8.8 in `task.md` records a full suite with Mongo integration enabled. | **Implemented and verified** | MongoDB is the only persistence backend. No SQLite or local-file database mode. Model-only chat, `model-check`, research, and public GitHub read do not store run data. |
| Fixed named workflow commands | `node dist/cli.js run <name> ...` for the rows below. | Each command has its documented provider, MongoDB, TTY, folder-grant, and operation-approval needs. | Workflow-specific result, artifact, or local display. | `src/cli.ts` hard-coded dispatch plus CLI/contract tests listed per workflow. | **Implemented and verified** | Workflows must be selected by command name. Definitions cannot be installed dynamically and cannot grant themselves authority. |
| CSV analysis and export | `run csv-analyze --input <csv> [--numeric-column <header>]... [--output <new-report-path>]` (output suffix `.json`, `.csv`, or `.md`) | MongoDB; TTY exact-file read approval; persistent read grant. Export also needs persistent output-folder write grant and separate path/content/hash approval. | Deterministic row/duplicate/missing-cell counts and selected exact decimal totals; optional metadata/aggregate-only report and artifact reference. | `test/csv-analysis-cli.test.mjs`, `test/data-analysis.test.mjs`, `test/csv-analysis-export.test.mjs`, `test/mongodb.integration.test.mjs`; Phase 4 checkpoints and Phase 8.8. | **Implemented and verified** | Bounded CSV parser; output omits source rows and unselected cell values. No spreadsheet formulas/macros or arbitrary data-agent behavior. |
| Document analysis and conversion | `run document-analyze --input <file> [--output <new-report-path>]` (suffix `.json`, `.csv`, or `.md`); `run document-convert --input <file> --output <new.txt>` | MongoDB; TTY exact-file approval and read grant. Export/conversion needs persistent output write grant and create-only preview/hash approval. | Format and parser counts; optional aggregate report. Conversion creates bounded plain text. | `test/document-analysis.test.mjs`, `test/document-analysis-export.test.mjs`, `test/plain-text-conversion.test.mjs`, parser tests, Mongo integration. | **Implemented and verified** | TXT, Markdown, text-based PDF, DOCX and XLSX only. No scanned-PDF OCR, legacy DOC/XLS, macros, or encrypted documents. Exports do not contain extracted content; conversion intentionally does. |
| Data specialist | `run data-specialist --input <file> --goal <question>` | MongoDB for exact-file approval; configured Groq or Ollama provider; TTY; explicit file-read approval followed by a separate exact evidence/goal transfer approval. | Bounded locally parsed/redacted sample goes to one specialist and a parent review; findings print as unverified and are not persisted. | `test/data-specialist-evidence.test.mjs`, `test/specialist-review.test.mjs`; Phase 7.6 and Phase 8.8 in `task.md`. | **Implemented with acceptance pending** | CSV/XLSX/PDF/DOCX/TXT/Markdown bounded inputs. Heuristic redaction can miss values. No real provider run is claimed by contract fixtures; no files or result are written. |
| Local PDF report artifact | `run pdf-report --input <report.json> --output <new.pdf>` | MongoDB exact-file read approval; TTY; output-folder write grant and separate create-only content/path/hash confirmation. | New bounded PDF plus metadata-only artifact reference. | `test/approved-pdf-output.test.mjs`, `test/pdf-report.test.mjs`, Mongo integration. | **Implemented and verified** | Does not overwrite an existing file; accepts the implemented report JSON shape and supported characters only. |
| Repository inventory and source review | `run repo-inspect --root <directory>`; `run source-review --root <directory> --file <relative-path> [--file <relative-path> ...]` | MongoDB and TTY exact-root/file confirmation; persistent read grant. | Inventory counts/metadata only; selected bounded source printed locally after heuristic credential redaction. | `test/repository-inspection.test.mjs`, `test/source-review.test.mjs`, Mongo integration. | **Implemented and verified** | Inventory does not read file contents or run commands. Source review reads only selected files; redaction is heuristic and content is not sent or persisted. |
| Model-assisted source investigation | `run model-investigate --root <directory> --file <relative-path> [--file <relative-path> ...]` | MongoDB read grant and root/file approval; configured provider; separate confirmation of the exact redacted excerpts before transfer. | One bounded model finding, displayed as unverified; no tools or persistence. | Phase 5.4 in `task.md` records a live Groq check using a synthetic seeded bug; `test/model-investigation.test.mjs` covers limits, transfer, errors and escaping. | **Implemented and verified** | Only selected source excerpts, at most five files/24 KiB; no code changes or tool execution. Heuristic redaction can miss secrets. |
| Specialist source review | `run specialist-review --root <directory> --file <relative-path> [--file <relative-path> ...]` | MongoDB read grant, TTY root/file/goal prompts, configured provider, separate exact transfer approval. | Up to two bounded worker findings and one parent review, labeled unverified; no files/results persisted. | `test/specialist-review.test.mjs`; Phase 7.3/7.6 in `task.md`. | **Implemented with acceptance pending** | Up to five selected files and 24 KiB; workers can only literal-search approved excerpts. No live provider result is established by these fixtures; no edits, general delegation, or nested workers. |
| Software checks | `run software-check --root <directory> --check node-test [--test <relative JavaScript file>]`; or use `--check typescript-check` or `--check typescript-build`. | MongoDB persistent write grant; TTY exact root and command approval. | Run status, exit code, duration and output byte counts; command output is suppressed. | `test/reviewed-command.test.mjs`, `test/permissions-cli.test.mjs`; full serial suite 152/152 in Phase 8.8. | **Implemented and verified** | Executes approved repository code; not an OS sandbox. Only fixed Node test, local TypeScript no-emit, or local TypeScript build commands. Build output uses a temporary owned folder. |
| File patch and move | `run file-patch --root <directory> --target <relative-path> --content-file <relative-path>`; `run file-move --source <file> --target <new-file>` | MongoDB; TTY; patch requires persistent read+write grants and exact replacement preview/hash approval. Move requires source read+write and destination write grants plus exact path/hash approval. | Patch replaces one target with the exact approved content-file bytes; move creates a verified destination and removes the source after same-volume verification. | `test/patch-application.test.mjs`, `test/permissions.test.mjs`, Mongo integration. | **Implemented and verified** | Patch is exact whole-file replacement, not model-generated edits or a general diff applier. Move is limited to matching TXT/Markdown/CSV/PDF/DOCX/XLSX suffixes, same volume, and a destination that does not exist. |
| Staged Git diff review | `run git-diff --root <repository>` | MongoDB read-scope grant, TTY root and exact staged-file list approval. | Bounded locally redacted staged diff. | `test/git-diff-review.test.mjs`, `test/mongodb.integration.test.mjs`. | **Implemented and verified** | Staged tracked files only; no unstaged/untracked changes, model analysis, commit, push, or remote publication. Heuristic redaction. |
| Website audit | Local: `run browser-audit --url <http://127.0.0.1:port/...>`. Public: `run browser-audit --url <https-url> --journey '<json-array>' [--origin <https-origin>]...`. | MongoDB aggregate metadata; TTY exact-target and journey approval; Playwright Chromium. Public HTTPS origins and each additional origin require separate approval. | Bounded browser/network/console/DOM/accessibility/responsive/passive-header observations; local screenshots/DOM evidence in unauthenticated mode; aggregate metadata only persisted. | `test/browser-audit.test.mjs`, `test/browser-egress-proxy.test.mjs`; Phase 6.10 and 6.11 controlled fixture evidence in `task.md`. | **Implemented with acceptance pending** | Heuristic, bounded inspection; not a comprehensive security/WCAG audit. Arbitrary forms/buttons, redirects, and unknown GET side effects are unsupported. The approved BookFinder search/results/details/back journey remains pending. |
| Browser manual login | Public HTTPS command above plus `--manual-login` (not `--specialist`). | Headed fresh Chromium context; owner enters credentials directly. Exact additional origins and eligible query-free static-path auth POSTs require individual approval; exact read-only journey requires separate approval. | Generic journey status and aggregate counts; no authenticated screenshot, DOM/text, design/accessibility inspection, or specialist transfer. Context/cookies close on completion. | Controlled fixture evidence in `test/browser-audit.test.mjs` and `test/browser-egress-proxy.test.mjs`; Phase 6.11 records live/headed operation pending. | **Implemented with acceptance pending** | No stored profile/session import. Authentication redirects and general POSTs are blocked; website server may retain its own login session. This is not a security audit. Live BookFinder journey remains pending. |
| Web research | `run research --query <question>`; compare: `run research --compare <question> --against <question>`. | Groq only, configured supported model/key, TTY exact-query transfer consent. | Unverified model answer and bounded validated sources/excerpts; comparison also lists exact shared URLs. No persistence. | `test/groq-browser-search.test.mjs`; Phase 6.2/6.5 synthetic provider-contract evidence in `task.md`. | **Implemented and verified** | Query is sent to Groq browser search. It does not establish claim-level agreement, and live availability/limits are provider-controlled. No project files are sent. |
| Public GitHub issue read | `run github-issues --repository <owner/name>` | TTY confirmation; network. No token for public repositories. | At most 20 open issue titles and links; no writes. | `test/github-public-issues.test.mjs`; Phase 7.1 in `task.md` records a live tokenless public read. | **Implemented and verified** | Public API only; excludes pull requests. No private-repository auth, GitHub deployment tracing, Vercel access, or write action. |
| Local draft | `run draft --input <draft.json> --output <new.md>` | MongoDB exact input approval; TTY; destination write grant and preview/hash confirmation. | New local Markdown issue/email draft. | `test/drafts.test.mjs`; Mongo integration/artifact checks. | **Implemented and verified** | No GitHub/email service contact, send, publish, or overwrite. |
| Scheduling | `schedule add --workflow csv-analyze --input <file> --once <future-UTC-ISO>` or `--workflow document-analyze ...`; replace `--once` with `--every-minutes <1..10080>` for recurring. Also `schedule list`, `pause <id>`, `resume <id>`, `delete <id>`, `recover <id>`, `run [--once]`. | MongoDB and TTY; persistent input read grant; exact file/schedule approval. Each due execution requests fresh file/action approval. | Schedule state and normal CSV/document run output. | `test/scheduler.test.mjs`, `test/mongodb.integration.test.mjs`; Phase 7 schedule evidence. | **Implemented and verified** | CSV/document-analysis only. Runs only while the foreground process is active; no Windows Task Scheduler job, daemon, unattended approval, or other workflow schedule. |
| History | `history list` | MongoDB. | Up to 50 redacted run summaries and artifact references. | `test/mongodb.integration.test.mjs`; Phase 8.8 suite. | **Implemented and verified** | Metadata only; not chat transcripts or full source/output contents. |
| Resume | `resume <run-id> --input <path> [--numeric-column <header>]...` | MongoDB, TTY exact-file read approval and read grant; same workflow/input must be available. | Resumed CSV/document analysis summary. | `test/document-analysis.test.mjs`, `test/mongodb.integration.test.mjs`; Phase 4.9 and 8.8. | **Implemented and verified** | Only uncertain CSV/document runs with checkpointed state and matching input/workflow hashes. Not general chat/task/session resume. |
| Cancellation | Ctrl+C during supported active model, browser, specialist, scheduler, or reviewed-command work; decline prompts with `N` before starting. | TTY for interactive approval; provider/network only if that work needs it. | Cancellation status/exit or safe stop; uncertain work remains explicit for later recovery. | `test/providers.test.mjs`, `test/specialist-review.test.mjs`, `test/reviewed-command.test.mjs`, `test/scheduler.test.mjs`, browser cancellation fixtures. | **Implemented and verified** | No `cancel <run-id>` command and no universal interrupt/resume guarantee for every operation. Inspect history before retrying work interrupted near a side effect. |
| Architecture analysis and deployment tracing | No supported CLI command. `repo-inspect`, `git-diff`, and `github-issues` are distinct bounded features. | None. | None. | Explicitly marked proposals in `prd.md`, `task.md` and architecture documents; absent from `src/cli.ts` dispatch. | **Not implemented** | Architecture analysis and read-only GitHub/Vercel deployment tracing remain unapproved proposals. Deployment actions are deferred. |

### Cross-cutting configuration

- `TASKFORGE_MONGODB_URI` must name a database for configuration validation and workflows that use persisted approvals, run metadata, history, artifacts, or schedules. An ignored repository-root `.env` may supply it. Use a local disposable database for trials. There is no alternative persistence backend.
- Runtime provider selection is required for model-backed features; the checked-in `.env.example` selects Groq. Set `TASKFORGE_PROVIDER=groq` with `TASKFORGE_GROQ_API_KEY` and optional `TASKFORGE_GROQ_MODEL`, or `TASKFORGE_PROVIDER=ollama` with `TASKFORGE_OLLAMA_BASE_URL`, `TASKFORGE_OLLAMA_MODEL`, and optional context length. Ollama endpoints are loopback-only; install/pull models separately. There is no silent provider fallback.
- `doctor` checks MongoDB, not live provider health. `model-check` sends a fixed synthetic prompt and requires one read-only tool call; Phase 2 records live Groq evidence and a live local Ollama evaluation. These do not prove every model-backed feature works with every model.
- Persisted folder grants are separate from per-operation approvals. A read/write folder grant does not itself approve a file read, edit, export, command, website, or provider transfer.

## Numbered owner testing walkthrough

Use a local disposable MongoDB database and synthetic data only. These are supported CLI commands, not evidence that the pending independent developer trial or BookFinder journey is complete. Run interactive commands from a terminal. Never paste `.env`, API keys, personal source, or production data into prompts.

### 1. Build and check configuration

```powershell
$env:TASKFORGE_MONGODB_URI = 'mongodb://127.0.0.1:27017/taskforge_owner_trial'
$env:TASKFORGE_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/taskforge_owner_test'
npm ci
npm run typecheck
npm run build
node dist/cli.js --help
node dist/cli.js config
npm test
```

Point `TASKFORGE_MONGODB_URI` at a local disposable database before `config`; do not reuse an Atlas/production URI. For a full test run, also set `TASKFORGE_TEST_MONGODB_URI` to a dedicated loopback test URI and run `npm test`; the harness derives and drops a fresh random test database. Expected: strict typecheck/build/help and the full suite pass; config prints redacted values. Then run `node dist/cli.js doctor`; expect local MongoDB connectivity. `doctor` does not test the provider.

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
```

Approve the exact input, operation, and output preview when asked. Expected CSV result: 3 rows and an `amount` total of 19.75; the JSON export contains aggregate data, not source rows. Document analysis prints counts; its Markdown export contains counts only. Conversion previews and writes bounded text to a new file. Source review prints only the selected file locally. Inventory prints bounded counts and does not read source contents or run commands.

### 4. Test a controlled edit, move, and reviewed software command

```powershell
node dist/cli.js run file-patch --root $trialRoot --target patch-target.mjs --content-file patch-replacement.mjs
Get-Content (Join-Path $trialRoot 'patch-target.mjs')
Set-Content -Encoding utf8 (Join-Path $trialRoot 'move-me.txt') 'synthetic move fixture'
node dist/cli.js run file-move --source (Join-Path $trialRoot 'move-me.txt') --target (Join-Path $trialRoot 'moved.txt')
node dist/cli.js run software-check --root $trialRoot --check node-test --test sample.test.mjs
```

For the patch, inspect the displayed old/new text and hash, then approve; expected target contains exactly the replacement content. For the move, approve the exact paths/hash; expected source is gone and the new same-volume destination exists. For `software-check`, approve the temporary fixture root and exact selected test. Expected: a passed status and exit 0, with test output suppressed. This runs approved code and is not an OS sandbox. Declining either mutation prompt should leave the target/source unchanged.

### 5. Exercise cancellation and safe failure

- Run `node dist/cli.js run csv-analyze --input (Join-Path $trialRoot 'missing.csv')`. Approve only the synthetic path if prompted. Expected: a safe file-read failure and nonzero exit, not a successful run.
- Repeat a read workflow after revoking the temporary read grant with `node dist/cli.js permissions revoke --root $trialRoot --access read`. After declining or approving the exact read prompt as appropriate, expected: the missing persistent grant blocks access. Restore read scope before continuing.
- Start `node dist/cli.js chat` only with a configured provider. With Groq, declining the initial prompt must cancel before transfer. If you choose to test a response, ask a harmless synthetic question. Chat cannot read the fixture or invoke a named workflow; it has no tools. Enter `/exit` to finish. Ctrl+C during supported active work requests cancellation; inspect history before retrying an interrupted operation.
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
