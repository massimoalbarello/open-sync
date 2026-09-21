import type { JsonValue } from '@context-use/open-sync/json';
import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';

const assetId = /^asset_[0-9a-f-]{36}$/;
const downloadPrefix = '/api/receiver/assets/';

function markdownTargets(body: string): string[] {
  const targets: string[] = [];
  const definitions = new Map<string, string>();
  const references = new Set<string>();
  const walk = (node: Nodes) => {
    switch (node.type) {
      case 'link':
      case 'image':
        targets.push(node.url);
        break;
      case 'definition':
        if (!definitions.has(node.identifier)) {
          definitions.set(node.identifier, node.url);
        }
        break;
      case 'linkReference':
      case 'imageReference':
        references.add(node.identifier);
        break;
    }
    if ('children' in node) {
      node.children.forEach(walk);
    }
  };
  walk(fromMarkdown(body));
  for (const reference of references) {
    const url = definitions.get(reference);
    if (url) {
      targets.push(url);
    }
  }
  return targets;
}

/** Recognize this receiver's stored IDs and Markdown download targets, never filenames. */
export function referencedAssetIds(data: JsonValue): Set<string> {
  const ids = new Set<string>();
  const target = (url: string) => {
    const id = url.startsWith(downloadPrefix) ? url.slice(downloadPrefix.length) : '';
    if (assetId.test(id)) {
      ids.add(id);
    }
  };
  const visit = (value: JsonValue): void => {
    if (typeof value === 'string') {
      if (assetId.test(value)) {
        ids.add(value);
      } else if (value.includes(downloadPrefix)) {
        target(value);
        markdownTargets(value).forEach(target);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(data);
  return ids;
}
