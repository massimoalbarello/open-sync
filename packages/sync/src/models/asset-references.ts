import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import {
  type AssetOutcome,
  type AssetRendering,
  assetKey,
  assetPlaceholder,
  assetPlaceholderKey,
  type DeliveryAsset,
} from './asset';
import type { DeliveredRecord, SyncRecord } from './delivery';
import { fail } from './error';
import type { JsonValue } from './json';
import { identifier } from './validation';

/** Only exact JSON values and Markdown link/image targets are protocol references. */
export function validateAssetReferences(record: SyncRecord): void {
  if (record.operation !== 'upsert') {
    return;
  }
  const refs = record.assetRefs ?? {};
  if (!refs || Array.isArray(refs) || typeof refs !== 'object') {
    fail('invalid_asset_references');
  }
  for (const [key, ref] of Object.entries(refs)) {
    assetPlaceholder(key);
    identifier(ref.id);
    identifier(ref.version);
    if (Object.keys(ref).some((field) => !['id', 'version'].includes(field))) {
      fail('invalid_asset_reference');
    }
  }
  const fields = record.markdownFields ?? [];
  if (!Array.isArray(fields) || new Set(fields).size !== fields.length) {
    fail('invalid_markdown_fields');
  }
  for (const field of fields) {
    if (!Object.hasOwn(record.data, field) || typeof record.data[field] !== 'string') {
      fail('invalid_markdown_field');
    }
  }
  const used = new Set<string>();
  transformData({
    record,
    resolve: ({ key }) => {
      if (!Object.hasOwn(refs, key)) {
        fail('unknown_asset_reference');
      }
      used.add(key);
      return { value: assetPlaceholder(key), failed: false };
    },
  });
  if (Object.keys(refs).some((key) => !used.has(key))) {
    fail('unused_asset_reference');
  }
}
export function resolveRecordAssets(input: {
  record: DeliveredRecord;
  assets: readonly DeliveryAsset[];
  outcomes: ReadonlyMap<string, AssetOutcome>;
  rendering: AssetRendering;
}): DeliveredRecord {
  const { record } = input;
  if (record.operation !== 'upsert' || !record.assetRefs) {
    return structuredClone(record);
  }
  const assets = new Map(input.assets.map((asset) => [assetKey(asset), asset]));
  const data = transformData({
    record,
    resolve: ({ key, markdown }) => {
      const ref = record.assetRefs![key];
      if (!ref) {
        return fail('unknown_asset_reference');
      }
      const asset = assets.get(assetKey(ref));
      const outcome = input.outcomes.get(assetKey(ref));
      if (!asset || !outcome) {
        return fail('unresolved_asset');
      }
      const value = markdown
        ? input.rendering.markdown({ asset, outcome })
        : input.rendering.structured({ asset, outcome });
      return { value, failed: outcome.status === 'failed' };
    },
  });
  return { ...structuredClone(record), data };
}
function transformData(input: {
  record: Extract<SyncRecord, { operation: 'upsert' }>;
  resolve(input: { key: string; markdown: boolean }): { value: JsonValue; failed: boolean };
}) {
  const walk = (value: JsonValue): JsonValue => {
    if (typeof value === 'string') {
      const key = assetPlaceholderKey(value);
      return key === undefined ? value : input.resolve({ key, markdown: false }).value;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    return value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]))
      : value;
  };
  return Object.fromEntries(
    Object.entries(input.record.data).map(([field, value]) => [
      field,
      input.record.markdownFields?.includes(field)
        ? transformMarkdown({ body: value as string, resolve: input.resolve })
        : walk(value),
    ]),
  );
}
function transformMarkdown(input: {
  body: string;
  resolve(input: { key: string; markdown: boolean }): { value: JsonValue; failed: boolean };
}): string {
  const tree = fromMarkdown(input.body);
  let changed = false;
  const walk = (node: Nodes): Nodes => {
    const resolved = resolveMarkdownNode({ node, resolve: input.resolve });
    changed ||= resolved.changed;
    node = resolved.node;
    if ('children' in node) {
      node.children = node.children.map(walk) as typeof node.children;
    }
    return node;
  };
  // Expand reference-style links before resolving so failure becomes visible at every use.
  const definitions = new Map(
    tree.children
      .filter((node) => node.type === 'definition')
      .map((node) => [node.identifier, node]),
  );
  const expand = (node: Nodes): Nodes => {
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const definition = definitions.get(node.identifier);
      if (definition && assetPlaceholderKey(definition.url) !== undefined) {
        return node.type === 'imageReference'
          ? { type: 'image', url: definition.url, title: definition.title, alt: node.alt }
          : { type: 'link', url: definition.url, title: definition.title, children: node.children };
      }
    }
    if ('children' in node) {
      node.children = node.children.map(expand) as typeof node.children;
    }
    return node;
  };
  expand(tree);
  tree.children = tree.children.filter(
    (node) => node.type !== 'definition' || assetPlaceholderKey(node.url) === undefined,
  );
  walk(tree);
  return changed ? toMarkdown(tree) : input.body;
}

function resolveMarkdownNode(input: {
  node: Nodes;
  resolve(input: { key: string; markdown: boolean }): { value: JsonValue; failed: boolean };
}): { node: Nodes; changed: boolean } {
  const { node } = input;
  if (node.type !== 'link' && node.type !== 'image') {
    return { node, changed: false };
  }
  const key = assetPlaceholderKey(node.url);
  if (key === undefined) {
    return { node, changed: false };
  }
  const result = input.resolve({ key, markdown: true });
  if (typeof result.value !== 'string') {
    return fail('invalid_markdown_reference');
  }
  if (result.failed) {
    return { node: { type: 'text', value: result.value }, changed: true };
  }
  return { node: { ...node, url: result.value }, changed: result.value !== node.url };
}
