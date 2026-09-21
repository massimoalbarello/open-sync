import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';
import { syncOptions } from '../../queries/sync';
import { statusLabel } from './-syncs/status-label';
import { SyncAccount } from './-syncs/sync-account';

export const Route = createFileRoute('/_workspace/syncs/')({ component: Syncs });
function Syncs() {
  const { userId } = Route.useRouteContext();
  const query = useQuery(syncOptions(userId));
  const catalog = useQuery(catalogOptions(userId));
  return (
    <SectionPage
      title="Syncs"
      action={
        <Link
          to="/syncs/new"
          className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
        >
          Create sync
        </Link>
      }
    >
      {(query.error || catalog.error) && (
        <p role="alert">{(query.error || catalog.error)?.message}</p>
      )}
      {query.isPending && <p>Loading syncs…</p>}
      {query.data?.installations.length === 0 && (
        <p>No syncs yet. Create one from an available source and destination.</p>
      )}
      <ul className="divide-y divide-border">
        {query.data?.installations.map((sync) => {
          const source = catalog.data?.sources.find(
            (entry) => entry.id === sync.definition.id && entry.version === sync.definition.version,
          );
          const destination = catalog.data?.destinations.find(
            (entry) => entry.id === sync.destinationId,
          );
          const type = catalog.data?.types.find((entry) => entry.type === destination?.type);
          return (
            <li key={sync.id}>
              <Link
                to="/syncs/$id"
                params={{ id: sync.id }}
                className="block space-y-2 py-5 hover:text-muted-foreground"
              >
                <p className="font-medium">
                  {source?.name ?? sync.definition.id} →{' '}
                  {type?.name ?? destination?.type ?? 'Unavailable destination'}
                </p>
                <SyncAccount connection={sync.connection} connections={query.data?.connections} />
                <p className="text-muted-foreground text-sm">
                  {source?.provider && !sync.connection
                    ? 'Waiting for authorization'
                    : statusLabel(sync.status)}{' '}
                  ·{' '}
                  {sync.enabled
                    ? `Next poll ${new Date(sync.nextDueAt).toLocaleString()}`
                    : 'Paused'}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </SectionPage>
  );
}
