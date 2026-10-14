# Independent developer trial (pending)

This checklist is for a developer other than the author. Do not use production data or credentials. Record results in this file only after the external trial actually happens; this template is not evidence of a completed trial.

## Machine and checkout

- [ ] Windows version: ____________________
- [ ] Node.js version (`node --version`, must be 22.13.0 or later): ____________________
- [ ] npm version (`npm --version`): ____________________
- [ ] Fresh clone or clean worktree commit: ____________________
- [ ] `npm ci` completed without errors.
- [ ] `npm run typecheck` passed.
- [ ] `npm run build` passed.
- [ ] `git diff --check` passed.

## Local configuration and workflows

- [ ] Copy `.env.example` to `.env` and set only the local MongoDB URI. Keep credentials local; do not paste `.env` values into this report.
- [ ] Use a disposable database. Do not use Atlas/production data for this trial.
- [ ] `node dist/cli.js config` prints only a redacted configuration summary.
- [ ] `node dist/cli.js doctor` reports the disposable local MongoDB connection.
- [ ] `npm test` passed with `TASKFORGE_TEST_MONGODB_URI` pointed at the disposable loopback database; record passed/skipped/failed counts: ____________________
- [ ] Try the CSV and DOCX/XLSX fixtures from the repository's test suite; confirm CLI file approval and aggregate-only persistence.
- [ ] Try `schedule add` with a fixture and a future time, then `schedule list`, `pause`, `resume`, `schedule run --once`, and confirmed `delete`. Record any mismatch: ____________________
- [ ] Optional Groq check only if you already have an account/key and consent to a synthetic request. Never include the key or output containing it in this report.
- [ ] Do not install Ollama or download a model unless the project owner has explicitly reopened that deferred step.

## Approval and local file boundaries

Use a disposable folder under the trial checkout for all file examples. Do not point these checks at personal, production, or unrelated project files. The commands below require an interactive terminal; cancel if the displayed canonical path or content is unexpected.

- [ ] Create a read grant for the disposable fixture folder with `permissions approve --root <fixture-folder> --access read`; list it and confirm the canonical path and read scope are shown.
- [ ] Create a separate write grant for that folder. Revoke the read grant, list all grants, and confirm it is shown as revoked; verify a read workflow requiring that grant is refused until read access is granted again. Record any mismatch: ____________________
- [ ] Run a supported read workflow against a synthetic fixture within the granted folder. Confirm it asks for operation approval and its persisted summary contains aggregate metadata only.
- [ ] For a file-patch smoke check, create a disposable text target and replacement file in that folder. Approve the exact root/target, inspect the preview and digest, then approve the operation. Confirm only the target's intended text changed. Do not use a real source file.
- [ ] Run `software-check` with `--check typescript-check` on the clean TaskForge checkout after reviewing the root and command prompts. Confirm it reports success without writes. Optionally run one selected harmless fixture test with `--check node-test --test <relative-test-file>`; confirm the selected path is shown and unrelated tests are not selected. These commands execute approved repository code and are not an OS sandbox.

## Browser fixture and research

- [ ] Start a disposable HTTP fixture bound only to `127.0.0.1` or `localhost`; use synthetic content and no credentials. Run `run browser-audit --url <loopback-url>` in an interactive terminal and approve the exact local target. Confirm the report includes attempted checks, bounded CSS custom-property names and semantic component counts, and that page text/design observations are not persisted. Confirm mixed-content checks are marked skipped for HTTP. Stop the fixture afterward. Do not substitute a public website: real-site acceptance requires a target and journey approved by the project owner.
- [ ] Optional live research check: only if you already have an appropriately configured provider account/key, you consent to an external request, and the selected model supports browser search. Use a synthetic, non-sensitive question with `run research --query "<synthetic question>"`; confirm the CLI asks before transfer, displays validated source references and labels the answer unverified, and persists no result. Do not add billing, create an account, or include secrets/project data. If unavailable or declined, mark N/A rather than failed: ____________________
- [ ] Public-site acceptance is owner-only and must not be attempted by the independent trial developer without the owner's exact URL, read-only journey, and any additional resource origins approved in advance. The owner has not supplied them yet; leave this check pending. When authorized, verify the CLI previews exact approval details, unsupported steps are rejected, private/internal targets and DNS answers are blocked, and blocked resources appear as coverage limitations.
- [ ] Optional data specialist: use only a synthetic fixture, inspect the exact locally prepared evidence and redactions, then separately approve the configured provider transfer if desired. Confirm no filename/path is sent and no result is persisted. Without explicit transfer approval, leave N/A.

## Public read, local draft, and specialist review

- [ ] Optional public GitHub read: select a public repository with no sensitive query, review the confirmation, and run `run github-issues --repository <owner/name>`. Confirm it performs a read-only public request, excludes pull requests, displays bounded issue titles/links, and uses no token. If network access is unavailable or you decline, mark N/A: ____________________
- [ ] Create a synthetic issue or email JSON file inside the disposable folder and run `run draft --input <fixture.json> --output <new-draft.md>`. Inspect the preview and output path/hash prompt; approve it and confirm a new Markdown file is created without replacing an existing file or contacting a service.
- [ ] Optional specialist review: place a synthetic source file in the disposable folder, inspect the locally displayed excerpt/redaction, then use `run specialist-review --root <fixture-folder> --file <relative-file>` only if you consent to sending that synthetic excerpt to the currently selected provider. Confirm the separate transfer prompt, bounded findings marked unverified, and no files/results written. Declining or lacking a configured provider is N/A, not a pass: ____________________
- [ ] Do not use private GitHub credentials, send email, write to GitHub, or use personal/production content during this trial.

## Results

- [ ] Pass
- [ ] Pass with issues (list them below)
- [ ] Blocked (state exact blocker)

Issues or observations (no secrets, personal data, or private project content):

____________________________________________________________________

____________________________________________________________________

Trial date and reviewer initials: ____________________

The independent trial remains pending until another developer completes the applicable checks, records actual outcomes above, and identifies any skipped optional live-provider checks. This checklist alone is not evidence that the trial passed.
