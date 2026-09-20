import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, Download } from 'lucide-react';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';

export const Route = createFileRoute('/_workspace/sources')({ component: Sources });
function Sources() {
  const { userId } = Route.useRouteContext();
  const query = useQuery(catalogOptions(userId));
  return (
    <SectionPage title="Sources">
      {query.isPending && <p>Loading sources…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      <ul className="divide-y divide-border">
        {query.data?.sources.map((source) => (
          <li
            key={`${source.id}/${source.version}`}
            className="flex flex-wrap items-center gap-5 py-6 first:pt-0"
          >
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Download aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <h2 className="font-medium">{source.name ?? source.id}</h2>
              {source.provider && (
                <Link
                  to="/providers/$service"
                  params={{ service: source.provider.service }}
                  className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
                >
                  Configure provider <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {query.data?.sources.length === 0 && <p>No sources configured.</p>}
    </SectionPage>
  );
}
