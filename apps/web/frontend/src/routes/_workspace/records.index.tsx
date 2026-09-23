import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AssetLink } from '../../components/asset-link';
import { InfiniteScroll } from '../../components/infinite-scroll';
import { SectionPage } from '../../components/section-page';
import { SourceTimestamps } from '../../components/source-timestamps';
import { UpdatedDayList } from '../../components/updated-day-list';
import { recordsOptions } from '../../queries/records';

export const Route = createFileRoute('/_workspace/records/')({
  component: Records,
  validateSearch: (search: Record<string, unknown>): { syncId?: string } => ({
    syncId: typeof search.syncId === 'string' ? search.syncId : undefined,
  }),
});
function Records() {
  const { userId } = Route.useRouteContext();
  const { syncId } = Route.useSearch();
  const query = useInfiniteQuery(recordsOptions({ userId, syncId }));
  const records = query.data?.pages.flatMap((page) => page.records) ?? [];
  return (
    <SectionPage
      title="Records"
      action={
        syncId ? (
          <Link to="/records" search={{}} className="text-sm underline">
            All records
          </Link>
        ) : undefined
      }
    >
      <p className="mb-6 text-muted-foreground text-sm">
        Records received from your syncs. Most recently updated first, grouped by your local day.
      </p>
      {query.isPending && <p>Loading records…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data && records.length === 0 && <p>No records received yet.</p>}
      <UpdatedDayList
        items={records}
        label="Received records"
        itemKey={(record) => JSON.stringify([record.syncId, record.kind, record.id])}
      >
        {(record) => (
          <>
            <Link
              to="/records/$syncId/$kind/$recordId"
              params={{ syncId: record.syncId, kind: record.kind, recordId: record.id }}
              className="break-words font-medium underline underline-offset-4"
            >
              {record.preview || `${record.kind} · ${record.id}`}
            </Link>
            <span className="ml-3 text-muted-foreground text-sm">Revision {record.revision}</span>
            {record.preview && (
              <p className="mt-1 break-words text-muted-foreground text-xs">
                {record.kind} · {record.id}
              </p>
            )}
            <div className="mt-1">
              <SourceTimestamps createdAt={record.createdAt} />
            </div>
            {record.assets.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="font-medium text-muted-foreground text-xs">Related assets</h3>
                <ul
                  aria-label={`Assets for ${record.kind} ${record.id}`}
                  className="flex flex-wrap gap-x-6 gap-y-2"
                >
                  {record.assets.map((asset) => (
                    <li key={asset.id}>
                      <AssetLink asset={asset} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
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
