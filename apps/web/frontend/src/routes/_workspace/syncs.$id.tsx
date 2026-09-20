import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';
import { runSync, setEnabled, syncDetailOptions, syncKeys } from '../../queries/sync';

import { PollingHistory } from './-syncs/polling-history';

const millisecondsPerMinute = 60_000;
type Section = 'overview' | 'history';
const maxOffset = 1_000_000;
export const Route = createFileRoute('/_workspace/syncs/$id')({
  component: SyncDetail,
  validateSearch: (search: Record<string, unknown>): { section?: Section; offset?: number } => ({
    section: search.section === 'history' ? search.section : 'overview',
    offset:
      Number.isSafeInteger(Number(search.offset)) && Number(search.offset) > 0
        ? Math.min(maxOffset, Number(search.offset))
        : 0,
  }),
});
function SyncDetail() {
  const { userId } = Route.useRouteContext();
  const { id } = Route.useParams();
  const { section = 'overview', offset = 0 } = Route.useSearch();
  const query = useQuery(syncDetailOptions({ userId, id, offset }));
  const catalog = useQuery(catalogOptions(userId));
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: syncKeys.owner(userId) });
  const enable = useMutation({ mutationFn: setEnabled, onSuccess: invalidate });
  const run = useMutation({ mutationFn: runSync, onSuccess: invalidate });
  const sync = query.data?.installation;
  const source = catalog.data?.sources.find(
    (entry) => entry.id === sync?.definition.id && entry.version === sync.definition.version,
  );
  const destination = catalog.data?.destinations.find((entry) => entry.id === sync?.destinationId);
  const type = catalog.data?.types.find((entry) => entry.type === destination?.type);
  const needsAuthorization = !!source?.provider && !sync?.connection;
  const error = query.error || catalog.error || enable.error || run.error;
  return (
    <SectionPage
      title={source?.name ?? sync?.definition.id ?? 'Sync'}
      action={
        <Link to="/syncs" className="text-sm underline">
          All syncs
        </Link>
      }
    >
      {query.isPending && <p>Loading sync…</p>}
      {error && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {error.message}
        </p>
      )}
      {sync && (
        <div className="space-y-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              {needsAuthorization ? 'Waiting for authorization' : sync.status.replaceAll('_', ' ')}{' '}
              → {type?.name ?? destination?.type ?? 'Unavailable destination'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={enable.isPending || !!needsAuthorization}
                onClick={() => enable.mutate({ id, enabled: !sync.enabled })}
              >
                {sync.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button
                variant="outline"
                disabled={!sync.enabled || sync.status === 'running' || run.isPending}
                onClick={() => run.mutate({ id, backfill: false })}
              >
                Run now
              </Button>
              <Button
                variant="ghost"
                disabled={!sync.enabled || sync.status === 'running' || run.isPending}
                onClick={() => run.mutate({ id, backfill: true })}
              >
                Reprocess
              </Button>
            </div>
          </div>
          {needsAuthorization && (
            <Link
              to="/providers/$service"
              params={{ service: source!.provider!.service }}
              search={{ syncId: id }}
              className="inline-block text-sm underline underline-offset-4"
            >
              Connect provider to start syncing
            </Link>
          )}
          <nav aria-label="Sync sections" className="flex flex-wrap gap-6 border-border border-b">
            {(['overview', 'history'] as const).map((entry) => (
              <Link
                key={entry}
                to="/syncs/$id"
                params={{ id }}
                search={{ section: entry }}
                aria-current={entry === section ? 'page' : undefined}
                className={`border-b-2 pb-3 text-sm ${entry === section ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`}
              >
                {
                  {
                    overview: 'Overview',
                    history: 'Polling history',
                  }[entry]
                }
              </Link>
            ))}
          </nav>
          {section === 'overview' && (
            <div className="max-w-2xl space-y-6">
              <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Poll interval</dt>
                <dd>{sync.intervalMs / millisecondsPerMinute} minutes</dd>
                <dt className="text-muted-foreground">Next scheduled poll</dt>
                <dd>{nextPoll(sync)}</dd>
              </dl>
              <Link
                to="/records"
                search={{ sourceId: sync.sourceId }}
                className="inline-block text-sm underline"
              >
                View records
              </Link>
            </div>
          )}
          {section === 'history' && query.data && (
            <PollingHistory id={id} offset={offset} history={query.data} />
          )}
        </div>
      )}
    </SectionPage>
  );
}

function nextPoll(sync: { enabled: boolean; status: string; nextDueAt: number }) {
  if (!sync.enabled) {
    return 'Paused';
  }
  if (sync.status === 'running') {
    return 'After the current run completes';
  }
  return new Date(sync.nextDueAt).toLocaleString();
}
