# taskforge

An open-source terminal AI agent for repeatable developer workflows and extensible tasks.

**Status:** TaskForge is in early development. Runtime features are not implemented yet.

Repository: https://github.com/shazzark/taskforge

## Local development

Requirements: Node.js 22.13.0 or later and npm.

```powershell
npm ci
npm run typecheck
npm run build
npm run cli -- --help
npm run cli -- --version
```

The CLI currently supports help and version output only. Task execution, model providers, and other runtime features are not implemented.
