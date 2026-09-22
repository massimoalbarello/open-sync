import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AssetLink } from '../../components/asset-link';
import { InfiniteScroll } from '../../components/infinite-scroll';
import { SectionPage } from '../../components/section-page';
import { SourceTimestamps } from '../../components/source-timestamps';
import { recordsOptions } from '../../queries/records';

export const Route = createFileRoute('/_workspace/records/')({
  component: Records,
  validateSearch: (search: Record<string, unknown>): { sourceId?: string } => ({
    sourceId: typeof search.sourceId === 'string' ? search.sourceId : undefined,
  }),
});
function Records() {
  const { userId } = Route.useRouteContext();
  const { sourceId } = Route.useSearch();
  const query = useInfiniteQuery(recordsOptions({ userId, sourceId }));
  const records = query.data?.pages.flatMap((page) => page.records) ?? [];
  return (
    <SectionPage
      title="Records"
      action={
        sourceId ? (
          <Link to="/records" search={{}} className="text-sm underline">
            All records
          </Link>
        ) : undefined
      }
    >
      <p className="mb-6 text-muted-foreground text-sm">Records received from your syncs.</p>
      {query.isPending && <p>Loading records…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data && records.length === 0 && <p>No records received yet.</p>}
      <ul aria-label="Received records" className="divide-y divide-border">
        {records.map((record) => (
          <li key={JSON.stringify([record.sourceId, record.kind, record.id])} className="py-4">
            <Link
              to="/records/$sourceId/$kind/$recordId"
              params={{ sourceId: record.sourceId, kind: record.kind, recordId: record.id }}
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
              <SourceTimestamps createdAt={record.createdAt} updatedAt={record.updatedAt} />
            </div>
            {record.assets.length > 0 && (
              <div className="mt-4 space-y-2">
                <h2 className="font-medium text-muted-foreground text-xs">Related assets</h2>
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
