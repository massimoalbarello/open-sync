---
name: add-sync-destination
description: Add or change an Open Sync destination integration, including durable acceptance, replay safety, and asset delivery. Use for destination authoring, not source fetching or engine scheduling.
---

# Add a sync destination

Read the [destination contract](../../../packages/sync/src/models/delivery.ts),
[record contract](../../../packages/sync/src/models/record.ts), and
[asset contract](../../../packages/sync/src/models/asset.ts). Implement `DestinationType` through
public package exports and register it in the host. Keep transport and receiver-specific behavior
in the destination; follow the repository's engineering and compatibility guidance.

## Make acceptance durable

- Return `accepted` only after the whole delivery is durably accepted by the receiver. Finish all
  I/O before returning; an in-memory handoff or an unawaited request is not durable acceptance.
- Expect retries after timeouts, restarts, or a lost acknowledgement, including after the receiver
  has already committed. Use stable deliverable IDs and record revisions for idempotency. Scope
  stored records to their owner, configured sync, kind, and ID, and protect newer revisions from stale replay. If the receiver
  cannot commit a batch atomically, make each effect replay-safe before acknowledging the batch.
- Use `retry` for temporary failures, optionally providing a server-requested delay, and `rejected`
  for permanent failures requiring intervention. Never report success to clear an error. The
  engine owns the queue and backoff; the destination does not run a polling or retry loop.

## Deliver records with their assets

- Receive one `deliverable` with its stable ID, sync identity, original records, asset descriptors,
  and `openAsset(ref)` function. Read bytes only through that function; never depend on engine
  storage paths, source credentials, or a later call back to the source.
- Choose the receiver's natural contract: accept the whole deliverable together, or upload its
  assets first and then send records with receiver references. Use `resolveAssetReference()`
  to read a declared placeholder; the destination owns any JSON or content rewriting. The engine does
  not persist upload receipts or rewritten records; a retry receives the original deliverable and
  may repeat uploads. The destination owns upload idempotency, reference mapping, and any durable
  representation it needs. Handle explicit unavailable descriptors deliberately.
- Consume streams during the delivery attempt. After acceptance the engine may delete its local
  files immediately, so deferred receiver work needs its own durable copy or reference.

## Preserve isolation and verify recovery

Honor the supplied scope and cancellation signal, and pass the signal through outbound I/O.
Independent syncs can call the same destination concurrently; avoid shared mutable request state
and assumptions of global ordering. Validate configuration during sync creation. Implementations
are registered by name; settle queued work and replace the sync before changing its delivery
contract incompatibly.

Test the receiver committing successfully but losing its acknowledgement, then retry after an
engine restart: verify the receiver handles repeated uploads and record delivery safely. Also cover
partial upload/batch failure, asset availability before record acceptance, owner isolation, and cancellation where applicable.
