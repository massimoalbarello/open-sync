import type { Definition, Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import {
  type AssetOutcome,
  type AssetRendering,
  assetKey,
  assetPlaceholder,
  assetPlaceholderKey,
  type DeliveryAsset,
  resolveAssetReference,
} from './asset';
import type { DeliveredRecord } from './delivery';
import { fail } from './error';
import type { JsonValue } from './json';
import type { SyncRecord } from './record';

/** Optional destination transformation. Resolves exact JSON values and content Markdown links/images.
 * Does not mutate the input or change engine delivery identities.
 */
export function resolveRecordAssets(input: {
  record: DeliveredRecord;
  assets: readonly DeliveryAsset[];
  outcomes: ReadonlyMap<string, AssetOutcome>;
  rendering: AssetRendering;
}): DeliveredRecord {
  const { record } = input;
  if (record.operation !== 'upsert') {
    return structuredClone(record);
  }
  const assets = new Map(input.assets.map((asset) => [assetKey(asset), asset]));
  const transformed = transformRecord({
    record,
    resolve: ({ key, markdown }) => {
      const ref = resolveAssetReference({
        value: assetPlaceholder(key),
        assetRefs: record.assetRefs ?? {},
      })!;
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
  return { ...structuredClone(record), ...transformed };
}
function transformRecord(input: {
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
  const data = Object.fromEntries(
    Object.entries(input.record.data).map(([field, value]) => [field, walk(value)]),
  );
  return {
    data,
    ...(input.record.content
      ? {
          content: {
            ...input.record.content,
            body: transformMarkdown({ body: input.record.content.body, resolve: input.resolve }),
          },
        }
      : {}),
  };
}

function transformMarkdown(input: {
  body: string;
  resolve(input: { key: string; markdown: boolean }): { value: JsonValue; failed: boolean };
}): string {
  const tree = fromMarkdown(input.body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const definitions = markdownDefinitions(tree);
  let changed = false;
  const walk = (node: Nodes): Nodes => {
    // Expand reference links so a failed asset becomes visible at every use.
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const definition = definitions.get(node.identifier);
      if (definition && assetPlaceholderKey(definition.url) !== undefined) {
        node =
          node.type === 'imageReference'
            ? { type: 'image', url: definition.url, title: definition.title, alt: node.alt }
            : {
                type: 'link',
                url: definition.url,
                title: definition.title,
                children: node.children,
              };
      }
    }
    const resolved = resolveMarkdownNode({ node, resolve: input.resolve });
    changed ||= resolved.changed;
    node = resolved.node;
    if ('children' in node) {
      node.children = node.children
        .filter(
          (child) => child.type !== 'definition' || assetPlaceholderKey(child.url) === undefined,
        )
        .map(walk) as typeof node.children;
    }
    return node;
  };
  walk(tree);
  return changed ? toMarkdown(tree, { extensions: [gfmToMarkdown()] }) : input.body;
}

function markdownDefinitions(root: Nodes): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  const visit = (node: Nodes) => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
    if ('children' in node) {
      node.children.forEach(visit);
    }
  };
  visit(root);
  return definitions;
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
