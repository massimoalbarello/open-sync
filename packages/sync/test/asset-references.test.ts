import { expect, test } from 'bun:test';
import { assetPlaceholder, assetPlaceholderKey, resolveAssetReference } from '../src/models/asset';
import type { SyncDefinition, SyncStep } from '../src/models/definition';
import { defaultLimits } from '../src/models/limits';
import { preparePage } from '../src/models/page';
import { fixture } from './support';

test.each(['file', 'part_123-ABC', '__proto__', 'constructor'])(
  'asset reference helpers roundtrip %s through an own declaration',
  (key) => {
    const ref = { id: 'file', version: 'bytes-1' };
    const value = assetPlaceholder(key);
    expect(assetPlaceholderKey(value)).toBe(key);
    expect(resolveAssetReference({ value, assetRefs: { [key]: ref } })).toEqual(ref);
    expect(() => resolveAssetReference({ value, assetRefs: {} })).toThrow(
      'unknown asset reference',
    );
  },
);

test('reference helpers distinguish ordinary values from malformed protocol references', () => {
  for (const value of ['ordinary', 'https://example.com/file', 'a open-sync-asset:file']) {
    expect(assetPlaceholderKey(value)).toBeUndefined();
    expect(resolveAssetReference({ value, assetRefs: {} })).toBeUndefined();
  }
  for (const key of ['', 'a b', 'a/b', 'a.b']) {
    expect(() => assetPlaceholder(key)).toThrow('invalid asset placeholder');
    expect(() => assetPlaceholderKey(`open-sync-asset:${key}`)).toThrow(
      'invalid asset placeholder',
    );
  }
});

const record = {
  operation: 'upsert' as const,
  kind: 'item',
  id: 'one',
  data: {
    file: 'open-sync-asset:undeclared',
    body: '[literal](open-sync-asset:malformed/key)',
  },
  content: { format: 'markdown' as const, body: '[literal](open-sync-asset:undeclared)' },
  assetRefs: { attachment: { id: 'file', version: '1' } },
};
const page = { records: [record], checkpoint: 1, complete: true };
const definition: SyncDefinition = { ...fixture.definition, kinds: { item: { type: 'object' } } };

test('acquisition validates declarations without interpreting data/content or requiring placeholder usage', () => {
  expect(preparePage({ page, definition, limits: defaultLimits })).toEqual(page);
});

test.each([
  { assetRefs: null },
  { assetRefs: [] },
  { assetRefs: { 'invalid/key': { id: 'file', version: '1' } } },
  { assetRefs: { attachment: { id: 'file' } } },
  { assetRefs: { attachment: { id: 'file', version: '1', path: '/secret' } } },
])('invalid declared references reject the page: %j', ({ assetRefs }) => {
  expect(() =>
    preparePage({
      page: {
        ...page,
        records: [{ ...record, assetRefs }],
      } as unknown as SyncStep,
      definition,
      limits: defaultLimits,
    }),
  ).toThrow('invalid page');
});
