---
name: add-sync-source
description: Add or change an Open Sync source integration, including its atomic step, checkpoint, records, and assets. Use for source authoring, not engine scheduling or destination implementation.
---

# Add a sync source

Read the [source contract](../../../packages/sync/src/models/definition.ts),
[record contract](../../../packages/sync/src/models/delivery.ts), and
[asset contract](../../../packages/sync/src/models/asset.ts). Use public package exports and
register the source in the host; keep provider-specific behavior outside the engine.
Follow the repository's engineering and compatibility guidance.

## Choose the unit of progress

- Make one `step()` finish one bounded page or batch of complete records. Fetch all details,
  nested pages, and assets needed for those records before returning. Await every capture;
  never leave background work or unfinished records for the next step.
- Keep checkpoints small: cursors, stable key positions, and scalar scan state such as a frozen
  time boundary or account identity. Never store discovered ID lists, response bodies, partial
  records, or downloaded bytes. Reduce the discovery page size when complete records are large.
- Return the next checkpoint with the complete output. The engine commits them atomically.
  Throw on incomplete or failed retrieval; never skip failed records to advance the cursor.
  Set `complete` only when the current scan is exhausted.
- Establish how pagination behaves during updates, restarts, and cursor expiry. Use stable
  ordering and scan boundaries where available; replay safely when recovery requires revisiting
  data. A missing item in a partial listing is not evidence of deletion.

## Keep output replayable

- Use stable record IDs and deterministic content. Preserve upstream timestamps; avoid adding
  fetch-time values that turn unchanged records into updates. Define what updates and deletions
  the source can actually observe, and guard against resuming under a different account.
- Capture assets through `context.assets`, give each immutable version a stable identity, and
  link the returned references from records using the asset contract. Keep credentials,
  temporary download URLs, and file paths out of checkpoints and queued output. Preserve
  explicit unavailable-asset outcomes instead of silently dropping attachments.
- Use the bound provider operations and declare their required capabilities. Preserve classified
  provider failures; normalize raw HTTP failures with `SourceHttpError`. Let the engine own
  retry timing, concurrency, capacity, and cleanup. Honor `context.signal` and pass it to any
  additional I/O; do not add retry sleeps or shared mutable state between syncs.

## Prove the boundary

Test with the real engine and durable storage: fail after some data or an asset has been fetched,
verify no partial records or advanced checkpoint are committed, then restart and finish the step.
Cover multi-page completion, replay without duplicate changes, cursor recovery, and the source's
update/deletion semantics where applicable. Check schema and version compatibility when changing
an existing source; do not silently reinterpret a saved checkpoint.
