import { expect, test } from 'bun:test';
import {
  assetKey,
  assetPlaceholder,
  assetPlaceholderKey,
  resolveAssetReference,
} from '../src/models/asset';
import { resolveRecordAssets } from '../src/models/asset-references';
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

test('optional destination resolution requires explicit declarations, descriptors and outcomes', () => {
  const ref = record.assetRefs.attachment;
  const input = {
    record: {
      ...record,

      revision: 1,
      data: { file: assetPlaceholder('attachment') },
      content: undefined,
    },
    assets: [{ ...ref, name: 'file', mediaType: 'text/plain', size: 1, sha256: 'hash' }],
    outcomes: new Map([
      [assetKey(ref), { status: 'accepted' as const, reference: 'destination-id' }],
    ]),
    rendering: {
      structured: () => 'destination-id',
      markdown: () => 'https://example.com/file',
    },
  };
  const original = structuredClone(input.record);
  expect(resolveRecordAssets(input)).toMatchObject({ data: { file: 'destination-id' } });
  expect(input.record).toEqual(original);
  expect(() => resolveRecordAssets({ ...input, outcomes: new Map() })).toThrow('unresolved asset');
  expect(() => resolveRecordAssets({ ...input, assets: [] })).toThrow('unresolved asset');
  expect(() =>
    resolveRecordAssets({ ...input, record: { ...input.record, assetRefs: {} } }),
  ).toThrow('unknown asset reference');
  expect(() =>
    resolveRecordAssets({ ...input, record: { ...input.record, assetRefs: undefined } }),
  ).toThrow('unknown asset reference');
});

const rendering: import('../src/models/asset').AssetRendering = {
  structured: ({ outcome }) =>
    outcome.status === 'accepted' ? outcome.reference : { status: 'failed', code: outcome.code },
  markdown: ({ outcome }) =>
    outcome.status === 'accepted'
      ? `https://destination.example/files/${outcome.reference}`
      : 'Attachment unavailable',
};

test('placeholder protocol resolves repeated and distinct assets while preserving literal code and link formatting', () => {
  const refs = { a: { id: 'first', version: '1' }, b: { id: 'second', version: '1' } };
  const record = {
    operation: 'upsert' as const,
    kind: 'note',
    id: '1',

    revision: 1,

    assetRefs: refs,
    content: {
      format: 'markdown' as const,
      body: '| File | Status |\n| --- | --- |\n| [first](open-sync-asset:a) | ~~pending~~ |\n\n- [x] Read the file',
    },
    data: {
      files: ['open-sync-asset:b', 'open-sync-asset:a', 'open-sync-asset:a'],
      body: '[first][ref] ![second](open-sync-asset:b) `open-sync-asset:a`\n\n[ref]: open-sync-asset:a',
    },
  };
  const resolved = resolveRecordAssets({
    record,
    assets: Object.values(refs).map((ref) => ({
      ...ref,
      name: ref.id,
      mediaType: 'text/plain',
      size: 1,
      sha256: 'hash',
    })),
    outcomes: new Map([
      [assetKey(refs.a), { status: 'accepted', reference: 'A' }],
      [assetKey(refs.b), { status: 'accepted', reference: 'B' }],
    ]),
    rendering,
  });
  expect(resolved).toMatchObject({ revision: 1, data: { files: ['B', 'A', 'A'] } });
  expect(resolved.operation === 'upsert' && resolved.data.body).toContain('`open-sync-asset:a`');
  expect(resolved.operation === 'upsert' && resolved.content?.body).toMatch(/^\| File\s+\|/m);
  expect(resolved.operation === 'upsert' && resolved.content?.body).toContain(
    '[first](https://destination.example/files/A)',
  );
  expect(resolved.operation === 'upsert' && resolved.content?.body).toContain('~~pending~~');
  expect(resolved.operation === 'upsert' && resolved.content?.body).toContain(
    '* [x] Read the file',
  );
  expect(resolved.operation === 'upsert' && resolved.data.body).toBe(record.data.body);
  expect(record.data.files).toEqual([
    'open-sync-asset:b',
    'open-sync-asset:a',
    'open-sync-asset:a',
  ]);
});

test.each([
  '[file][ref]\n\n> [ref]: open-sync-asset:a',
  '[file][ref]\n\n- [ref]: open-sync-asset:a',
  '[file][ref]\n\n[ref]: open-sync-asset:a\n[ref]: https://wrong.example/file',
])(
  'Markdown asset references follow nested definitions and first-definition precedence: %s',
  (body) => {
    const ref = { id: 'first', version: '1' };
    const record = {
      operation: 'upsert' as const,
      kind: 'note',
      id: '1',

      revision: 1,

      assetRefs: { a: ref },
      data: {},
      content: { format: 'markdown' as const, body },
    };
    for (const outcome of [
      { status: 'accepted' as const, reference: 'A' },
      { status: 'failed' as const, code: 'unavailable' },
    ]) {
      const resolved = resolveRecordAssets({
        record,
        assets: [{ ...ref, name: 'file', mediaType: 'text/plain', size: 1, sha256: 'hash' }],
        outcomes: new Map([[assetKey(ref), outcome]]),
        rendering,
      });
      expect(resolved.operation === 'upsert' && resolved.content?.body).toContain(
        outcome.status === 'accepted'
          ? '[file](https://destination.example/files/A)'
          : 'Attachment unavailable',
      );
      expect(resolved.operation === 'upsert' && resolved.content?.body).not.toContain(
        'open-sync-asset:',
      );
    }
  },
);
