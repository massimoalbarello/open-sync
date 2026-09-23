import { Button } from '@repo/ui/button';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { InfiniteScroll } from '../../../components/infinite-scroll';
import {
  pendingDeliverablesOptions,
  receivedDeliverablesOptions,
  retryDelivery,
} from '../../../queries/deliverables';
import { pollOptions, syncKeys } from '../../../queries/sync';
import { PollStats } from './poll-stats';

type SyncInput = { userId: string; id: string };
export function PollHistory(input: SyncInput) {
  const query = useInfiniteQuery(pollOptions(input));
  return (
    <>
      {query.isPending && <p>Loading polling iterations…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data && <PollStats polls={query.data.pages.flatMap((page) => page.polls)} />}
      <InfiniteScroll
        hasMore={query.hasNextPage}
        fetching={query.isFetching}
        error={query.error}
        onLoad={() => void query.fetchNextPage()}
      />
    </>
  );
}
export function PendingDeliverables(input: SyncInput) {
  const query = useInfiniteQuery(
    pendingDeliverablesOptions({ userId: input.userId, syncId: input.id }),
  );
  const client = useQueryClient();
  const retry = useMutation({
    mutationFn: retryDelivery,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: [...syncKeys.owner(input.userId), input.id] }),
  });
  const deliveries = query.data?.pages.flatMap((page) => page.deliveries) ?? [];
  return (
    <section aria-label="Pending deliverables" className="space-y-3">
      {query.isPending && <p>Loading deliverables…</p>}
      {(query.error || retry.error) && <p role="alert">{(query.error || retry.error)!.message}</p>}
      {query.data && !deliveries.length && <p>No pending deliverables.</p>}
      <ul aria-label="Pending deliverables" className="divide-y divide-border">
        {deliveries.map((delivery) => (
          <li key={delivery.id} className="flex items-start justify-between gap-4 py-4 text-sm">
            <div className="min-w-0 space-y-1">
              <Link
                to="/syncs/$id/deliverables/$deliveryId"
                params={{ id: input.id, deliveryId: delivery.id }}
                search={{ received: false }}
                className="font-medium underline underline-offset-4"
              >
                {delivery.recordCount} records · {delivery.assetCount} assets
              </Link>
              <p>
                {delivery.state === 'leased'
                  ? 'Delivering'
                  : delivery.state === 'blocked'
                    ? 'Blocked'
                    : 'Waiting'}{' '}
                · {delivery.attempt} attempts
              </p>
              {delivery.errorCode && (
                <p className="text-destructive">{delivery.errorCode.replaceAll('_', ' ')}</p>
              )}
              {delivery.state === 'pending' && (
                <p className="text-muted-foreground">
                  Next attempt {new Date(delivery.nextAttemptAt).toLocaleString()}
                </p>
              )}
            </div>
            {delivery.state === 'blocked' && (
              <Button
                variant="outline"
                size="sm"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ syncId: input.id, id: delivery.id })}
              >
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
      <InfiniteScroll
        hasMore={query.hasNextPage}
        fetching={query.isFetching}
        error={query.error}
        onLoad={() => void query.fetchNextPage()}
      />
    </section>
  );
}
export function ReceivedDeliverables(input: SyncInput) {
  const query = useInfiniteQuery(
    receivedDeliverablesOptions({ userId: input.userId, syncId: input.id }),
  );
  const deliveries = query.data?.pages.flatMap((page) => page.deliverables) ?? [];
  return (
    <section aria-label="Received deliverables" className="space-y-3">
      {query.isPending && <p>Loading deliverables…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data && !deliveries.length && <p>No deliverables received yet.</p>}
      <ul aria-label="Received deliverables" className="divide-y divide-border">
        {deliveries.map((delivery) => (
          <li key={delivery.id} className="space-y-1 py-4 text-sm">
            <Link
              to="/syncs/$id/deliverables/$deliveryId"
              params={{ id: input.id, deliveryId: delivery.id }}
              search={{ received: true }}
              className="font-medium underline underline-offset-4"
            >
              {delivery.recordCount} records · {delivery.assetCount} assets
            </Link>
            <p className="text-muted-foreground">
              Received {new Date(delivery.receivedAt).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
      <InfiniteScroll
        hasMore={query.hasNextPage}
        fetching={query.isFetching}
        error={query.error}
        onLoad={() => void query.fetchNextPage()}
      />
    </section>
  );
}
