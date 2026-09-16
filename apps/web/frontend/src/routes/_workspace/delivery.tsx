import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';
import { retryDelivery, setReceiverPaused, syncKeys, syncOptions } from '../../queries/sync';

export const Route = createFileRoute('/_workspace/delivery')({ component: Delivery });
function Delivery() {
  const { userId } = Route.useRouteContext();
  const query = useQuery(syncOptions(userId));
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: syncKeys.owner(userId) });
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
            <p className="text-muted-foreground text-sm">Nothing waiting for delivery</p>
          )}
          <ul className="divide-y divide-border">
            {query.data.deliveries.map((delivery) => (
              <li key={delivery.id} className="flex items-center justify-between gap-4 py-4">
                <div className="space-y-1">
                  <p className="font-medium">{delivery.recordCount} records</p>
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
