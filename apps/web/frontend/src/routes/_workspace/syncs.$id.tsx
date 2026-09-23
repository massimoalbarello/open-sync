import type { SyncApi } from '@context-use/open-sync';
import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';
import {
  removeSync,
  resync,
  runSync,
  setEnabled,
  syncDetailOptions,
  syncKeys,
} from '../../queries/sync';
import { SyncAccount } from './-syncs/sync-account';

const millisecondsPerMinute = 60_000;
export const Route = createFileRoute('/_workspace/syncs/$id')({
  component: SyncDetail,
});
function SyncDetail() {
  const { userId } = Route.useRouteContext();
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const query = useQuery(syncDetailOptions({ userId, id }));
  const catalog = useQuery(catalogOptions(userId));
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: syncKeys.owner(userId) });
  const enable = useMutation({ mutationFn: setEnabled, onSuccess: invalidate });
  const run = useMutation({ mutationFn: runSync, onSuccess: invalidate });
  const replay = useMutation({ mutationFn: resync, onSuccess: invalidate });
  const remove = useMutation({
    mutationFn: removeSync,
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: syncKeys.owner(userId) });
      client.removeQueries({ queryKey: [...syncKeys.owner(userId), id] });
      await navigate({ to: '/syncs' });
      await invalidate();
    },
  });
  const sync = query.data?.sync;
  const source = catalog.data?.sources.find((entry) => entry.id === sync?.definition);
  const type = catalog.data?.types.find((entry) => entry.type === sync?.destinationType);
  const needsAuthorization = !!source?.provider && !sync?.connection;
  const error =
    query.error || catalog.error || enable.error || run.error || replay.error || remove.error;
  return (
    <SectionPage
      title={syncTitle({ sync, sourceName: source?.name, destinationName: type?.name })}
      subtitle={<SyncAccount connection={sync?.connection} connections={query.data?.connections} />}
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
          <div className="flex flex-wrap justify-end gap-2">
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
              onClick={() => run.mutate({ id })}
            >
              Run now
            </Button>
            <Button
              variant="ghost"
              disabled={!sync.enabled || replay.isPending}
              onClick={() => replay.mutate({ id })}
            >
              Resync
            </Button>
            <Button variant="destructive" onClick={() => setConfirmRemoval(true)}>
              Remove sync
            </Button>
          </div>
          {confirmRemoval && (
            <div role="alert" className="space-y-3">
              <p>
                Remove this sync and discard its queued deliveries? Records already delivered and
                provider connections will remain.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => setConfirmRemoval(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id })}
                >
                  Confirm removal
                </Button>
              </div>
            </div>
          )}
          {sync.errorCode && (
            <p role="alert" className="text-destructive text-sm">
              {sync.errorCode.replaceAll('_', ' ')}
            </p>
          )}
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
          <div className="max-w-2xl space-y-6">
            <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{sync.status.replaceAll('_', ' ')}</dd>
              <dt className="text-muted-foreground">Sync interval</dt>
              <dd>{sync.intervalMs / millisecondsPerMinute} minutes</dd>
              <dt className="text-muted-foreground">Next scheduled run</dt>
              <dd>{nextRun(sync)}</dd>
            </dl>
            <Link
              to="/records"
              search={{ syncId: sync.id }}
              className="inline-block text-sm underline"
            >
              View records
            </Link>
          </div>
        </div>
      )}
    </SectionPage>
  );
}

function nextRun(sync: { enabled: boolean; status: string; nextDueAt: number }) {
  if (!sync.enabled) {
    return 'Paused';
  }
  if (sync.status === 'running') {
    return 'After the current run completes';
  }
  return new Date(sync.nextDueAt).toLocaleString();
}

function syncTitle({
  sync,
  sourceName,
  destinationName,
}: {
  sync: ReturnType<SyncApi['sync']> | undefined;
  sourceName?: string;
  destinationName?: string;
}) {
  return sync
    ? `${sourceName ?? sync.definition} → ${destinationName ?? sync.destinationType}`
    : 'Sync';
}
