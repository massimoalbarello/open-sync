---
name: add-sync-source
description: Add or change an Open Sync source integration, including its atomic step, checkpoint, records, and assets. Use for source authoring, not engine scheduling or destination implementation.
---

# Add a sync source

Read the [source contract](../../../packages/sync/src/models/definition.ts),
[record contract](../../../packages/sync/src/models/record.ts), and
[asset contract](../../../packages/sync/src/models/asset.ts). Use public package exports and
register the source in the host; keep provider-specific behavior outside the engine.
Follow the repository's engineering and compatibility guidance.

## Choose the unit of progress

- When the provider supports pagination, each `step()` fetches exactly one discovery page using
  its native cursor or other continuation mechanism. Resume from the saved position instead of
  fetching earlier pages and filtering locally. Each source chooses a page size small enough to
  finish all related work within the engine's execution and capacity limits.
- Fetch all details, nested pages, and assets for that discovery page before returning; do not
  fetch a second discovery page. Await every capture and return complete records. Never leave
  background work or unfinished records for the next step.
- Store only what the next step needs to resume: the continuation position and necessary scan
  context, such as a frozen query or account identity. Never store discovered ID lists, response
  bodies, partial records, or downloaded bytes.
- If the available endpoint returns an unpaginated listing, process the entire returned listing
  in one step. Split detail requests only to respect actual API limits, and finish all those
  requests before yielding. Do not invent continuation IDs or re-list and filter to manufacture
  smaller steps. A request batch limit is not a checkpoint boundary.
- Verify pagination capabilities for the actual endpoint and authentication mode; justify any
  exception to native pagination. Reject explicit truncation and state coverage limitations.
  Exhausting the returned list does not prove the provider exposed all historical data.
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
  declare the returned references in each record's `assetRefs`. Use `assetPlaceholder()` when
  embedding a reference in JSON or readable content; keep Markdown in `content`, not engine-marked
  fields inside `data`. The engine treats `data` values as opaque. Keep credentials,
  temporary download URLs, and file paths out of checkpoints and queued output. Preserve
  explicit unavailable-asset outcomes instead of silently dropping attachments.
- Use the bound provider operations and declare their required capabilities. Preserve classified
  provider failures; normalize raw HTTP failures with `SourceHttpError`. Let the engine own
  retry timing, concurrency, capacity, and cleanup. Honor `context.signal` and pass it to any
  additional I/O; do not add retry sleeps or shared mutable state between syncs.

## Prove the boundary

Test with the real engine and durable storage: fail after some data or an asset has been fetched,
verify no partial records or advanced checkpoint are committed, then restart and finish the step.
Cover resuming at the next provider page without re-fetching preceding listing pages, multi-page
completion, replay without duplicate changes, and cursor recovery. For pagination exceptions,
cover incomplete listings and the declared coverage limit. Check the source's update/deletion
semantics and checkpoint compatibility. Implementations are registered by name; replace the sync
for incompatible changes instead of silently reinterpreting its saved checkpoint.
