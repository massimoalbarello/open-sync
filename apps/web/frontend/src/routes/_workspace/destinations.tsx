import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Database, Globe } from 'lucide-react';
import { SectionPage } from '../../components/section-page';
import { catalogOptions } from '../../queries/catalog';

export const Route = createFileRoute('/_workspace/destinations')({ component: Destinations });
function Destinations() {
  const { userId } = Route.useRouteContext();
  const query = useQuery(catalogOptions(userId));
  return (
    <SectionPage title="Destinations">
      {query.isPending && <p>Loading destinations…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      <ul className="divide-y divide-border">
        {query.data?.types.map((type) => (
          <li key={type.type} className="flex flex-wrap items-center gap-5 py-6 first:pt-0">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              {type.type === 'local' ? (
                <Database aria-hidden="true" className="size-5" />
              ) : (
                <Globe aria-hidden="true" className="size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="font-medium">{type.name ?? type.type}</h2>
              <p className="text-muted-foreground text-sm">{type.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </SectionPage>
  );
}
