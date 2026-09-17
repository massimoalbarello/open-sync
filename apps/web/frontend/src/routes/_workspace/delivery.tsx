import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';
import {
  deliveryKeys,
  deliveryOptions,
  retryDelivery,
  setReceiverPaused,
} from '../../queries/delivery';

const maxOffset = 1_000_000;
export const Route = createFileRoute('/_workspace/delivery')({
  component: Delivery,
  validateSearch: (search: Record<string, unknown>): { offset?: number } => ({
    offset:
      Number.isSafeInteger(Number(search.offset)) && Number(search.offset) > 0
        ? Math.min(maxOffset, Number(search.offset))
        : 0,
  }),
});
function Delivery() {
  const { userId } = Route.useRouteContext();
  const { offset = 0 } = Route.useSearch();
  const query = useQuery(deliveryOptions({ userId, offset }));
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: deliveryKeys.owner(userId) });
  const pause = useMutation({ mutationFn: setReceiverPaused, onSuccess: invalidate });
  const retry = useMutation({ mutationFn: retryDelivery, onSuccess: invalidate });
  const error = query.error || pause.error || retry.error;
  return (
    <SectionPage
      title="Delivery queue"
      action={
        query.data && (
          <Button
            variant="outline"
            disabled={pause.isPending}
            onClick={() => pause.mutate(!query.data.receiver.paused)}
          >
            {query.data.receiver.paused ? 'Resume delivery' : 'Pause delivery'}
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
      {query.data && (
        <>
          <p className="mb-2 font-medium">{query.data.receiver.records} records received</p>
          <p className="mb-6 text-muted-foreground text-sm">
            {query.data.queue.pendingRecords} records waiting · {query.data.queue.blockedDeliveries}{' '}
            deliveries blocked{query.data.receiver.paused ? ' · Delivery paused' : ''}
          </p>
          {!query.data.deliveries.length && (
            <p className="text-muted-foreground text-sm">
              {offset > 0 ? 'No deliveries on this page.' : 'Nothing waiting for delivery'}
            </p>
          )}
          <nav aria-label="Delivery pages" className="mb-4 flex items-center gap-4 text-sm">
            {offset > 0 && (
              <>
                <Link to="/delivery" search={{ offset: 0 }} className="underline">
                  First page
                </Link>
                <Link
                  to="/delivery"
                  search={{ offset: Math.max(0, offset - query.data.pageSize) }}
                  className="underline"
                >
                  Previous
                </Link>
              </>
            )}
            {query.data.deliveries.length > 0 && (
              <span className="text-muted-foreground">
                Deliveries {offset + 1}–{offset + query.data.deliveries.length}
              </span>
            )}
            {query.data.hasMore && (
              <Link
                to="/delivery"
                search={{ offset: offset + query.data.pageSize }}
                className="underline"
              >
                Next
              </Link>
            )}
          </nav>
          <ul aria-label="Pending deliveries" className="divide-y divide-border">
            {query.data.deliveries.map((delivery) => (
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
        </>
      )}
    </SectionPage>
  );
}
