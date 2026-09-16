import { expect, test } from 'bun:test';
import type { JsonObject } from '@open-sync/core/json';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { githubFixture, pages } from './github-fixture';

// A collection must be complete before the example gives any progress to the engine.
test('hydrates all discussion pages and keeps authored headings inside quoted Markdown', async () => {
  const { fixture, context } = githubFixture();
  fixture.pull.body = '# Embedded heading\n\n```ts\nconst x = 1;\n```';
  const result = await pages(context);
  const record = result[0]!.deliverable.records[0]!;
  expect(record).toMatchObject({ operation: 'upsert', kind: 'pull-request', id: 'PR_native' });
  if (record.operation !== 'upsert') {
    throw new Error('Expected upsert');
  }
  expect(record.data.title).toBe('a/b #1: Complete PR');
  const body = String(record.data.body);
  for (const last of ['Comment 100', 'Review 50', 'Thread 50']) {
    expect(body).toContain(last);
  }
  expect(record.data.participants).toEqual([
    {
      identities: [{ namespace: 'github', id: 'U_1' }],
      roles: ['author', 'commenter', 'reviewer'],
      name: 'octocat',
    },
  ]);
  const tree = fromMarkdown(body);
  expect(tree.children.filter((node) => node.type === 'heading' && node.depth === 1)).toHaveLength(
    1,
  );
  expect(
    tree.children.some(
      (node) => node.type === 'blockquote' && node.children.some((child) => child.type === 'code'),
    ),
  ).toBe(true);
  expect(result.at(-1)).toMatchObject({
    complete: true,
    checkpoint: { accountId: 'U_1', cursor: null, phase: 'updates' },
  });
  expect(fixture.requests.some((item) => item.query.includes('commits('))).toBe(false);
});

test('accessible scope resumes within a repository, then advances to the next repository', async () => {
  const { fixture, context } = githubFixture();
  context.config = { scope: 'accessible' };
  const iterator = (await import('@open-sync/example-integrations/github')).githubPullRequests
    .load()
    .run(context)
    [Symbol.asyncIterator]();
  const first = await iterator.next();
  expect(first.value?.checkpoint).toMatchObject({
    repositoryId: 'R_native',
    repositoryCursor: 'repo-cursor',
    cursor: 'record-cursor',
  });
  await iterator.return?.(undefined);
  context.checkpoint = first.value!.checkpoint;
  const result = await pages(context);
  expect(result.flatMap((page) => page.deliverable.records)).toEqual([]);
  expect(result.at(-1)).toMatchObject({
    complete: true,
    checkpoint: { repositoryId: null, repositoryCursor: null },
  });
  expect(
    fixture.requests.filter((item) => item.query.includes('SyncRepositories')).at(-1)?.variables
      .after,
  ).toBe('repo-cursor');
});

test('ordinary updates honor the overlap; overdue reconciliation rehydrates old discussions', async () => {
  const { fixture, context } = githubFixture();
  const checkpoint = (await pages(context)).at(-1)!.checkpoint as JsonObject;
  context.checkpoint = {
    ...checkpoint,
    watermark: '2026-09-02T00:00:00Z',
    reconciledAt: new Date().toISOString(),
  };
  expect((await pages(context)).flatMap((page) => page.deliverable.records)).toEqual([]);
  context.checkpoint = {
    ...checkpoint,
    watermark: '2026-09-01T00:04:00Z',
    reconciledAt: new Date().toISOString(),
  };
  expect((await pages(context)).flatMap((page) => page.deliverable.records)).toHaveLength(1);
  context.checkpoint = {
    ...checkpoint,
    watermark: '2026-09-02T00:00:00Z',
    reconciledAt: '2020-01-01T00:00:00Z',
  };
  fixture.comments[0]!.body = 'An edit without a parent timestamp change';
  const record = (await pages(context))[0]!.deliverable.records[0]!;
  expect(record.operation === 'upsert' && String(record.data.body)).toContain(
    'An edit without a parent timestamp change',
  );
});

test('expired cursors restart backwards and account changes fail closed', async () => {
  const { fixture, context } = githubFixture();
  context.checkpoint = {
    ...(context.checkpoint as JsonObject),
    cursor: 'expired',
    accountId: 'U_1',
  };
  const reply = fixture.reply;
  fixture.reply = (input) =>
    input.query.includes('SyncDiscover')
      ? { errors: [{ type: 'INVALID_CURSOR_ARGUMENTS' }] }
      : reply(input);
  expect(await pages(context)).toMatchObject([
    {
      complete: false,
      deliverable: { records: [] },
      checkpoint: { cursor: null, accountId: 'U_1' },
    },
  ]);
  context.checkpoint = { ...(context.checkpoint as JsonObject), accountId: 'different-account' };
  await expect(pages(context)).rejects.toThrow('GitHub account changed');
});
