import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, Search } from 'lucide-react';
import { InfiniteScroll } from '../../components/infinite-scroll';
import { SectionPage } from '../../components/section-page';
import { providerOptions } from '../../queries/providers';
import { authLabels } from './-providers/auth-label';
import { ProviderIcon } from './-providers/provider-icon';

const maxSearchLength = 200;

export const Route = createFileRoute('/_workspace/providers/')({
  component: Providers,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q.slice(0, maxSearchLength) : '',
  }),
});
function Providers() {
  const { userId } = Route.useRouteContext();
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useInfiniteQuery(providerOptions({ userId, q }));
  const providers = query.data?.pages.flatMap((page) => page.providers) ?? [];
  return (
    <SectionPage title="Providers">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-medium text-lg">Connect your accounts</h2>
          <p className="mt-1 text-muted-foreground text-sm">Choose a provider to get started.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search
            aria-hidden="true"
            className="absolute top-3 left-3 size-4 text-muted-foreground"
          />
          <Input
            aria-label="Search providers"
            placeholder="Search providers"
            value={q}
            onChange={(event) =>
              void navigate({ search: { q: event.target.value }, replace: true })
            }
            className="h-10 pl-9"
          />
        </div>
      </div>
      {query.isPending && <p className="text-muted-foreground text-sm">Loading providers…</p>}
      {query.error && (
        <div role="alert" className="mb-6 space-y-3">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {query.data && !providers.length && (
        <p className="text-muted-foreground text-sm">No providers match your search.</p>
      )}
      <ul
        aria-label="Providers"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      >
        {providers.map((provider) => (
          <li key={provider.service}>
            <Link
              to="/providers/$service"
              params={{ service: provider.service }}
              className="group flex h-full items-center gap-4 rounded-xl border border-border p-5 transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ProviderIcon name={provider.displayName} url={provider.iconUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{provider.displayName}</p>
                <p className="mt-1 text-muted-foreground text-sm">
                  {provider.authTypes.map((type) => authLabels[type]).join(' · ')}
                </p>
              </div>
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>
      <InfiniteScroll
        hasMore={query.hasNextPage}
        fetching={query.isFetching}
        error={query.error}
        onLoad={() => void query.fetchNextPage()}
      />
    </SectionPage>
  );
}
