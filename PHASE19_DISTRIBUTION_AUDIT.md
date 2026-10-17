# Phase 19.1 — Windows distribution inventory

Audit date: 17 October 2026. This is a read-only requirements and packaging inventory. It does not select an installer, download a runtime or browser, modify system services, or claim Phase 19 acceptance.

## Current repository state

- `package.json` publishes an npm CLI package with Node `>=22.13.0`; its `files` allowlist includes compiled `dist`, README, MIT license, and third-party notices. There is no setup wizard, installer manifest, bundled `node.exe`, update mechanism, SBOM generation, package scan gate, or install/upgrade/uninstall lifecycle.
- The local runtime used for recovery is Node 22.13.0. On the audit date Node 24 is LTS and Node 26 is Current; TaskForge has not been verified on Node 24. Keep Node 24 as a candidate bundled runtime, then verify compatibility before selecting it. The repository's existing lower-bound compatibility must also remain tested unless deliberately revised.
- A current `npm pack --dry-run --json` lists 48 entries (134,937 compressed bytes; 636,312 unpacked). It contains `dist/architecture-report.js` and `dist/integrations/deployment-tracing.js`, reports no bundled dependencies, and the checked path filter found no `.env`, credential, session, private, or report paths. This is an npm package inventory only; it does not include a Node runtime or Playwright browser binaries.
- Browser workflows dynamically import `playwright` from `src/workflows/browser-audit-workflow.ts`, but `playwright` is currently declared under `devDependencies`. The existing 14 October production-consumer smoke covered package install, `npm ls --omit=dev`, version, and help; it did not run a browser command. A production consumer therefore lacks a declared runtime dependency for this existing feature until the dependency classification is corrected and verified.
- Playwright's documented browser-install process uses binaries matched to its exact release. Its documentation says the browser binaries are installed separately and can consume hundreds of megabytes; the Windows default cache is under `%USERPROFILE%\AppData\Local\ms-playwright`. The CLI currently does not pin a product-owned browser directory or include the browser binary in its npm artifact.
- Local SQLite data is stored beneath the operating-system application-data root, currently `%LOCALAPPDATA%\TaskForge\taskforge.sqlite3`. An installer/uninstaller must preserve user data by default and must not import browser profiles or credentials.
- `THIRD_PARTY_NOTICES.md` records earlier dependency license and production consumer reviews. It is not a final license/SBOM review of a self-contained Node plus browser bundle. No code-signing, checksum, SBOM, clean-machine, upgrade/side-by-side, or uninstall-retention gate currently exists.

## Distribution choices to evaluate later

1. **Portable ZIP:** TaskForge files and the official Node runtime in one versioned directory, with a guided first-run script. Define where Chromium and per-user data live; upgrades remain user-directed and side-by-side.
2. **Windows installer:** A user-scoped installer that places the same verified payload, creates shortcuts, and supports side-by-side versions. This adds installer integrity/signing, repair, upgrade, and uninstall-retention requirements.

These are comparison candidates, not a selected product decision. Do not introduce a paid installer/update service, Windows service, unattended update, or model download. Do not choose bundle composition until the runtime/dependency/browser inventory is verified on clean Windows.

## Dependency ordering and next work

Phase 19.1 inventory is COMPLETE. Phase 19 remains IN PROGRESS; no distribution implementation has started. Before a bundled runtime implementation, complete the applicable Phase 10 cross-backend, Windows ACL/durability, recovery/backup, and runtime compatibility gates. Separately correct and verify runtime dependency packaging (including Playwright) and test the browser command from a production-only consumer. Then compare payload sizes, target architectures, license notices, integrity/SBOM scanning, data preservation, upgrade and side-by-side behavior, and uninstall retention. Clean-machine acceptance needs a Windows operator/machine but not for this inventory.

## Primary references checked

- [Node.js release schedule and supported-version policy](https://nodejs.org/en/about/previous-releases)
- [Playwright browser binaries, installation, cache location, and hermetic-install options](https://playwright.dev/docs/browsers)
- [Playwright package metadata and license](https://github.com/microsoft/playwright/blob/main/packages/playwright/package.json)
