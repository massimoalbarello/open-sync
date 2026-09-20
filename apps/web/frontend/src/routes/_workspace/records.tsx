import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { InfiniteScroll } from '../../components/infinite-scroll';
import { JsonView } from '../../components/json-view';
import { SectionPage } from '../../components/section-page';
import { recordsOptions } from '../../queries/records';

export const Route = createFileRoute('/_workspace/records')({
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
            <details>
              <summary className="cursor-pointer space-y-1 break-words">
                <span className="font-medium">
                  {record.kind} · {record.id}
                </span>
                <span className="ml-3 text-muted-foreground text-sm">
                  Revision {record.revision}
                </span>
              </summary>
              <div className="mt-4 max-w-4xl">
                <JsonView value={record.data} />
              </div>
            </details>
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
