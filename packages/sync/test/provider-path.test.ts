import { expect, test } from 'bun:test';
import { matchesProviderPath } from '../src/models/provider-path';

test('provider path parameters cannot widen a declared download route', () => {
  const allowed = ['/users/me/messages/:messageId/attachments/:attachmentId'];
  expect(matchesProviderPath({ allowed, path: '/users/me/messages/m1/attachments/a2' })).toBe(true);
  for (const path of [
    '/users/me/messages/m1/delete',
    '/users/me/messages/../attachments/a2',
    '/users/me/messages/%2e%2e/attachments/a2',
    '/users/me/messages/%252e%252e/attachments/a2',
    '/users/me/messages/m1%2Fdelete/attachments/a2',
    '//other.example/users/me/messages/m1/attachments/a2',
  ]) {
    expect(matchesProviderPath({ allowed, path })).toBe(false);
  }
});
