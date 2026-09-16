import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { SectionPage } from '../../components/section-page';
import { createSampleSync, runSync, setEnabled, syncKeys, syncOptions } from '../../queries/sync';
import { GithubSync } from './-syncs/github-sync';

export const Route = createFileRoute('/_workspace/syncs')({ component: Syncs });
function Syncs() {
  const { userId } = Route.useRouteContext();
  const [addingGithub, setAddingGithub] = useState(false);
  const client = useQueryClient();
  const query = useQuery(syncOptions(userId));
  const invalidate = () => client.invalidateQueries({ queryKey: syncKeys.owner(userId) });
  const create = useMutation({ mutationFn: createSampleSync, onSuccess: invalidate });
  const enable = useMutation({ mutationFn: setEnabled, onSuccess: invalidate });
  const run = useMutation({ mutationFn: runSync, onSuccess: invalidate });
  const error = create.error || enable.error || run.error || query.error;
  return (
    <SectionPage
      title="Syncs"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Add sample sync'}
          </Button>
          <Button onClick={() => setAddingGithub(!addingGithub)} aria-expanded={addingGithub}>
            {addingGithub ? 'Cancel' : 'Add GitHub sync'}
          </Button>
        </div>
      }
    >
      {addingGithub && <GithubSync userId={userId} onCreated={() => setAddingGithub(false)} />}
      {error && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {error.message}
        </p>
      )}
      {query.isPending && <p className="text-muted-foreground text-sm">Loading syncs…</p>}
      {query.data && !query.data.installations.length && (
        <p className="font-medium">No syncs yet</p>
      )}
      <ul className="divide-y divide-border">
        {query.data?.installations.map((sync) => (
          <li key={sync.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="space-y-1">
              <p className="font-medium">
                {sync.definition.id === 'github.pull-requests'
                  ? 'GitHub pull requests'
                  : 'Sample sync'}
              </p>
              <p className="text-muted-foreground text-sm">
                {sync.status.replaceAll('_', ' ')} · {progress(sync)}
              </p>
              {sync.definition.id === 'github.pull-requests' && (
                <p className="text-muted-foreground text-sm">
                  Descriptions and metadata · Scans every 15 minutes · Local delivery and server log
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={enable.isPending}
                onClick={() => enable.mutate({ id: sync.id, enabled: !sync.enabled })}
              >
                {sync.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!sync.enabled || sync.status === 'running' || run.isPending}
                onClick={() => run.mutate({ id: sync.id, backfill: true })}
              >
                Reprocess
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SectionPage>
  );
}

function progress(sync: {
  definition: { id: string };
  checkpoint: unknown;
  config: Record<string, unknown>;
}) {
  if (sync.definition.id === 'github.pull-requests') {
    const checkpoint = sync.checkpoint as { scanned: number; total: number };
    return `${checkpoint.scanned} / ${checkpoint.total} pull requests scanned`;
  }
  return `${String(sync.checkpoint)} / ${String(sync.config.count)} records acquired`;
}
