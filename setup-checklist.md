# TaskForge setup checklist: Phases 2–8

This is a prerequisite inventory, not evidence that later phases are implemented. The opening state below records the inventory at checklist creation. Since then, Phase 2 provider configuration and adapters were implemented; see the progress update. No secret value was read, changed, or copied. An unrelated environment variable named `GITHUB_PAT_TOKEN` was detected by name only and intentionally not reused.

**Progress update (10 October 2026):** Root `.env` exists and remains ignored. The owner corrected its MongoDB URI using the locally stored credentials; commented credential lines were removed without exposing values. Redacted Atlas verification resolved SRV DNS and all three nodes, then completed authenticated ping successfully. The sandbox-only DNS timeout is an environment restriction. No Atlas IP access or database-user change was made. Local MongoDB ping and isolated database-backed workflows pass. Groq synthetic tool-call verification passes. CSV/TXT/Markdown, text-PDF/PDF render, bounded XLSX and DOCX cores pass; the approved `document-analyze` workflow is integrated and persists aggregate metadata only. The bounded metadata-only `repo-inspect`, reviewed software workflows, explicit-consent model investigation, staged local Git diff review, and tokenless public GitHub issue reader are implemented. The public issue reader was verified against the TaskForge GitHub repository without a token; private repository access remains unimplemented and requires an owner-scoped credential only if later chosen. Mammoth was removed after audit findings. Ollama installation/model download remain deferred until tonight; none has been performed.

At checklist creation on 10 October 2026, `src/config.ts` read and validated only `TASKFORGE_MONGODB_URI`; it did not load `.env`. Root `.env` was absent and ignored by Git (`.env` and `.env.*`, with `.env.example` explicitly allowed). All other TaskForge variables in the initial checklist were proposed contracts at that point.

## What Codex can install versus what you must supply

Codex can add reviewed, pinned npm dependencies and update `package-lock.json` as implementation requires. That is separate from installing system programs, downloading large browser/model binaries, creating accounts, granting repository access, or supplying credentials. We will not install packages or change global settings as part of this prerequisite inventory. Once setup is done, the already-authorized implementation can continue phase by phase and commit verified checkpoints locally without pushing.

