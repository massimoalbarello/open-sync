import { expect, spyOn, test } from 'bun:test';
import type { ProviderResponse, SyncContext } from '@context-use/open-sync/definition';
import { checkResponse } from '../src/syncs/github/http';
import { ExpiredCursor, request as slackRequest, ThreadNotFound } from '../src/syncs/slack/request';
import { unused } from './fixture';

const ok = 200;
const forbidden = 403;
const rateLimited = 429;

test('GitHub maps GraphQL and HTTP quota errors without converting permission failures into rate limits', () => {
  const headers = { 'retry-after': '120', authorization: 'private-secret' };
  const responses: ProviderResponse[] = [
    { status: forbidden, headers, body: {} },
    {
      status: ok,
      headers,
      body: {
        data: { partial: true },
        errors: [{ type: 'RATE_LIMITED', message: 'private-secret' }],
      },
    },
  ];
  for (const response of responses) {
    try {
      checkResponse(response);
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toMatchObject({ status: rateLimited, retryAfterMs: 120_000 });
      expect(JSON.stringify(error)).not.toContain('private-secret');
    }
  }
  try {
    checkResponse({ status: forbidden, headers: {}, body: { message: 'Denied' } });
    throw new Error('Expected permission failure');
  } catch (error) {
    expect(error).toMatchObject({ status: forbidden });
  }
  expect(() =>
    checkResponse({ status: ok, headers: { 'x-ratelimit-remaining': '0' }, body: { data: {} } }),
  ).not.toThrow();
});

test('GitHub honors primary resets on HTTP-200 errors and supplies its secondary-limit minimum', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const cooldown = 180_000;
  const millisecondsPerSecond = 1000;
  const clock = spyOn(Date, 'now').mockReturnValue(now);
  try {
    const responses: ProviderResponse[] = [
      {
        status: ok,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String((now + cooldown) / millisecondsPerSecond),
        },
        body: { errors: [{ message: 'Limit exceeded' }] },
      },
      { status: ok, headers: {}, body: { errors: [{ type: 'RATE_LIMITED' }] } },
      { status: rateLimited, headers: {}, body: {} },
    ];
    for (const response of responses) {
      try {
        checkResponse(response);
        throw new Error('Expected rate limit');
      } catch (error) {
        const secondaryMinimum = 60_000;
        expect(error).toMatchObject({
          status: rateLimited,
          retryAfterMs: response.headers['x-ratelimit-reset'] ? cooldown : secondaryMinimum,
        });
      }
    }
  } finally {
    clock.mockRestore();
  }
});

test.each([
  { error: 'ratelimited', status: 429 },
  { error: 'rate_limited', status: 429 },
  { error: 'invalid_auth', status: 401 },
  { error: 'missing_scope', status: 403 },
  { error: 'internal_error', status: 503 },
])('Slack maps $error into HTTP $status', async ({ error, status }) => {
  await expect(
    slackRequest({ context: slackContext({ ok: false, error }), path: '/auth.test' }),
  ).rejects.toMatchObject({ status, retryAfterMs: 120_000 });
});

test('Slack keeps cursor and missing-thread recovery with the source', async () => {
  await expect(
    slackRequest({
      context: slackContext({ ok: false, error: 'invalid_cursor' }),
      path: '/conversations.history',
    }),
  ).rejects.toBeInstanceOf(ExpiredCursor);
  await expect(
    slackRequest({
      context: slackContext({ ok: false, error: 'thread_not_found' }),
      path: '/conversations.replies',
    }),
  ).rejects.toBeInstanceOf(ThreadNotFound);
});

function slackContext(body: { ok: boolean; error: string }): SyncContext {
  return {
    config: {},
    checkpoint: null,
    sourceId: 'source',
    signal: new AbortController().signal,
    log: () => undefined,
    assets: {
      capture: unused,
      unavailable: () => {
        throw new Error('Unexpected asset operation');
      },
    },
    provider: {
      action: unused,
      post: unused,
      get: () => Promise.resolve({ status: ok, headers: { 'retry-after': '120' }, body }),
    },
  };
}
