import { Button } from '@repo/ui/button';
import { Select } from '@repo/ui/select';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';
import { catalogOptions, createSync } from '../../queries/catalog';
import { syncKeys } from '../../queries/sync';

export const Route = createFileRoute('/_workspace/syncs/new')({
  component: NewSync,
  validateSearch: (search: Record<string, unknown>): { source?: string; destination?: string } => ({
    source: typeof search.source === 'string' ? search.source : undefined,
    destination: typeof search.destination === 'string' ? search.destination : undefined,
  }),
});
function NewSync() {
  const { userId } = Route.useRouteContext();
  const search = Route.useSearch();
  const query = useQuery(catalogOptions(userId));
  const navigate = useNavigate();
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: createSync,
    onSuccess: async (sync) => {
      await client.invalidateQueries({ queryKey: syncKeys.owner(userId) });
      if (sync.authorizeService) {
        await navigate({
          to: '/providers/$service',
          params: { service: sync.authorizeService },
          search: { syncId: sync.id },
        });
      } else {
        await navigate({ to: '/syncs/$id', params: { id: sync.id } });
      }
    },
  });
  const form = useForm({
    defaultValues: { source: search.source ?? '', destination: search.destination ?? 'local' },
    onSubmit: async ({ value }) => {
      await create.mutateAsync({ source: value.source, destination: 'local' });
    },
  });
  return (
    <SectionPage
      title="Create sync"
      action={
        <Link to="/syncs" className="text-muted-foreground text-sm hover:text-foreground">
          All syncs
        </Link>
      }
    >
      {query.isPending && <p>Loading sources and destinations…</p>}
      {(query.error || create.error) && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {(query.error || create.error)?.message}
        </p>
      )}
      {query.data && (
        <form
          className="max-w-xl space-y-7"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.Field
            name="source"
            validators={{
              onSubmit: ({ value }) =>
                !query.data.sources.some((source) => source.id === value)
                  ? 'Select a source.'
                  : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="sync-source" className="font-medium text-sm">
                  Source
                </label>
                <Select
                  id="sync-source"
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  options={query.data.sources.map((source) => ({
                    value: source.id,
                    label: source.name ?? source.id,
                  }))}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={String(error)} role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
          <form.Field
            name="destination"
            validators={{
              onSubmit: ({ value }) => (value !== 'local' ? 'Select a destination.' : undefined),
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="sync-destination" className="font-medium text-sm">
                  Destination
                </label>
                <Select
                  id="sync-destination"
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  options={query.data.types
                    .filter((type) => type.type === 'local')
                    .map((type) => ({ value: type.type, label: type.name ?? type.type }))}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={String(error)} role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create sync'}
          </Button>
        </form>
      )}
    </SectionPage>
  );
}
