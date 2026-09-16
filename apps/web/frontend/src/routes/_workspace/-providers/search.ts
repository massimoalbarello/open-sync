import MiniSearch from 'minisearch';
import type { ProviderCatalogEntry } from '../../../queries/providers';
import { authLabels } from './auth-label';

/** A disposable view of Connector's catalog, rebuilt when the query cache receives new metadata. */
export function providerSearch(providers: ProviderCatalogEntry[]) {
  const byService = new Map(providers.map((provider) => [provider.service, provider]));
  const index = new MiniSearch({
    idField: 'service',
    fields: ['service', 'displayName', 'categoryNames', 'scenario', 'authentication'],
    searchOptions: { prefix: true, combineWith: 'AND', boost: { displayName: 3, service: 2 } },
  });
  index.addAll(
    providers.map((provider) => ({
      ...provider,
      categoryNames: provider.categories.map((category) => category.displayName).join(' '),
      authentication: provider.authTypes.map((type) => authLabels[type]).join(' '),
    })),
  );
  return (query: string): ProviderCatalogEntry[] =>
    query.trim() ? index.search(query).map((result) => byService.get(result.id)!) : providers;
}
