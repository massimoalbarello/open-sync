import type { SyncApi } from '@context-use/open-sync';
import { Link } from '@tanstack/react-router';
import { statusLabel } from './status-label';

export function PollingHistory({
  id,
  offset,
  history,
}: {
  id: string;
  offset: number;
  history: ReturnType<SyncApi['polls']>;
}) {
  return (
    <div className="space-y-4">
      {!history.polls.length && <p>No polls yet.</p>}
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
          {history.polls.map((poll) => (
            <tbody key={poll.id} className="border-border border-b">
              <tr className="align-top">
                <td className="py-4 pr-4">{new Date(poll.startedAt).toLocaleString()}</td>
                <td className="py-4 pr-4">
                  {poll.completedAt ? new Date(poll.completedAt).toLocaleString() : '—'}
                </td>
                <td className="py-4 pr-4">{statusLabel(poll.state)}</td>
                <td className="py-4">
                  {poll.recordsProcessed.toLocaleString()}
                  <p className="text-muted-foreground text-xs">
                    {poll.recordsChanged.toLocaleString()} changed
                  </p>
                </td>
              </tr>
              <tr>
                <td colSpan={4} className="pb-4">
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">
                      {poll.attemptCount} {poll.attemptCount === 1 ? 'attempt' : 'attempts'}
                    </summary>
                    {poll.attempts.length < poll.attemptCount && (
                      <p className="mt-2 text-muted-foreground">Showing recent attempts.</p>
                    )}
                    <ol className="mt-2 space-y-2 text-xs">
                      {poll.attempts.map((attempt) => (
                        <li key={attempt.id}>
                          {new Date(attempt.startedAt).toLocaleTimeString()} ·{' '}
                          {statusLabel(attempt.state)} · {attempt.recordsProcessed.toLocaleString()}{' '}
                          records
                        </li>
                      ))}
                    </ol>
                  </details>
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        Processed includes unchanged records. Changes are queued for delivery; see Queue for
        delivery progress.
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
