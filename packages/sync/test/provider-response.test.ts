import { expect, test } from 'bun:test';
import { providerResponse } from '../src/connector/response';

test('provider responses preserve HTTP failures and payloads without leaking the wire envelope', () => {
  for (const data of [{ items: [1] }, 'provider text', null]) {
    expect(
      providerResponse({
        status: 429,
        headers: { 'retry-after': '60' },
        data,
        upstreamExtra: true,
      }),
    ).toEqual({ status: 429, headers: { 'retry-after': '60' }, body: data });
  }
});

test('malformed envelopes and encoded binary responses fail at the adapter boundary', () => {
  for (const value of [
    null,
    [],
    { status: 200, headers: {} },
    { status: '200', headers: {}, data: null },
    { status: 99, headers: {}, data: null },
    { status: 600, headers: {}, data: null },
    { status: 200.5, headers: {}, data: null },
    { status: 200, data: null },
    { status: 200, headers: [], data: null },
    { status: 200, headers: { authorization: 123 }, data: null },
  ]) {
    expect(() => providerResponse(value)).toThrow('invalid provider response');
  }
  expect(() =>
    providerResponse({ status: 200, headers: {}, bodyEncoding: 'base64', data: 'YQ==' }),
  ).toThrow('unsupported provider response');
});
