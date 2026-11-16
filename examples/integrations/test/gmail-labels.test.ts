import { expect, test } from 'bun:test';
import type { JsonObject } from '@context-use/open-sync/json';
import { owner } from './fixture';
import { email } from './gmail-fixture';
import { labelFixture, labelIds, labelledMessage, labelNames } from './gmail-label-fixture';

test('Gmail backfills the native label union across pages and restarts without duplicate changes', async () => {
  const f = await labelFixture({
    threads: {
      clients: [labelledMessage({ id: 'clients' })],
      both: [labelledMessage({ id: 'both', labels: labelIds })],
      research: [labelledMessage({ id: 'research', labels: [labelIds[1]!] })],
      unrelated: [labelledMessage({ id: 'unrelated', labels: [] })],
    },
  });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toMatchObject({ labelIndex: 0, pageToken: '1', historyId: '100' });
    await f.restart();
    await f.engine.tick();
    expect(f.saved.checkpoint).toMatchObject({ labelIndex: 1, pageToken: null, historyId: '100' });
    await f.restart();
    await f.finish();
    expect(f.saved.checkpoint).toMatchObject({ query: null, pageToken: null, historyId: '100' });
    expect(f.saved.checkpoint).not.toHaveProperty('labelIndex');
    expect(f.records.map((record) => record.id)).toEqual(['clients', 'both', 'research']);
    expect(
      f.requests.filter((request) => request.path.endsWith('/threads')).map((r) => r.query),
    ).toEqual([
      { maxResults: 1, q: expect.any(String), labelIds: [labelIds[0]] },
      { maxResults: 1, q: expect.any(String), labelIds: [labelIds[0]], pageToken: '1' },
      { maxResults: 1, q: expect.any(String), labelIds: [labelIds[1]] },
      { maxResults: 1, q: expect.any(String), labelIds: [labelIds[1]], pageToken: '1' },
    ]);
    expect(f.downloads).not.toContain('unrelated-root');

    const listings = f.requests.filter((request) => request.path.endsWith('/threads')).length;
    f.queue();
    await f.finish();
    expect(f.requests.filter((request) => request.path.endsWith('/threads'))).toHaveLength(
      listings,
    );
    expect(f.records.map((record) => record.id)).toEqual(['clients', 'both', 'research']);

    f.engine.api.resync({ ...owner, id: f.saved.id });
    await f.finish();
    expect([...new Set(f.records.map((record) => record.id))].sort()).toEqual([
      'both',
      'clients',
      'research',
    ]);
  } finally {
    await f.close();
  }
});

test('Gmail mailbox history imports old labelled threads and unlabelled replies, preserving removed copies', async () => {
  const threads = {
    conversation: [labelledMessage({ id: 'conversation' })],
    old: [labelledMessage({ id: 'old', labels: [], date: '2020-01-01T00:00:00.000Z' })],
    unrelated: [labelledMessage({ id: 'unrelated', labels: [] })],
  };
  const f = await labelFixture({ threads });
  try {
    await f.finish();
    const listings = f.requests.filter((request) => request.path.endsWith('/threads')).length;
    threads.conversation.push(
      email({
        id: 'reply',
        threadId: 'conversation',
        labels: [],
        parts: [{ partId: 'file', filename: 'reply.txt', body: { attachmentId: 'reply' } }],
      }),
    );
    threads.old[0]!.labelIds = [labelIds[1]!];
    f.changes.ids = ['conversation', 'old', 'unrelated', 'conversation'];
    f.changes.historyId = '200';
    f.queue();
    await f.finish();
    expect(f.records.map((record) => [record.id, record.revision])).toEqual([
      ['conversation', 1],
      ['conversation', 2],
      ['old', 1],
    ]);
    expect(f.records[1]).toMatchObject({
      data: { messages: [{ id: 'conversation-root' }, { id: 'reply', labels: [] }] },
    });
    expect(f.downloads).toEqual(['conversation-root', 'conversation-root', 'reply', 'old-root']);
    expect(
      f.requests.some(
        (request) =>
          request.path.endsWith('/threads/unrelated') && request.query?.format === 'full',
      ),
    ).toBe(false);

    const deliveredBeforeRemoval = f.records.length;
    const capturedBeforeRemoval = f.downloads.length;
    threads.conversation[0]!.labelIds = [];
    f.changes.historyId = '300';
    f.changes.ids = ['conversation'];
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(deliveredBeforeRemoval);
    expect(f.downloads).toHaveLength(capturedBeforeRemoval);
    expect(f.saved.checkpoint.historyId).toBe('300');
    expect(f.requests.filter((request) => request.path.endsWith('/threads'))).toHaveLength(
      listings,
    );
    for (const request of f.requests.filter((request) => request.path.endsWith('/history'))) {
      expect(request.query).not.toHaveProperty('labelId');
      expect(request.query).not.toHaveProperty('historyTypes');
    }
  } finally {
    await f.close();
  }
});

