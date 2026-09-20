import { Button } from '@repo/ui/button';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { InfiniteScroll } from '../../components/infinite-scroll';
import { SectionPage } from '../../components/section-page';
import {
  deliveryKeys,
  deliveryOptions,
  deliveryStatusOptions,
  retryDelivery,
  setReceiverPaused,
} from '../../queries/delivery';

export const Route = createFileRoute('/_workspace/delivery')({ component: Delivery });
function Delivery() {
  const { userId } = Route.useRouteContext();
  const query = useInfiniteQuery(deliveryOptions(userId));
  const status = useQuery(deliveryStatusOptions(userId));
  const deliveries = query.data?.pages.flatMap((page) => page.deliveries) ?? [];
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: deliveryKeys.owner(userId) });
  const pause = useMutation({ mutationFn: setReceiverPaused, onSuccess: invalidate });
  const retry = useMutation({ mutationFn: retryDelivery, onSuccess: invalidate });
  const error = query.error || status.error || pause.error || retry.error;
  return (
    <SectionPage
      title="Queue"
      action={
        status.data && (
          <Button
            variant="outline"
            disabled={pause.isPending}
            onClick={() => pause.mutate(!status.data!.receiver.paused)}
          >
            {status.data.receiver.paused ? 'Resume delivery' : 'Pause delivery'}
          </Button>
        )
      }
    >
      {error && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {error.message}
        </p>
      )}
      {query.isPending && <p className="text-muted-foreground text-sm">Loading deliveries…</p>}
      {status.data && (
        <>
          <p className="mb-2 font-medium">{status.data.receiver.records} records received</p>
          <p className="mb-6 text-muted-foreground text-sm">
            {status.data.queue.pendingRecords} records waiting ·{' '}
            {status.data.queue.blockedDeliveries} deliveries blocked
            {status.data.receiver.paused ? ' · Delivery paused' : ''}
          </p>
          {!deliveries.length && !query.isPending && (
            <p className="text-muted-foreground text-sm">Nothing waiting for delivery</p>
          )}
          <ul aria-label="Pending deliveries" className="divide-y divide-border">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex items-center justify-between gap-4 py-4">
                <div className="space-y-1">
                  <p className="font-medium">
                    {delivery.recordCount} {delivery.recordCount === 1 ? 'record' : 'records'}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {delivery.state}
                    {delivery.errorCode ? ` · ${delivery.errorCode.replaceAll('_', ' ')}` : ''}
                  </p>
                </div>
                {delivery.state === 'blocked' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(delivery.id)}
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
        </>
      )}
    </SectionPage>
  );
}
