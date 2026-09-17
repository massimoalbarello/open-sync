import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Select } from '@repo/ui/select';
import { Textarea } from '@repo/ui/textarea';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { JsonView } from '../../components/json-view';
import { SectionPage } from '../../components/section-page';
import { catalogOptions, createSync } from '../../queries/catalog';
import { syncKeys } from '../../queries/sync';

export const Route = createFileRoute('/_workspace/syncs/new')({
  component: NewSync,
  validateSearch: (search: Record<string, unknown>): { source?: string; version?: string } => ({
    source: typeof search.source === 'string' ? search.source : undefined,
    version: typeof search.version === 'string' ? search.version : undefined,
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
      await navigate({ to: '/syncs/$id', params: { id: sync.id } });
    },
  });
  const form = useForm({
    defaultValues: {
      source:
        search.source && search.version ? JSON.stringify([search.source, search.version]) : '',
      destinationId: '',
      connectionId: '',
      config: '{}',
      intervalMinutes: 15,
    },
    onSubmit: async ({ value }) => {
      const definition = query.data?.sources.find(
        (source) => JSON.stringify([source.id, source.version]) === value.source,
      );
      if (!definition) {
        throw new Error('Select a source.');
      }
      const connection = query.data?.connections.find(
        (entry) =>
          entry.id === value.connectionId && entry.service === definition.provider?.service,
      );
      await create.mutateAsync({
        ...value,
        definition,
        connection:
          definition.provider && connection
            ? { id: connection.id, service: connection.service }
            : undefined,
      });
    },
  });
  return (
    <SectionPage
      title="Create sync"
      action={
        <Link to="/syncs" className="text-sm underline">
          All syncs
        </Link>
      }
    >
      {query.isPending && <p>Loading available sources…</p>}
      {(query.error || create.error) && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {(query.error || create.error)?.message}
        </p>
      )}
      {query.data && (
        <form
          className="max-w-xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.Field
            name="source"
            validators={{ onSubmit: ({ value }) => (!value ? 'Select a source.' : undefined) }}
          >
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="sync-source" className="text-sm">
                  Source
                </label>
                <Select
                  id="sync-source"
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value);
                    form.setFieldValue('connectionId', '');
                    form.setFieldValue('config', '{}');
                  }}
                  options={query.data.sources.map((source) => ({
                    value: JSON.stringify([source.id, source.version]),
                    label: `${source.name ?? source.id} · ${source.version}`,
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
          <form.Subscribe selector={(state) => state.values.source}>
            {(selected) => {
              const source = query.data.sources.find(
                (entry) => JSON.stringify([entry.id, entry.version]) === selected,
              );
              return (
                source && (
                  <div className="space-y-4">
                    <p className="text-muted-foreground text-sm">{source.description}</p>
                    {source.provider && (
                      <>
                        <form.Field name="connectionId">
                          {(field) => (
                            <div className="space-y-2">
                              <label htmlFor="sync-account" className="text-sm">
                                Account
                              </label>
                              <Select
                                id="sync-account"
                                value={field.state.value}
                                onValueChange={field.handleChange}
                                options={query.data.connections
                                  .filter((entry) => entry.service === source.provider?.service)
                                  .map((entry) => ({ value: entry.id, label: entry.account }))}
                              />
                            </div>
                          )}
                        </form.Field>
                        <Link
                          to="/providers/$service"
                          params={{ service: source.provider.service }}
                          search={{ section: 'connections' }}
                          className="text-sm underline"
                        >
                          Manage provider connections
                        </Link>
                      </>
                    )}
                    <details>
                      <summary className="cursor-pointer text-sm">Configuration schema</summary>
                      <JsonView value={source.configSchema} />
                    </details>
                  </div>
                )
              );
            }}
          </form.Subscribe>
          <form.Field name="config">
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="sync-config" className="text-sm">
                  Configuration (JSON)
                </label>
                <Textarea
                  id="sync-config"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="destinationId">
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="sync-destination" className="text-sm">
                  Destination
                </label>
                <Select
                  id="sync-destination"
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  options={[...query.data.destinations.entries()].map(([index, destination]) => ({
                    value: destination.id,
                    label: `${query.data.types.find((type) => type.type === destination.type)?.name ?? destination.type} · ${index + 1}`,
                  }))}
                />
              </div>
            )}
          </form.Field>
          <Link to="/destinations" className="inline-block text-sm underline">
            Manage destinations
          </Link>
          <form.Field name="intervalMinutes">
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="sync-interval" className="text-sm">
                  Poll interval (minutes)
                </label>
                <Input
                  id="sync-interval"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(Number(event.target.value))}
                />
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
