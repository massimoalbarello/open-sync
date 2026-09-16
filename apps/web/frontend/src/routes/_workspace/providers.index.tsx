import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { SectionPage } from '../../components/section-page';
import { providerOptions } from '../../queries/providers';
import { authLabels } from './-providers/auth-label';
import { ProviderIcon } from './-providers/provider-icon';
import { providerSearch } from './-providers/search';

export const Route = createFileRoute('/_workspace/providers/')({
  component: Providers,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
  }),
});

function Providers() {
  const { userId } = Route.useRouteContext();
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useQuery(providerOptions(userId));
  const search = useMemo(() => providerSearch(query.data ?? []), [query.data]);
  const providers = search(q);
  return (
    <SectionPage
      title="Providers"
      action={
        <Input
          aria-label="Search providers"
          placeholder="Search providers"
          value={q}
          onChange={(event) => void navigate({ search: { q: event.target.value }, replace: true })}
          className="w-full sm:w-72"
        />
      }
    >
      <p className="mb-6 text-muted-foreground text-sm">
        {query.data
          ? `${providers.length} of ${query.data.length} providers`
          : 'Choose a provider to connect your account.'}
      </p>
      {query.isPending && <p className="text-muted-foreground text-sm">Loading providers…</p>}
      {query.error && (
        <div role="alert" className="space-y-3">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {query.data && providers.length === 0 && (
        <p className="text-muted-foreground text-sm">No providers match your search.</p>
      )}
      <ul className="divide-y divide-border">
        {providers.map((provider) => (
          <li key={provider.service}>
            <Link
              to="/providers/$service"
              search={{ authorization: undefined }}
              params={{ service: provider.service }}
              className="flex items-center gap-4 rounded-lg px-2 py-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ProviderIcon
                key={provider.iconUrl}
                name={provider.displayName}
                url={provider.iconUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{provider.displayName}</p>
                <p className="text-muted-foreground text-sm">
                  {provider.authTypes.map((type) => authLabels[type]).join(' · ')}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionPage>
  );
}
