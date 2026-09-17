import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Delivery } from '@open-sync/core/delivery';
import { createMarkdownWebhook } from '@open-sync/examples/destinations/markdown-webhook';
import { githubPullRequests } from '@open-sync/examples/syncs/github-markdown';
import { engineFixture, owner } from './github-markdown/engine-fixture';

test('receiver commit followed by a failed acknowledgement retries identical content after restart', async () => {
  const unavailable = 503;
  const accepted = 204;
  const directory = mkdtempSync(join(tmpdir(), 'open-sync-receiver-'));
  const receiver = new Database(join(directory, 'receiver.sqlite'));
  receiver.exec('CREATE TABLE receipts (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  const bodies: string[] = [];
  const keys: (string | null)[] = [];
  const auth: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const body = await request.text();
      const delivery: Delivery = JSON.parse(body);
      bodies.push(body);
      keys.push(request.headers.get('idempotency-key'));
      auth.push(request.headers.get('authorization'));
      // The host owns this transaction and retry safety; the sync engine cannot share it.
      receiver
        .query('INSERT OR IGNORE INTO receipts (id, body) VALUES (?, ?)')
        .run(delivery.id, body);
      return new Response(null, {
        status: bodies.length === 1 ? unavailable : accepted,
        headers: { 'retry-after': '3600' },
      });
    },
  });
  const harness = await engineFixture(
    createMarkdownWebhook({ endpoint: server.url.href, bearerToken: 'test-only-receiver-key' }),
  );
  try {
    await harness.engine.tick();
    await harness.engine.tick();
    expect(bodies).toHaveLength(1);
    const queued = harness.engine.api.deliveries(owner).deliveries[0]!;
    expect(queued.errorCode).toBe('http_503');
    expect(harness.engine.api.status(owner).queue.pendingRecords).toBe(1);
    expect(
      harness.engine.api.installation({ ...owner, id: harness.installation.id }).checkpoint,
    ).toMatchObject({ cursor: null, phase: 'updates' });
    await harness.restart();
    harness.engine.api.retryDelivery({ ...owner, id: queued.id });
    await harness.engine.tick();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(keys).toEqual([queued.id, queued.id]);
    expect(auth).toEqual(['Bearer test-only-receiver-key', 'Bearer test-only-receiver-key']);
    expect(
      receiver.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM receipts').get()?.count,
    ).toBe(1);
    expect(harness.engine.api.status(owner).queue.pendingRecords).toBe(0);
  } finally {
    await harness.close();
    await server.stop(true);
    receiver.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the Markdown example rejects an incompatible whole deliverable before HTTP and permits deletes', async () => {
  const received: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      received.push(await request.text());
      return new Response(null, { status: 204 });
    },
  });
  try {
    const handler = createMarkdownWebhook({ endpoint: server.url.href });
    const delivery: Delivery = {
      version: 1,
      id: 'stable-delivery',
      ownerId: owner.ownerId,
      sourceId: 'source',
      installationId: 'installation',
      definition: githubPullRequests.definition,
      deliverable: {
        records: [
          {
            operation: 'upsert',
            kind: 'markdown',
            id: 'valid',
            data: { title: 'Title', body: 'Body' },
            eventId: 'event-1',
            revision: 1,
            contentHash: 'hash-1',
          },
          {
            operation: 'upsert',
            kind: 'other',
            id: 'invalid',
            data: { value: 1 },
            eventId: 'event-2',
            revision: 1,
            contentHash: 'hash-2',
          },
        ],
      },
    };
    expect(
      await handler.deliver({
        scope: owner,
        config: {},
        delivery,
        signal: new AbortController().signal,
      }),
    ).toEqual({
      status: 'rejected',
      code: 'invalid_markdown_record',
    });
    expect(received).toEqual([]);
    delivery.deliverable.records = [
      {
        operation: 'delete',
        kind: 'markdown',
        id: 'valid',
        eventId: 'event-3',
        revision: 2,
        contentHash: 'hash-3',
      },
    ];
    expect(
      await handler.deliver({
        scope: owner,
        config: {},
        delivery,
        signal: new AbortController().signal,
      }),
    ).toEqual({
      status: 'accepted',
    });
    expect(received).toHaveLength(1);
  } finally {
    await server.stop(true);
  }
});
