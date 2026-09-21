import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AssetLink } from '../../components/asset-link';
import { JsonView } from '../../components/json-view';
import { MarkdownContent } from '../../components/markdown-content';
import { SectionPage } from '../../components/section-page';
import { recordOptions } from '../../queries/records';

export const Route = createFileRoute('/_workspace/records/$sourceId/$kind/$recordId')({
  component: RecordDetail,
});

function RecordDetail() {
  const { userId } = Route.useRouteContext();
  const { sourceId, kind, recordId } = Route.useParams();
  const query = useQuery(recordOptions({ userId, sourceId, kind, id: recordId }));
  const record = query.data;
  const title = record?.data.title ?? record?.data.subject;
  return (
    <SectionPage
      title={typeof title === 'string' && title ? title : `${kind} · ${recordId}`}
      subtitle={
        <p className="break-all text-muted-foreground text-sm">
          {kind} · {recordId}
          {record ? ` · Revision ${record.revision}` : ''}
        </p>
      }
      action={
        <Link to="/records" search={{ sourceId }} className="text-sm underline">
          Back to records
        </Link>
      }
    >
      {query.isPending && <p>Loading record…</p>}
      {query.error && (
        <div className="space-y-3">
          <p role="alert">{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {record === null && <p>This record is no longer available.</p>}
      {record && (
        <div className="max-w-4xl space-y-10">
          <section aria-label="Record content">
            {record.content?.body ? (
              <MarkdownContent body={record.content.body} />
            ) : (
              <p className="text-muted-foreground text-sm">
                This source has not provided readable content for this record.
              </p>
            )}
          </section>
          {record.assets.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold">Related assets</h2>
              <ul
                aria-label={`Assets for ${kind} ${recordId}`}
                className="flex flex-wrap gap-x-6 gap-y-3"
              >
                {record.assets.map((asset) => (
                  <li key={asset.id}>
                    <AssetLink asset={asset} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-3">
            <h2 className="font-semibold">Data</h2>
            <JsonView value={record.data} />
          </section>
        </div>
      )}
    </SectionPage>
  );
}