| Prerequisite | Phase / purpose | Current state | Cost and requirement | Account or owner action |
|---|---|---|---|---|
| Node.js + npm | 2–8; runtime and package manager | Installed; Phase 1 evidence records Node 22.13.0/npm 11.1.0; `package.json` requires Node >=22.13.0 | Free; required | None unless upgrading becomes necessary |
| MongoDB Community Server / Atlas | 2–8; required local persistence for runs, events and schedules | Local MongoDB ping and isolated workflows pass. Atlas SRV DNS resolved 3 records and authenticated ping succeeded outside sandbox. Sandbox DNS timed out before contacting Atlas | Community Server free; required for DB-backed acceptance. Atlas is an optional hosted alternative with account/plan limits | No current owner action. Keep credentials private; no IP-list or database-user change was made |
| Online model: Groq | 2; first live tool-calling adapter trial | Groq configuration presence was confirmed privately; adapter and settings are implemented. Live synthetic tool call passed | Free plan, quota-limited; required for online-provider acceptance. Keep account on Free Plan; do not add billing. Limits/model availability can change | No action if the existing key remains valid. Do not disclose it; synthetic data only for trial |
| Online model: model ID | 2; selects provider model | `TASKFORGE_GROQ_MODEL` is implemented; current recommended trial is `openai/gpt-oss-20b` | Included with provider quota; model availability/quotas may change | No separate key or account action; confirm availability in Groq console if quota/access changes |
| Ollama + local model (owner-deferred acceptance trial) | 2; test local inference/tool calling without inference API key | Ollama is not installed/configured; no local endpoint/model present. Adapter has mocked contract tests only | Ollama is free; model download/storage and local hardware are limiting factors. Required before Phase 2 can be COMPLETE; explicitly deferred until tonight | Owner action tonight: install Ollama from [ollama.com/download](https://ollama.com/download), then `ollama pull qwen3:4b-q4_K_M`. No account/key. Do not install or download before then |
| Playwright npm package + browser binaries | 6; isolated browser journeys, network/console/link and responsive observations | Chrome and Edge are installed and an `ms-playwright` cache path exists, but neither Playwright nor Puppeteer is installed as an npm dependency. Existing cache does not prove version-compatible binaries | Playwright is free/open source; browser downloads consume disk. Dependency and compatible Chromium install required; Chromium is the initial recommendation. No account/key | No account. Codex can add pinned Playwright package and install its Chromium binary during Phase 6. Browser target/site access and any login credentials are owner-supplied only when needed; use a test account, never personal browser profiles |
| GitHub read access | 7; read public repos/issues and prepare local drafts | Public repository URL is known; `gh` was not established as installed; no TaskForge GitHub token variable. Do not reuse `GITHUB_PAT_TOKEN` | Public GitHub REST reads are free and do not require an API key, but unauthenticated rate limits apply. Private repo access needs a GitHub account and fine-grained, repository-limited read token | For public repositories, no setup. For private repos, create a fine-grained PAT scoped only to selected repo(s), read-only Metadata and Contents/Issues as needed; set proposed `TASKFORGE_GITHUB_TOKEN` in ignored `.env`. Do not grant write access |
| Research/search provider | 6; source retrieval, timestamps and sourced comparisons | No search adapter/provider configured. Groq is the provisional model choice; provider-supported browser search may avoid another key if compatible. No TaskForge Tavily/Brave variables | Search provider use is optional per workflow, quota-limited for hosted APIs. Recommended first: try Groq built-in browser search only if supported by chosen model/API and acceptable data transfer. Alternative Tavily Free provides a published 1,000 credits/month, no card; availability/terms may change | No separate account/key for supported Groq built-in search. If selecting Tavily, sign up and set proposed `TASKFORGE_TAVILY_API_KEY`; no payment. Search-provider choice remains unresolved (see decisions below) |
| Document parsers | 4; extract supported TXT/MD, CSV, text PDF, DOCX, XLSX | CSV, TXT/Markdown, text-PDF, DOCX and XLSX cores pass. XLSX uses ExcelJS/Yauzl preflight; DOCX uses fast-xml-parser/Yauzl with DTD rejection and bounded XML/ZIP processing. Mammoth was removed after three moderate dependency findings | Free/local, no account/key. Text PDFs only: no OCR. Formula-bearing XLSX, encrypted/legacy documents and DOCX formatting/images/relationships are unsupported | No account action. Codex can maintain local parser dependencies |
| PDF generation | 4; produce requested PDF reports | `pdfkit` and `@types/pdfkit` are installed; bounded in-memory PDF renderer passes tests. Filesystem artifact writing/integrity workflow is not implemented | PDFKit is a free MIT-licensed npm library; no account/key. PDF renderer core is available; integrated artifact workflow remains required | No owner action; Codex can implement the approved-root artifact writer and verification |
| Scheduling | 7; local schedule registration and execution while local runner is active | Windows Task Scheduler (`schtasks.exe`) is part of supported Windows; TaskForge scheduling is not implemented. No scheduling service/API config | Windows built-in, no external fee/account/key. Required for local scheduling acceptance. Must fail closed if fresh approval is needed; scheduled runs only while local runner prerequisites are available | No external setup. Owner must approve each concrete schedule/trigger/target when the feature exists. Do not store passwords in task arguments; whether schedules run interactively needs an explicit design decision |
| Specialist agents | 7; bounded repository investigator, browser auditor, data analyst and reviewer delegations | Not implemented. Architecture sets max two workers, shared run budgets/tools, parent review. No separate agent account/key is defined | No separate service or API key if agents are prompts/worker loops on the already selected provider; they consume the same model quota/budget. Codex subagents used during development are distinct from TaskForge runtime agents | No separate account. Choose provider/model once; confirm only if later design needs a distinct agent model/provider. No nested/unlimited spawning |
| Email drafting | 7; write an email draft artifact only | No mail integration/config defined | No account/key should be required for local draft files. Sending is explicitly deferred | No external action/setup. If an email-provider connection is later proposed, treat it as a new owner decision, not a prerequisite |
| Release tools | 8; clean clone/consumer verification, dependency/license audit and distribution checks | Node/npm/Git are installed; no published package expected | Free local tools; npm publication is not required for clone-based first release and requires explicit later authorization | No action now. Do not create npm account, publish, or push for this checklist |

## Configuration contract

`src/config.ts` implements `TASKFORGE_MONGODB_URI`, `TASKFORGE_PROVIDER`, `TASKFORGE_GROQ_API_KEY`, `TASKFORGE_GROQ_MODEL`, `TASKFORGE_OLLAMA_BASE_URL`, and `TASKFORGE_OLLAMA_MODEL`. GitHub and search variables below are proposals only; those integrations are not implemented. Blank/commented values are optional. Do not set unused credentials; there should be no key per workflow/agent unless the selected external provider actually requires it.

| Variable | Status / use |
|---|---|
| `TASKFORGE_MONGODB_URI` | Implemented in `src/config.ts`; required for current config/doctor. Keep URI local and private. |
| `TASKFORGE_PROVIDER` | Implemented Phase 2 provider selection: `groq` or `ollama`; no implicit fallback/switch. |
| `TASKFORGE_GROQ_API_KEY` | Implemented Phase 2 secret; needed only when selecting Groq. |
| `TASKFORGE_GROQ_MODEL` | Implemented Phase 2 model selector; current value presence was inspected without printing it. Recommended initial value `openai/gpt-oss-20b`. |
| `TASKFORGE_OLLAMA_BASE_URL` | Implemented Phase 2 loopback-only local endpoint; recommended `http://127.0.0.1:11434`. No secret for local Ollama. |
| `TASKFORGE_OLLAMA_MODEL` | Implemented Phase 2 model selector; trial candidate `qwen3:4b-q4_K_M`. |
| `TASKFORGE_GITHUB_TOKEN` | Proposed Phase 7 optional token only for private/restricted reads or rate-limit needs. Public reads should work without it. Never grant write access. |
| `TASKFORGE_SEARCH_PROVIDER` | Unresolved proposed Phase 6 selector; recommended start with provider-integrated search when supported, otherwise `tavily` only after explicit choice. |
| `TASKFORGE_TAVILY_API_KEY` | Proposed optional Phase 6 secret only if Tavily is selected. |

No environment variable is proposed for Playwright, document libraries, PDFKit, Task Scheduler, or local specialist workers. These are local software capabilities and do not justify external credentials. Implementation must not silently enable external network/search/model use just because a key is present.

## Safe verification commands

These commands print only versions, booleans, service state, ping status, or model names. They do not print keys or connection strings. Commands marked for future integrations are verification recipes for when those phases are implemented.

```powershell
# Baseline tools
node --version
npm --version
git --version

# Credential presence only; never print environment values
'TASKFORGE_MONGODB_URI','TASKFORGE_GROQ_API_KEY','TASKFORGE_GITHUB_TOKEN','TASKFORGE_TAVILY_API_KEY' | ForEach-Object { '{0}={1}' -f $_, [bool][Environment]::GetEnvironmentVariable($_) }

# MongoDB client ping (prints numeric ok result, not the URI)
mongosh --quiet --eval "db.runCommand({ ping: 1 }).ok"
# TaskForge reads .env and prints only validated/redacted configuration state
node dist/cli.js config
node dist/cli.js doctor

# Groq, synthetic prompt/tool call only
node dist/cli.js model-check
# Ollama, after tonight's installation/download; prints version and installed model names
ollama --version; ollama list
# Local npm parser/PDF generation dependencies (package names and versions only)
npm ls pdfjs-dist pdfkit exceljs yauzl fast-xml-parser
# Playwright after its Phase 6 dependency and compatible browser install
npx playwright --version; npx playwright install --list
# GitHub public read without token (prints only the public repository name)
(Invoke-RestMethod -Uri 'https://api.github.com/repos/shazzark/taskforge').full_name
# Search-provider adapter verification will be implemented with Phase 6; do not print API keys
# Windows Task Scheduler availability (boolean only)
[bool](Get-Command schtasks.exe -ErrorAction SilentlyContinue)
# Specialist-worker mocked contracts will be verified by npm test in Phase 7;
# live workers use the selected provider and share the parent's model budget.
```

For private GitHub access, verify an authorized read using the TaskForge integration once implemented; never include the token in command text or output. A command such as `gh auth status` is intentionally not prescribed because it can disclose account identity. TaskForge's `config`/`doctor` commands validate and redact current MongoDB/provider settings; the Mongo URI must include a database path.

## Direct setup/download URLs

- Groq account and API key: [https://console.groq.com/keys](https://console.groq.com/keys); [official model/tool-use docs](https://console.groq.com/docs/tool-use/overview), [current rate limits](https://console.groq.com/docs/rate-limits), [billing FAQ](https://console.groq.com/docs/billing-faqs).
- Ollama Windows installer: [https://ollama.com/download/windows](https://ollama.com/download/windows); [official model library](https://ollama.com/library). Current trial tag is a project proposal, not a guarantee of hardware fit.
- MongoDB Community Server Windows download: [https://www.mongodb.com/try/download/community](https://www.mongodb.com/try/download/community); [Windows installation instructions](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/). Optional hosted alternative: [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register).
- Playwright: [official installation](https://playwright.dev/docs/intro), [browser binaries/install list](https://playwright.dev/docs/browsers). Installing the npm library does not itself guarantee its matching browser binaries exist.
- GitHub PAT setup: [fine-grained token creation](https://github.com/settings/personal-access-tokens/new), [official permissions reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens). Select exact repositories and read-only permissions; public reads need no token.
- Tavily alternative: [free plan/signup and pricing](https://www.tavily.com/pricing), [API docs](https://docs.tavily.com/). Published free quota is 1,000 credits/month with no card; usage depends on operation.
- Parser packages: [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) is installed for text-based PDF extraction; ExcelJS/Yauzl provide bounded XLSX parsing; [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) with Yauzl provides bounded DOCX text extraction. [Mammoth](https://github.com/mwilliamson/mammoth.js) was removed after dependency audit findings.
- PDF output: [PDFKit](https://github.com/foliojs/pdfkit) (MIT; npm package `pdfkit`).
- Scheduling: Windows built-in [Task Scheduler `schtasks` reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks); no external account is needed.

## Decisions that remain open

1. **Provider priority and privacy:** The current tracker recommends Groq Free for the first online trial and lists Ollama as a local trial. This checklist recommends keeping that order, with no billing and synthetic prompts. Confirmed requirements still call for evaluating both one local tool-capable model and one free online adapter; real-data privacy and quotas differ. Do not switch providers silently.
2. **Local model fit:** `qwen3:4b-q4_K_M` and a 4K context are proposed. The model download is several GB; hardware, response speed, tool-call quality and free disk space have not been measured. Keep Ollama optional during implementation and perform the PRD-required trial before release claims.
3. **Research search:** Choose Groq built-in browser search (if accepted by the selected model/API and with its remote processing implications) or Tavily free (separate account/key, monthly quota). Recommendation: test the integrated option first and avoid a second API credential unless evidence shows it is insufficient. A Tavily key is not required for every workflow.
4. **Private GitHub access:** Public repository/issues read needs no token. Decide whether Phase 7 must read private repos. If yes, owner creates a fine-grained, repository-scoped read token; the current unrelated `GITHUB_PAT_TOKEN` is not authorized for reuse.
5. **Document boundaries:** Current PRD suggests TXT/MD/CSV/text PDF/DOCX/XLSX; scanned PDF OCR, old DOC/XLS, macros and encrypted documents are explicitly not assumed. Bounded parsers for TXT/MD/CSV/text PDF/DOCX/XLSX are installed and covered by fixtures. DOCX uses fast-xml-parser with Yauzl after Mammoth was removed during dependency review; XLSX uses ExcelJS with ZIP/workbook bounds. OCR would require a new dependency/choice and is not included.
6. **Scheduling semantics:** Windows scheduler is available, but trigger types, missed-run behavior, interactive session requirements, credentials and fresh-approval pause behavior must be settled in Phase 7. No service/account or password is needed for the proposed local-only schedule model.
7. **Specialist model:** The architecture already recommends a shared provider, shared budgets, max two workers and no nested spawning. No distinct API key or agent service is proposed. A separate model/provider would be a new decision.
8. **Phase 8 distribution:** npm publishing is not part of the prerequisite checklist; first release is clone-based. Account creation/publication requires later explicit authorization.

## Phase gates and owner actions

- **Phase 2 setup state:** MongoDB Atlas connectivity and the Groq synthetic model check are verified. Ollama installation and model download remain owner-deferred until tonight; do not install/download before then.
- **Phase 4 setup state:** parser/PDF dependencies and fixture workflows are implemented. No account action is required. Scanned PDF OCR remains out of scope unless the owner chooses that feature.
- **Before Phase 6 browser acceptance:** provide working npm registry access or a local Playwright package cache so Codex can install Playwright. The compatible Chromium browser binary must also be installed. Owner supplies an explicitly approved target/journey; login credentials only if the journey genuinely requires them. Choose integrated search or Tavily only when search is implemented.
- **Before Phase 7 private-repo acceptance:** no token for public repositories. Owner creates a fine-grained read-only token only if private access is in scope. Scheduling and specialist workers need no separate accounts/API keys. Email stays draft-only.
- **Phase 8:** no new credential required for clone-based release checks. Any npm publication remains a separately authorized action.

### Official documentation consulted

- [MongoDB Community download and Windows install](https://www.mongodb.com/try/download/community), [MongoDB manual](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/).
- [Groq tool use](https://console.groq.com/docs/tool-use/overview), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq billing FAQ](https://console.groq.com/docs/billing-faqs).
- [Ollama Windows download](https://ollama.com/download/windows).
- [Playwright install](https://playwright.dev/docs/intro), [browser binaries](https://playwright.dev/docs/browsers).
- [GitHub fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
- [Tavily current pricing](https://www.tavily.com/pricing), [Tavily API docs](https://docs.tavily.com/).
- [Windows Task Scheduler CLI](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks).
- [Mammoth DOCX extraction](https://github.com/mwilliamson/mammoth.js), [PDFKit PDF generation](https://github.com/foliojs/pdfkit), [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist), [ExcelJS](https://github.com/exceljs/exceljs).
