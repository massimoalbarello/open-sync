import type { SyncApi } from '@context-use/open-sync';
import { Link } from '@tanstack/react-router';
import { statusLabel } from './status-label';

export function RunHistory({
  id,
  offset,
  history,
}: {
  id: string;
  offset: number;
  history: ReturnType<SyncApi['runs']>;
}) {
  return (
    <div className="space-y-4">
      {!history.runs.length && <p>No runs yet.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="py-3 pr-4">Started</th>
              <th className="pr-4">Finished</th>
              <th className="pr-4">Status</th>
              <th className="pr-4">Records processed</th>
            </tr>
          </thead>
          {history.runs.map((run) => (
            <tbody key={run.id} className="border-border border-b">
              <tr className="align-top">
                <td className="py-4 pr-4">{new Date(run.startedAt).toLocaleString()}</td>
                <td className="py-4 pr-4">
                  {run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}
                </td>
                <td className="py-4 pr-4">
                  {statusLabel(run.state)}
                  {run.mode === 'resync' && <p className="text-muted-foreground text-xs">Resync</p>}
                  {run.errorCode && (
                    <p className="text-destructive text-xs">{statusLabel(run.errorCode)}</p>
                  )}
                </td>
                <td className="py-4">
                  {run.recordsProcessed.toLocaleString()}
                  <p className="text-muted-foreground text-xs">
                    {run.recordsQueued.toLocaleString()} queued
                  </p>
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        Processed includes unchanged records. Queued includes unchanged records during resync; see
        Queue for delivery progress.
      </p>
      <div className="flex gap-4">
        {offset > 0 && (
          <Link
            to="/syncs/$id"
            params={{ id }}
            search={{ section: 'history', offset: Math.max(0, offset - history.pageSize) }}
            className="text-sm underline"
          >
            Newer
          </Link>
        )}
        {history.hasMore && (
          <Link
            to="/syncs/$id"
            params={{ id }}
            search={{ section: 'history', offset: offset + history.pageSize }}
            className="text-sm underline"
          >
            Older
          </Link>
        )}
      </div>
    </div>
  );
}
