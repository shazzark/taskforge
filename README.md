# taskforge

An open-source terminal AI agent for repeatable developer workflows and extensible tasks.

**Status:** TaskForge is in early development. User-facing workflow features are not implemented yet.

Repository: https://github.com/shazzark/taskforge

## Local development

Requirements: Node.js 22.13.0 or later and npm.

```powershell
npm ci
npm run typecheck
npm run build
node dist/cli.js --help
node dist/cli.js --version
npm test
```

The CLI supports help, version output, `config`, `doctor`, `model-check`, `chat`, `run csv-analyze`, `run document-analyze`, `run repo-inspect`, `resume`, and `history list`. Configuration reads `TASKFORGE_MONGODB_URI` and the selected `TASKFORGE_PROVIDER` settings from the process environment or the ignored repository-root `.env`; existing process variables take precedence. `config` validates settings and prints a redacted summary. `doctor` checks MongoDB connectivity but does not contact the model. `model-check` sends a fixed synthetic prompt to the selected provider and verifies one read-only fixture tool call. `chat` is interactive, bounded, and asks before sending text to Groq; local Ollama does not send the prompt to a remote model provider. `csv-analyze` reads one approved input file. `document-analyze` reads one approved TXT, Markdown, text PDF, DOCX, or XLSX file, then stores aggregate counts only. `repo-inspect` asks before inventorying one exact root and records bounded metadata only; it does not read source contents or run commands. Use `TASKFORGE_PROVIDER=groq` with `TASKFORGE_GROQ_API_KEY` and optional `TASKFORGE_GROQ_MODEL`, or `TASKFORGE_PROVIDER=ollama` with `TASKFORGE_OLLAMA_BASE_URL` and `TASKFORGE_OLLAMA_MODEL`. Ollama must be installed and the chosen model pulled separately. Never print or commit `.env` values.

Most planned software, document, browser, research, connection, scheduling, and specialist-agent workflows remain in progress. The only executable tool currently exposed by the model-check path is a fixed synthetic fixture.
