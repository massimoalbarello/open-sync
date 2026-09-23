import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { JsonView } from '../../components/json-view';
import { SectionPage } from '../../components/section-page';
import { deliverableOptions } from '../../queries/deliverables';

export const Route = createFileRoute('/_workspace/syncs/$id_/deliverables/$deliveryId')({
  validateSearch: (search: Record<string, unknown>): { received: boolean } => ({
    received: search.received === true,
  }),
  component: DeliverableDetail,
});
function DeliverableDetail() {
  const { userId } = Route.useRouteContext();
  const { id: syncId, deliveryId } = Route.useParams();
  const { received } = Route.useSearch();
  const query = useQuery(deliverableOptions({ userId, syncId, id: deliveryId, received }));
  const deliverable = query.data;
  return (
    <SectionPage
      title="Deliverable"
      action={
        <Link
          to="/syncs/$id"
          params={{ id: syncId }}
          search={{ view: received ? 'received' : 'pending' }}
          className="text-sm underline"
        >
          Back to sync
        </Link>
      }
    >
      {query.isPending && <p>Loading deliverable…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {deliverable && (
        <div className="space-y-6">
          <p className="break-all text-muted-foreground text-sm">{deliverable.id}</p>
          <section aria-label="Records" className="space-y-3">
            <h2 className="font-medium">Records ({deliverable.records.length})</h2>
            <JsonView value={deliverable.records} />
          </section>
          <section aria-label="Assets" className="space-y-3">
            <h2 className="font-medium">Assets ({deliverable.assets.length})</h2>
            {!deliverable.assets.length && (
              <p className="text-muted-foreground text-sm">No assets in this deliverable.</p>
            )}
            <ul aria-label="Deliverable assets" className="space-y-4">
              {/* biome-ignore lint/complexity/useMaxParams: Asset position identifies its download within the bundle. */}
              {deliverable.assets.map((asset, index) => (
                <li key={JSON.stringify([asset.id, asset.version])} className="space-y-2 text-sm">
                  <p className="break-words font-medium">{asset.name}</p>
                  {'unavailable' in asset ? (
                    <p className="text-destructive">Unavailable: {asset.unavailable}</p>
                  ) : (
                    received && (
                      <a
                        download
                        href={`/api/receiver/syncs/${encodeURIComponent(syncId)}/deliverables/${encodeURIComponent(deliveryId)}/assets/${index}`}
                        className="underline underline-offset-4"
                      >
                        Download {asset.name}
                      </a>
                    )
                  )}
                  <JsonView value={asset} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </SectionPage>
  );
}
