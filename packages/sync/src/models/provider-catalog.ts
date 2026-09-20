import MiniSearch from 'minisearch';
import type { ProviderCatalogEntry } from './providers';

/** Provider metadata is fixed for the lifetime of a connector runtime. */
export class ProviderCatalog {
  private index?: MiniSearch;
  private byService?: Map<string, ProviderCatalogEntry>;
  readonly entries: ProviderCatalogEntry[];
  constructor(entries: ProviderCatalogEntry[]) {
    this.entries = entries.map(
      ({ service, displayName, iconUrl, categories, scenario, authTypes }) => ({
        service,
        displayName,
        iconUrl,
        categories,
        scenario,
        authTypes,
      }),
    );
  }

  page(input: { q?: string; offset?: number }) {
    const providers = this.entries;
    const query = input.q?.trim();
    let matches = providers;
    if (query) {
      if (!this.index) {
        this.index = new MiniSearch({
          idField: 'service',
          fields: ['service', 'displayName', 'categoryNames', 'scenario', 'authentication'],
          searchOptions: {
            prefix: true,
            combineWith: 'AND',
            boost: { displayName: 3, service: 2 },
          },
        });
        this.index.addAll(
          providers.map((provider) => ({
            ...provider,
            categoryNames: provider.categories.map((category) => category.displayName).join(' '),
            authentication: provider.authTypes.map((type) => type.replaceAll('_', ' ')).join(' '),
          })),
        );
      }
      this.byService ??= new Map(providers.map((provider) => [provider.service, provider]));
      matches = this.index.search(query).map((result) => this.byService!.get(result.id)!);
    }
    const pageSize = 30;
    const offset = input.offset ?? 0;
    return {
      providers: matches.slice(offset, offset + pageSize),
      total: matches.length,
      pageSize,
      hasMore: offset + pageSize < matches.length,
    };
  }
}
