import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { JsonView } from '../../components/json-view';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';

export const Route = createFileRoute('/_workspace/sources')({ component: Sources });
function Sources() {
  const { userId } = Route.useRouteContext();
  const query = useQuery(catalogOptions(userId));
  return (
    <SectionPage title="Sources">
      <p className="mb-6 text-muted-foreground text-sm">
        Available extractors and transformations. Choose one when creating a sync.
      </p>
      {query.isPending && <p>Loading sources…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data?.sources.length === 0 && <p>No sources registered.</p>}
      <ul className="divide-y divide-border">
        {query.data?.sources.map((source) => (
          <li key={`${source.id}/${source.version}`} className="space-y-4 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="font-medium">{source.name ?? source.id}</h2>
                <p className="text-muted-foreground text-sm">Version {source.version}</p>
                <p className="max-w-2xl text-sm">{source.description}</p>
              </div>
              <Link
                to="/syncs/new"
                search={{ source: source.id, version: source.version }}
                className="shrink-0 text-sm underline underline-offset-4"
              >
                Create sync
              </Link>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">Record schemas</summary>
              <div className="mt-3 space-y-3">
                {Object.entries(source.kinds).map(([kind, schema]) => (
                  <div key={kind}>
                    <h3 className="mb-2 text-sm">{kind}</h3>
                    <JsonView value={schema} />
                  </div>
                ))}
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm">Configuration schema</summary>
              <div className="mt-3">
                <JsonView value={source.configSchema} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </SectionPage>
  );
}
