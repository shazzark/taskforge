# Run lifecycle: current behavior

Audit date: 2026-10-17. This records implemented behavior, not the broader lifecycle target in `appflow.md` or `TRD.md`.

## Cancellation and interruption

There is no `cancel <run-id>` command. Interactive `N`/decline stops the specific operation before the access or effect guarded by that prompt. Ctrl+C is handled by signal-aware active paths in `do`, `chat`, `agent-fix`, `model-investigate`, `specialist-review`, `research`, browser audit, software checks, `model-check`, and the foreground scheduler. It stops further work where the active dependency honors cancellation; it cannot undo completed effects. CSV and document named commands do not install their own active-run SIGINT handler. A process exit during their asynchronous work can leave a `running` record until stale recovery is eligible.

| Operation boundary | Current result and persisted state | Limitation |
|---|---|---|
| Provider transfer consent declined | No provider request is made; operation reports cancellation. | Does not cancel another run. |
| Exact file/action approval declined | That guarded read, write, move, or command is not started; earlier completed steps remain. | A prior approved provider request may already have happened. |
| Signal during supported provider/tool work | Signal-aware code aborts supported requests, stops starting actions, and records cancellation/failure where persistence is available. | Dependencies may not stop instantly; already completed actions remain. |
| Signal during software check | Child process is terminated with the runner's bounded grace behavior; cancellation is persisted in the run result. | Approved repository code is not sandboxed and may have its own side effects. |
| Signal during browser/specialist work | Cancellation is propagated through supported browser/provider steps; browser context closes on handled cleanup. | No session-wide cancellation endpoint; server-side effects of a site's own GET behavior cannot be guaranteed absent. |
| CSV/document command interrupted or process crashes | Run may remain `running`; after the two-minute stale threshold it can be atomically recovered only through the supported workflow resume path. | No general resume for other workflows. Do not assume an operation did not occur. |
| File patch/move/output has started | The command verifies the relevant content/path/hash and reports its observed result. | In-place patch is not crash-atomic; interruption around a side effect can leave an uncertain state. No automatic rollback. |
| Schedule runner stops with a dispatch claim | Owner can stop the previous runner and explicitly use `schedule recover <id>`. | Recovery clears the claim; fresh occurrence and file approval are still required. Never recover while the prior runner may be active. |

## Resume contract

Only uncertain `csv-analyze` and `document-analyze` runs support `resume <run-id> --input <path>`. A `running` run is eligible only after its two-minute inactivity threshold and atomic stale-run claim. Resume requires fresh exact-file approval and the existing stored read-folder grant; the current input SHA-256 and workflow state hash must match. CSV state binds selected numeric columns. Document state now binds the normalized format (`taskforge:document-analyze:v2:<format>`), so identical bytes with a different extension/parser mode are rejected. Older uncertain document checkpoints with the former format-agnostic v1 state hash fail closed and remain stored. Resume replays deterministic analysis only. Chat, agent, research, browser, specialist, software-check, and arbitrary named workflows do not support resume.

Scheduled work has a separate foreground occurrence-recovery path: `schedule recover <id>` requires confirmation that its previous runner stopped, clears the stale claim, and preserves pending approval. It does not bypass fresh schedule/file approval or the CSV/document checkpoint validation above.

## History and retention

`history list` returns at most the newest 50 run summaries, sorted by creation time, with redacted summary text and metadata-only artifact references. Both SQLite and MongoDB adapters retain older records; there is no automatic purge, retention policy, or history-delete CLI/API. The 50-item limit is a listing window, not deletion. Chat transcripts, provider messages, source content, and browser DOM/screenshots are not persisted as run history. Artifacts remain in their approved local folders; history lists metadata but does not delete artifact files. Any future retention or delete behavior requires a separately reviewed policy.

## Verification status

Document format binding has focused unit coverage and MongoDB integration coverage. SQLite history listing has a focused test that creates 55 runs, checks a redacted summary in the visible window, and verifies an older record remains retrievable. Full serial isolated-Mongo verification passed on 2026-10-17: 179 passed, zero failed, zero skipped, after the four CLI timeout cases passed in isolation and in the clean retry; see `task.md` for exact commands and database details. SQLite document-resume workflow behavior is not separately integration-tested, although generic checkpoint persistence and the MongoDB document-resume workflow are covered.
