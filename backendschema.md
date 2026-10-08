# MongoDB Schema Plan

## Deployment
MongoDB is an explicit owner choice. This local terminal tool requires a database connection, not a separate public backend. Recommend local MongoDB for local-only usage; optional hosted MongoDB sends metadata off-device and must be disclosed. URI and credentials live in environment/config secrets, never in documents or history. Use a schema validation library and versioned migrations; do not silently change collections.

## Collections
settings: profileId, schemaVersion, provider identifiers, approvedRoot references, retention settings, createdAt, updatedAt. No raw API keys.
workflows: workflowId, version, definitionHash, source, metadata, inputSchema, declaredTools and validationStatus. Built-in definitions can remain versioned files with this collection recording installed metadata.
runs: runId, workflowId/version/hash, redactedGoal, state, provider/model, authorizedRoots, budgetLimits/counters, summary, verificationStatus, createdAt, updatedAt, expiresAt.
events: eventId, runId, sequence, eventType, agentId, redactedPayload, payloadBytes, createdAt, expiresAt. Unique (runId, sequence). Payload bounded; no raw binaries.
checkpoints: checkpointId, runId, schemaVersion, nextStep, completedActionIds, inputHashes, outstandingActionIds, stateReferences and createdAt. No reusable approval grants.
artifacts: artifactId, runId, relativePath, type, sha256, bytes, evidenceReferences, createdAt. File content stays local.
schedules: scheduleId, workflow/version, redactedInputs, timezone, trigger, enabled, nextRunAt, leaseUntil, lastRunId and createdAt. Validate inputs and avoid duplicate overlapping runs.

## Indexes and deletion
Unique runId, eventId, workflowId+version and scheduleId. Index events by runId+sequence and runs by createdAt. TTL on events.expiresAt and eligible runs.expiresAt, acknowledging TTL is eventual rather than immediate. Child cleanup requires an explicit retention job; TTL alone does not cascade to checkpoints, artifacts or files. history delete performs application-level coordinated cleanup and records failures without claiming all data is gone.

## State transitions
created -> planning -> awaitingApproval/executing -> validating -> completed. Nonterminal runs can become blocked, failed, cancelled or checkpointed. Partial work is represented explicitly. Workers cannot mark the parent complete. Completion requires workflow acceptance results and durable final state.

## Storage growth
Saving full conversations forever would grow storage. The proposed summary-first, bounded-event approach plus opt-in transcripts and retention limits avoids that default. Measure actual run sizes; do not promise a particular database capacity. Local artifacts also consume disk and need an inspect/cleanup command.