test('Gmail attachment failure preserves the label cursor and retries only its native page after restart', async () => {
  const f = await labelFixture({
    threads: { research: [labelledMessage({ id: 'research', labels: [labelIds[1]] })] },
  });
  try {
    await f.engine.tick();
    const checkpoint = f.saved.checkpoint;
    expect(checkpoint).toMatchObject({ labelIndex: 1, pageToken: null, historyId: '100' });
    f.failedDownloads.add('research-root');
    await f.engine.tick();
    expect(f.saved).toMatchObject({ checkpoint, errorCode: 'source_http_503' });
    expect(f.records).toHaveLength(0);
    expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
    await f.restart();
    f.failedDownloads.clear();
    f.queue();
    await f.finish();
    expect(f.records.map((record) => record.id)).toEqual(['research']);
    expect(
      f.requests.filter(
        (request) =>
          request.path.endsWith('/threads') &&
          (request.query?.labelIds as string[] | undefined)?.[0] === labelIds[0],
      ),
    ).toHaveLength(1);
    expect(f.downloads).toEqual(['research-root', 'research-root']);
  } finally {
    await f.close();
  }
});

const unfilteredConfigs: JsonObject[] = [{}, { labels: [] }];
test.each(unfilteredConfigs)(
  'Gmail omitted or empty label filters preserve unfiltered discovery: %j',
  async (config) => {
    const f = await labelFixture({
      config,
      threads: { unlabelled: [labelledMessage({ id: 'unlabelled', labels: [] })] },
    });
    try {
      await f.finish();
      expect(f.records.map((record) => record.id)).toEqual(['unlabelled']);
      expect(f.requests.some((request) => request.path.endsWith('/labels'))).toBe(false);
      expect(f.requests.some((request) => request.query?.format === 'minimal')).toBe(false);
      expect(
        f.requests.find((request) => request.path.endsWith('/threads'))!.query,
      ).not.toHaveProperty('labelIds');
    } finally {
      await f.close();
    }
  },
);

test('Gmail refuses unknown label names without falling back to unfiltered discovery', async () => {
  const f = await labelFixture({ config: { labels: ['missing'] }, threads: {} });
  try {
    const checkpoint = f.saved.checkpoint;
    await f.engine.tick();
    expect(f.saved).toMatchObject({ errorCode: 'execution_failed', checkpoint });
    expect(f.requests.filter((request) => request.path.endsWith('/threads'))).toHaveLength(0);
    expect(f.records).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test('Gmail repeated configured label names do not repeat a backfill', async () => {
  const f = await labelFixture({
    config: { labels: [labelNames[0]!, labelNames[0]!] },
    threads: { thread: [labelledMessage({ id: 'thread' })] },
  });
  try {
    await f.finish();
    expect(f.requests.filter((request) => request.path.endsWith('/threads'))).toHaveLength(1);
    expect(f.records).toHaveLength(1);
  } finally {
    await f.close();
  }
});
