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
npm run cli -- --help
npm run cli -- --version
npm test
```

The CLI supports help, version output, and `config` validation. Configuration reads the explicitly named `TASKFORGE_MONGODB_URI` environment variable. In PowerShell, set it only in the current session (`$env:TASKFORGE_MONGODB_URI`) and run `npm run cli -- config`. The command validates the URI format and prints a redacted status; it does not connect to MongoDB. The internal MongoDB layer can connect and persist minimal run summaries; the CLI does not expose those operations yet. Do not print or commit the connection string.

Task execution, model providers, doctor checks, and other runtime features are not implemented yet.
