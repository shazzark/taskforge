# taskforge

An open-source terminal AI agent for repeatable developer workflows and extensible tasks.

**Status:** TaskForge is in early development. Several bounded CLI workflows are implemented; remaining planned workflows are tracked in `task.md`.

Repository: https://github.com/shazzark/taskforge

## Local development

`run research --query "..."` sends only the approved query to Groq's built-in browser search after an interactive prompt. It requires the selected model to be one of Groq's supported GPT OSS models, displays bounded validated sources and an unverified answer, and persists nothing. It uses the existing Groq configuration and has no separate search key; see [Groq Browser Search](https://console.groq.com/docs/tool-use/built-in-tools/browser-search) for current limits and service details.

Contributor setup and review expectations are in [CONTRIBUTING.md](CONTRIBUTING.md).

Requirements: Node.js 22.13.0 or later and npm.

```powershell
npm ci
npm run typecheck
npm run build
node dist/cli.js --help
node dist/cli.js --version
npm test
```

The CLI supports help, version output, `config`, `doctor`, `model-check`, `chat`, `run csv-analyze`, `run document-analyze`, `run pdf-report`, `run repo-inspect`, `run source-review`, `run model-investigate`, `run github-issues`, `run file-patch`, `run git-diff`, `run software-check`, `resume`, and `history list`. Configuration reads `TASKFORGE_MONGODB_URI` and the selected `TASKFORGE_PROVIDER` settings from the process environment or the ignored repository-root `.env`; existing process variables take precedence. `config` validates settings and prints a redacted summary. `doctor` checks MongoDB connectivity but does not contact the model. `model-check` sends a fixed synthetic prompt to the selected provider and verifies one read-only fixture tool call. `chat` is interactive, bounded, and asks before sending text to Groq; local Ollama does not send the prompt to a remote model provider. `csv-analyze` reads one approved input file. `document-analyze` reads one approved TXT, Markdown, text PDF, DOCX, or XLSX file, then stores aggregate counts only. `pdf-report` reads approved JSON and writes a new PDF only after showing the output path and hash for confirmation; it never replaces an existing file. `repo-inspect` asks before inventorying one exact root and records bounded metadata only; it does not read source contents or run commands. `source-review` requires approval of an exact root and explicit relative file list, then displays bounded source locally after common credential-pattern redaction; it neither sends nor persists source contents. Redaction is heuristic, so review displayed source before copying it elsewhere. `model-investigate` displays up to five selected source excerpts after heuristic redaction and requires a second explicit confirmation before sending those exact excerpts to the configured provider. It offers no tools, does not persist excerpts or findings, and labels the response as unverified. `github-issues --repository owner/name` asks before making one public read-only API request, uses no token, and displays at most 20 open issue titles (pull requests are excluded). Public reads are limited by GitHub's unauthenticated API quota. `file-patch` requires approval for an exact root, target, and replacement file, shows redacted before/after text and a SHA-256 hash, and revalidates the target before writing through the approved file handle. It preserves the existing file identity and permissions, but the in-place write is not crash-atomic and cannot coordinate with another process concurrently editing that same file. `git-diff` asks for approval of the canonical repository root and exact staged tracked file list, then displays up to 48 KiB of locally redacted diff. It excludes unstaged and untracked files and refuses protected secret paths; the redaction remains heuristic. `software-check` requires separate root and check approval, then runs only `node --test` or the local TypeScript compiler with `--noEmit`; it does not display or persist command output. These checks execute code from the approved repository and are not an OS sandbox. Use `TASKFORGE_PROVIDER=groq` with `TASKFORGE_GROQ_API_KEY` and optional `TASKFORGE_GROQ_MODEL`, or `TASKFORGE_PROVIDER=ollama` with `TASKFORGE_OLLAMA_BASE_URL` and `TASKFORGE_OLLAMA_MODEL`. Ollama must be installed and the chosen model pulled separately. Never print or commit `.env` values.

`run draft --input <draft.json> --output <new.md>` creates a local Markdown GitHub issue or email draft from an approved JSON input, previews the content, and requires approval bound to a new output path and SHA-256 digest. It never contacts GitHub or an email service. Issue JSON uses `kind`, `repository`, `title`, and `body`, with optional `sourceIssueUrl`; email JSON uses `kind`, `subject`, and `body`, with optional `to`. As with other Node path-based artifact output, it does not protect against a hostile concurrent swap of the approved output directory.

`run specialist-review --root <directory> --file <relative-path> [...]` locally reviews up to five approved source files, then asks separately before transfer. It runs up to two read-only specialist prompts and a parent review on the selected provider, shares one 40-request/30-action run budget, rejects tool calls and nested delegation, and stores no source or findings. All findings are unverified and need human review.

Most planned software, document, browser, research, connection, scheduling, and specialist-agent workflows remain in progress. The only executable tool currently exposed by the model-check path is a fixed synthetic fixture.
