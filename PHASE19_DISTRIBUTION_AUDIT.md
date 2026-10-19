# Phase 19 — Windows distribution inventory and checkpoints

Audit date: 19 October 2026. This records bounded setup and package checks. It does not select an installer, bundle a runtime or browser, modify system services, or claim Phase 19 acceptance.

## Current repository state

- `package.json` publishes an npm CLI package with Node `>=22.13.0`; its `files` allowlist includes compiled `dist`, README, MIT license, and third-party notices. There is no setup wizard, installer manifest, bundled `node.exe`, update mechanism, SBOM generation, package scan gate, or install/upgrade/uninstall lifecycle.
- The local runtime used for recovery is Node 22.13.0. On the audit date Node 24 is LTS and Node 26 is Current; TaskForge has not been verified on Node 24. Keep Node 24 as a candidate bundled runtime, then verify compatibility before selecting it. The repository's existing lower-bound compatibility must also remain tested unless deliberately revised.
- Historical Phase 19.1 inventory counted 63 files. The current `npm run package:audit` performs a clean build and validates the dry-run tarball inventory against the exact compiled paths derived from TypeScript sources and a top-level allowlist. It passed with 64 files and rejects any extra or missing `dist` file, including data disguised with an otherwise permitted extension. This remains an npm package inventory only; it does not include a Node runtime or Playwright browser binaries.
- Browser workflows dynamically import `playwright` from `src/workflows/browser-audit-workflow.ts`. Playwright is now pinned as a production dependency. A disposable Windows production consumer installed the packed tarball with dev dependencies omitted, imported Playwright and the browser workflow module, and ran the packaged CLI version command successfully. This verifies dependency packaging and module loading only; no browser binary was copied/downloaded or launched.
- Playwright's documented browser-install process uses binaries matched to its exact release. Its documentation says the browser binaries are installed separately and can consume hundreds of megabytes; the Windows default cache is under `%USERPROFILE%\AppData\Local\ms-playwright`. The CLI currently does not pin a product-owned browser directory or include the browser binary in its npm artifact.
- Local SQLite data is stored beneath the operating-system application-data root, currently `%LOCALAPPDATA%\TaskForge\taskforge.sqlite3`. An installer/uninstaller must preserve user data by default and must not import browser profiles or credentials.
- `THIRD_PARTY_NOTICES.md` records earlier dependency license and production consumer reviews. It is not a final license/SBOM review of a self-contained Node plus browser bundle. No code-signing, checksum, SBOM, clean-machine, upgrade/side-by-side, or uninstall-retention gate currently exists.

## Distribution choices to evaluate later

1. **Portable ZIP:** TaskForge files and the official Node runtime in one versioned directory, with a guided first-run script. Define where Chromium and per-user data live; upgrades remain user-directed and side-by-side.
2. **Windows installer:** A user-scoped installer that places the same verified payload, creates shortcuts, and supports side-by-side versions. This adds installer integrity/signing, repair, upgrade, and uninstall-retention requirements.

These are comparison candidates, not a selected product decision. Do not introduce a paid installer/update service, Windows service, unattended update, or model download. Do not choose bundle composition until the runtime/dependency/browser inventory is verified on clean Windows.

## Phase 19.4–19.5 checks and dependency ordering

Phase 19.1 inventory, 19.2 runtime dependency packaging, 19.3 read-only setup guide, and 19.4 Node compatibility diagnosis are verified. Phase 19.5 adds manual runtime/browser prerequisites and a package inventory gate. `npm run package:audit` passed for 64 files. Offline CycloneDX SBOM generation reported 148 components; `png-js@2.0.0` is the only dependency without license metadata, while a local MIT license file and the evidence are recorded in `THIRD_PARTY_NOTICES.md`. This is not a complete license/legal review. `taskforge setup` reports redacted storage/provider configuration status and manual prerequisites; it does not connect to providers, write configuration, or install Node, browser binaries, or models. Phase 19 remains IN PROGRESS; no bundled runtime or installer implementation has started. Before bundle changes, complete applicable Phase 10 cross-backend, Windows ACL/durability, recovery/backup, and runtime compatibility gates. Then compare payload sizes, target architectures, license notices, integrity/SBOM scanning, data preservation, upgrade and side-by-side behavior, and uninstall retention. Clean-machine acceptance needs a Windows operator/machine but not for these package checks.

In this resumed session, the official MongoDB Database Tools guide was checked. Its Windows ZIP procedure is to download the x86_64 ZIP, extract the `bin` tools locally, and optionally add their directory to PATH. Neither `mongodump`, `mongorestore`, nor `mongod` is currently on PATH; the available `winget.exe` could not launch, so no new installation was made. This does not invalidate the previously recorded Phase 10.11 verification: `task.md` records that MongoDB Database Tools 100.19.1 was installed temporarily and `mongodump`/`mongorestore` were exercised against disposable loopback MongoDB 8.2.0 data, with both databases and dump removed afterward. That bounded backup/restore evidence remains distinct from production backup operations, Windows ACLs, or power-loss durability. No existing URI or credentials were used for the temporary loopback verification.

## Primary references checked

- [Node.js release schedule and supported-version policy](https://nodejs.org/en/about/previous-releases)
- [Playwright browser binaries, installation, cache location, and hermetic-install options](https://playwright.dev/docs/browsers)
- [Playwright package metadata and license](https://github.com/microsoft/playwright/blob/main/packages/playwright/package.json)
