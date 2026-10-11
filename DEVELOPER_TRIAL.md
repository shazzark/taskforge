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

## Results

- [ ] Pass
- [ ] Pass with issues (list them below)
- [ ] Blocked (state exact blocker)

Issues or observations (no secrets, personal data, or private project content):

____________________________________________________________________

____________________________________________________________________

Trial date and reviewer initials: ____________________
