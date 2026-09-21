import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, Download } from 'lucide-react';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';
import { providerSetupOptions } from '../../queries/providers';

export const Route = createFileRoute('/_workspace/sources')({ component: Sources });
function Sources() {
  const { userId } = Route.useRouteContext();
  const query = useQuery(catalogOptions(userId));
  return (
    <SectionPage title="Sources">
      {query.isPending && <p>Loading sources…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      <ul className="divide-y divide-border">
        {query.data?.sources.map((source) => (
          <li
            key={`${source.id}/${source.version}`}
            className="flex flex-wrap items-center gap-5 py-6 first:pt-0"
          >
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Download aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <h2 className="font-medium">{source.name ?? source.id}</h2>
              {source.provider ? (
                <SourceAction
                  source={source.id}
                  service={source.provider.service}
                  userId={userId}
                />
              ) : (
                <CreateSyncLink source={source.id} />
              )}
            </div>
          </li>
        ))}
      </ul>
      {query.data?.sources.length === 0 && <p>No sources configured.</p>}
    </SectionPage>
  );
}

function SourceAction(input: { source: string; service: string; userId: string }) {
  const query = useQuery(providerSetupOptions(input));
  if (query.isPending) {
    return <p className="text-muted-foreground text-sm">Checking provider…</p>;
  }
  if (query.error) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{query.error.message}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const ready =
    query.data?.setup.oauthClient?.configured ||
    query.data?.setup.oauthClient?.automaticRegistration ||
    query.data?.connections.some(
      (account) => account.status === 'active' && account.authType === 'oauth2',
    );
  return ready ? (
    <CreateSyncLink source={input.source} />
  ) : (
    <Link
      to="/providers/$service"
      params={{ service: input.service }}
      className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
    >
      Configure provider <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

function CreateSyncLink(input: { source: string }) {
  return (
    <Link
      to="/syncs/new"
      search={{ source: input.source }}
      className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
    >
      Create sync <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}
