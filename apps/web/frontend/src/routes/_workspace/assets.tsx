import { Button } from '@repo/ui/button';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AssetLink } from '../../components/asset-link';
import { InfiniteScroll } from '../../components/infinite-scroll';
import { SectionPage } from '../../components/section-page';
import { assetsOptions } from '../../queries/assets';

export const Route = createFileRoute('/_workspace/assets')({
  component: Assets,
  validateSearch: (search: Record<string, unknown>): { sourceId?: string } => ({
    sourceId: typeof search.sourceId === 'string' ? search.sourceId : undefined,
  }),
});

function Assets() {
  const { userId } = Route.useRouteContext();
  const { sourceId } = Route.useSearch();
  const query = useInfiniteQuery(assetsOptions({ userId, sourceId }));
  const assets = query.data?.pages.flatMap((page) => page.assets) ?? [];
  return (
    <SectionPage
      title="Assets"
      action={
        sourceId ? (
          <Link to="/assets" search={{}} className="text-sm underline">
            All assets
          </Link>
        ) : undefined
      }
    >
      <p className="mb-6 text-muted-foreground text-sm">
        Files received from your syncs. Select a filename to download it.
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
      <ul aria-label="Received assets" className="divide-y divide-border">
        {assets.map((asset) => (
          <li key={asset.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <AssetLink asset={asset} />
              <p className="break-words text-muted-foreground text-sm">
                {asset.mediaType} · {formatSize(asset.size)}
              </p>
            </div>
            <Link
              to="/records"
              search={{ sourceId: asset.sourceId }}
              className="text-muted-foreground text-sm underline underline-offset-4"
            >
              Source records
            </Link>
          </li>
        ))}
      </ul>
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
