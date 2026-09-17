import type { SyncApi } from '@open-sync/core';
import { Link } from '@tanstack/react-router';

export function PollingHistory({
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
      <p className="text-muted-foreground text-sm">
        Retained execution attempts, newest first. A yielded or interrupted attempt resumes from
        committed progress.
      </p>
      {!history.runs.length && <p>No retained polling history.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="py-3 pr-4">Started</th>
              <th className="pr-4">Finished</th>
              <th className="pr-4">Status</th>
              <th className="pr-4">Pages committed</th>
              <th>Checkpoint revision</th>
            </tr>
          </thead>
          <tbody>
            {history.runs.map((attempt) => (
              <tr key={attempt.id} className="border-border border-b">
                <td className="py-4 pr-4">{new Date(attempt.startedAt).toLocaleString()}</td>
                <td className="pr-4">
                  {attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : 'Running'}
                </td>
                <td className="pr-4">{attempt.state.replaceAll('_', ' ')}</td>
                <td>{attempt.pages}</td>
                <td>{attempt.checkpointRevision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-4">
        {offset > 0 && (
          <Link
            to="/syncs/$id"
            params={{ id }}
            search={{ section: 'history', offset: Math.max(0, offset - (history.pageSize ?? 0)) }}
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
