import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { JsonView } from '../../components/json-view';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';
import { runSync, setEnabled, syncDetailOptions, syncKeys } from '../../queries/sync';

import { PollingHistory } from './-syncs/polling-history';

const millisecondsPerMinute = 60_000;
type Section = 'overview' | 'history' | 'checkpoint' | 'schema';
const maxOffset = 1_000_000;
export const Route = createFileRoute('/_workspace/syncs/$id')({
  component: SyncDetail,
  validateSearch: (search: Record<string, unknown>): { section?: Section; offset?: number } => ({
    section:
      search.section === 'history' || search.section === 'checkpoint' || search.section === 'schema'
        ? search.section
        : 'overview',
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
              {sync.status.replaceAll('_', ' ')} →{' '}
              {type?.name ?? destination?.type ?? 'Unavailable destination'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={enable.isPending}
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
          <nav aria-label="Sync sections" className="flex flex-wrap gap-6 border-border border-b">
            {(['overview', 'history', 'checkpoint', 'schema'] as const).map((entry) => (
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
                    checkpoint: 'Checkpoint',
                    schema: 'Record schemas',
                  }[entry]
                }
              </Link>
            ))}
          </nav>
          {section === 'overview' && (
            <div className="max-w-2xl space-y-6">
              <p className="text-sm">{source?.description}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Source version</dt>
                <dd>{sync.definition.version}</dd>
                <dt className="text-muted-foreground">Poll interval</dt>
                <dd>{sync.intervalMs / millisecondsPerMinute} minutes</dd>
                <dt className="text-muted-foreground">Next scheduled poll</dt>
                <dd>{nextPoll(sync)}</dd>
                <dt className="text-muted-foreground">Checkpoint revision</dt>
                <dd>{sync.checkpointRevision}</dd>
              </dl>
              <div>
                <h2 className="mb-3 font-medium">Source configuration</h2>
                <JsonView value={sync.config} />
              </div>
              <Link
                to="/records"
                search={{ sourceId: sync.sourceId }}
                className="inline-block text-sm underline"
              >
                View locally received records
              </Link>
            </div>
          )}
          {section === 'checkpoint' && (
            <div className="max-w-3xl space-y-4">
              <p className="text-muted-foreground text-sm">
                Revision {sync.checkpointRevision}. Progress advances only after the page and its
                output are durably committed.
              </p>
              <JsonView value={sync.checkpoint} />
              <details>
                <summary className="cursor-pointer text-sm">Checkpoint schema</summary>
                <JsonView value={source?.checkpointSchema} />
              </details>
            </div>
          )}
          {section === 'schema' && (
            <div className="max-w-3xl space-y-6">
              <p className="text-muted-foreground text-sm">
                Each record has a kind and stable ID. Upserts carry JSON data validated against the
                corresponding schema; deletions carry the kind and ID.
              </p>
              {Object.entries(source?.kinds ?? {}).map(([kind, schema]) => (
                <section key={kind}>
                  <h2 className="mb-3 font-medium">{kind}</h2>
                  <JsonView value={schema} />
                </section>
              ))}
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
