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

The CLI supports help, version output, `config` validation, and `doctor`. Configuration reads the explicitly named `TASKFORGE_MONGODB_URI` environment variable. In PowerShell, set it only in the current session (`$env:TASKFORGE_MONGODB_URI`) and run `node dist/cli.js config`. The command validates the URI format and prints a redacted status; it does not connect to MongoDB. Run `node dist/cli.js doctor` to check that MongoDB is configured and reachable. Doctor reports model providers and browser tooling as not implemented. The internal MongoDB layer can persist minimal run summaries; the CLI does not expose those operations yet. Do not print or commit the connection string.

Task execution, model providers, and other runtime features are not implemented yet.
