import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { JsonView } from '../../components/json-view';
import { SectionPage } from '../../components/section-page';
import { recordsOptions } from '../../queries/records';

const maxOffset = 1_000_000;
export const Route = createFileRoute('/_workspace/records')({
  component: Records,
  validateSearch: (search: Record<string, unknown>): { sourceId?: string; offset?: number } => ({
    sourceId: typeof search.sourceId === 'string' ? search.sourceId : undefined,
    offset:
      Number.isSafeInteger(Number(search.offset)) && Number(search.offset) > 0
        ? Math.min(maxOffset, Number(search.offset))
        : 0,
  }),
});
function Records() {
  const { userId } = Route.useRouteContext();
  const { sourceId, offset = 0 } = Route.useSearch();
  const query = useQuery(recordsOptions({ userId, sourceId, offset }));
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
      <p className="mb-6 text-muted-foreground text-sm">
        Current records accepted by this application's local SQLite destination.
      </p>
      {query.isPending && <p>Loading records…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data?.records.length === 0 && <p>No records received yet.</p>}
      <ul className="divide-y divide-border">
        {query.data?.records.map((record) => (
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
      <div className="mt-6 flex gap-4">
        {offset > 0 && (
          <Link
            to="/records"
            search={{ sourceId, offset: Math.max(0, offset - (query.data?.pageSize ?? 0)) }}
            className="text-sm underline"
          >
            Previous
          </Link>
        )}
        {query.data?.hasMore && (
          <Link
            to="/records"
            search={{ sourceId, offset: offset + query.data.pageSize }}
            className="text-sm underline"
          >
            Next
          </Link>
        )}
      </div>
    </SectionPage>
  );
}
