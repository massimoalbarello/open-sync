import type { SyncApi } from '@context-use/open-sync';

export function PollStats({ polls }: { polls: ReturnType<SyncApi['polls']>['polls'] }) {
  return (
    <section aria-label="Polling iterations" className="space-y-3">
      <h2 className="font-medium">Polling iterations</h2>
      {polls.length === 0 ? (
        <p className="text-muted-foreground text-sm">No polls yet.</p>
      ) : (
        <ul aria-label="Polling iterations" className="divide-y divide-border">
          {polls.map((poll) => (
            <li key={poll.id} className="space-y-1 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
                <time dateTime={new Date(poll.startedAt).toISOString()}>
                  {new Date(poll.startedAt).toLocaleString()}
                </time>
                <span>{poll.state.replaceAll('_', ' ')}</span>
              </div>
              <p>
                {poll.recordsProcessed.toLocaleString()} processed ·{' '}
                {poll.recordsQueued.toLocaleString()} queued
              </p>
              {poll.completedAt !== null && (
                <p className="text-muted-foreground text-xs">
                  Finished {new Date(poll.completedAt).toLocaleString()}
                </p>
              )}
              {poll.errorCode && (
                <p className="text-destructive text-xs">{poll.errorCode.replaceAll('_', ' ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        Each iteration includes all pages and retries. Processed includes unchanged records; queued
        counts records added to the delivery queue.
      </p>
    </section>
  );
}
