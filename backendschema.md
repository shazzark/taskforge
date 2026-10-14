# Persistence Schema Plan: Local Default and Optional MongoDB

## Deployment
**Current implementation:** MongoDB only. **Approved target:** local persistence by default for new installations, with the existing MongoDB adapter retained as an explicit option. This plan does not imply the local adapter exists yet. MongoDB URI and credentials remain in environment/config secrets, never in documents or history. A hosted MongoDB sends metadata off-device and must be disclosed.

The persistence interface must serve settings, folder approvals, workflow/run state, redacted events, checkpoints, artifact metadata and schedules. Both adapters must enforce the same runtime schemas and permission boundaries. Backend choice must be explicit and visible in redacted `config`/`doctor` output. An unavailable or invalid selected backend fails closed; it never falls back to another store. New installations choose local storage. Existing users with MongoDB data retain it in place; the application must not migrate, delete, copy, overwrite, or silently stop using it. Any future migration must be a separate owner-invoked, previewed, backed-up, verifiable operation and is not part of automatic setup.

**Local adapter decision gate:** choose and document a Windows-supported local database/file implementation only after comparing crash consistency, concurrent-process locking, encryption expectations, backup/restore, schema upgrades, package/runtime compatibility and fixture-testability. Do not assume Node's built-in SQLite maturity or add a native dependency without the compatibility review. Local data location, file ACLs, retention, and recovery instructions are unresolved design details; preserve the owner’s existing data regardless of the eventual choice.

**Schema contract:** retain the logical entities below across both adapters. Define an adapter-neutral schema version and validate persisted records on every read. Backend-specific indexes/constraints must provide equivalent uniqueness, ordering and safe state transitions. Do not claim transactional parity until contract tests cover it.

## Collections
settings: profileId, schemaVersion, provider identifiers, approvedRoot references, retention settings, createdAt, updatedAt. No raw API keys.
workflows: workflowId, version, definitionHash, source, metadata, inputSchema, declaredTools and validationStatus. Built-in definitions can remain versioned files with this collection recording installed metadata.
runs: runId, workflowId/version/hash, redactedGoal, state, provider/model, authorizedRoots, budgetLimits/counters, summary, verificationStatus, createdAt, updatedAt, expiresAt.
events: eventId, runId, sequence, eventType, agentId, redactedPayload, payloadBytes, createdAt, expiresAt. Unique (runId, sequence). Payload bounded; no raw binaries.
checkpoints: checkpointId, runId, schemaVersion, nextStep, completedActionIds, inputHashes, outstandingActionIds, stateReferences and createdAt. No reusable approval grants.
artifacts: artifactId, runId, relativePath, type, sha256, bytes, evidenceReferences, createdAt. File content and absolute output paths stay local. CSV aggregate exports and plain-text document conversions store a filename relative to the approved output folder, format, hash, byte count, run link, and timestamp.
schedules: scheduleId, workflow/version, redactedInputs, timezone, trigger, enabled, nextRunAt, leaseUntil, lastRunId and createdAt. Validate inputs and avoid duplicate overlapping runs.

## Indexes and deletion
Unique runId, eventId, workflowId+version and scheduleId. Index events by runId+sequence and runs by createdAt. TTL on events.expiresAt and eligible runs.expiresAt, acknowledging TTL is eventual rather than immediate. Child cleanup requires an explicit retention job; TTL alone does not cascade to checkpoints, artifacts or files. history delete performs application-level coordinated cleanup and records failures without claiming all data is gone.

## State transitions
created -> planning -> awaitingApproval/executing -> validating -> completed. Nonterminal runs can become blocked, failed, cancelled or checkpointed. Partial work is represented explicitly. Workers cannot mark the parent complete. Completion requires workflow acceptance results and durable final state.

## Storage growth
Saving full conversations forever would grow storage. The proposed summary-first, bounded-event approach plus opt-in transcripts and retention limits avoids that default. Measure actual run sizes; do not promise a particular database capacity. Local artifacts also consume disk and need an inspect/cleanup command.

## Local-default acceptance additions

- Run the same adapter contract suite against an isolated temporary local store and an isolated disposable MongoDB database.
- Prove restart durability, simultaneous-process behavior, interrupted writes, malformed/version-mismatched record rejection, and database-unavailable failure for each backend.
- Prove that a new installation selects local storage, explicit MongoDB selection uses the configured database, and errors do not switch backend.
- Seed existing Mongo records, run setup/config/doctor without selecting MongoDB, and verify the records remain intact; then explicitly select MongoDB and verify expected existing data remains readable.
- Document data path, ACL/privacy characteristics, backup, restore, retention and recovery before marking the local backend accepted. Never include the local data file in package artifacts or diagnostics.
- Migration is not implemented or implied. No test or setup path may drop or transform an existing owner database; integration cleanup may only drop its own uniquely named disposable test database.
