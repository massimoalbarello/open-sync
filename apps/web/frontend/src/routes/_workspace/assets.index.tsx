import { Button } from '@repo/ui/button';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AssetLink } from '../../components/asset-link';
import { InfiniteScroll } from '../../components/infinite-scroll';
import { SectionPage } from '../../components/section-page';
import { SourceTimestamps } from '../../components/source-timestamps';
import { UpdatedDayList } from '../../components/updated-day-list';
import { assetsOptions } from '../../queries/assets';

export const Route = createFileRoute('/_workspace/assets/')({
  component: Assets,
  validateSearch: (search: Record<string, unknown>): { syncId?: string } => ({
    syncId: typeof search.syncId === 'string' ? search.syncId : undefined,
  }),
});

function Assets() {
  const { userId } = Route.useRouteContext();
  const { syncId } = Route.useSearch();
  const query = useInfiniteQuery(assetsOptions({ userId, syncId }));
  const assets = query.data?.pages.flatMap((page) => page.assets) ?? [];
  return (
    <SectionPage
      title="Assets"
      action={
        syncId ? (
          <Link to="/assets" search={{}} className="text-sm underline">
            All assets
          </Link>
        ) : undefined
      }
    >
      <p className="mb-6 text-muted-foreground text-sm">
        Files received from your syncs. Most recently updated first, grouped by your local day.
        Select a filename to preview it.
      </p>
      {query.isPending && <p>Loading assets…</p>}
      {query.error && (
        <div className="space-y-3">
          <p role="alert">{query.error.message}</p>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
      {query.data && assets.length === 0 && (
        <p>
          No assets received yet.{' '}
          <Link to="/syncs" className="underline">
            Go to syncs
          </Link>
        </p>
      )}
      <UpdatedDayList items={assets} label="Received assets" itemKey={(asset) => asset.id}>
        {(asset) => (
          <div className="space-y-2">
            <AssetLink asset={asset} />
            <p className="break-words text-muted-foreground text-sm">
              {asset.mediaType} · {formatSize(asset.size)}
            </p>
            <SourceTimestamps createdAt={asset.createdAt} />
          </div>
        )}
      </UpdatedDayList>
      <InfiniteScroll
        hasMore={query.hasNextPage}
        fetching={query.isFetching}
        error={query.error}
        onLoad={() => void query.fetchNextPage()}
      />
    </SectionPage>
  );
}

function formatSize(bytes: number): string {
  const unitSize = 1024;
  if (bytes < unitSize) {
    return `${bytes.toLocaleString()} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / unitSize;
  let unit = 0;
  while (value >= unitSize && unit < units.length - 1) {
    value /= unitSize;
    unit++;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
