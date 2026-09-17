import { Button } from '@repo/ui/button';
import { Select } from '@repo/ui/select';
import { Textarea } from '@repo/ui/textarea';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { JsonView } from '../../components/json-view';
import { SectionPage } from '../../components/section-page';
import { catalogOptions, createDestination } from '../../queries/catalog';
import { syncKeys } from '../../queries/sync';

export const Route = createFileRoute('/_workspace/destinations')({ component: Destinations });
function Destinations() {
  const { userId } = Route.useRouteContext();
  const query = useQuery(catalogOptions(userId));
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: createDestination,
    onSuccess: () => client.invalidateQueries({ queryKey: syncKeys.owner(userId) }),
  });
  const form = useForm({
    defaultValues: { type: '', config: '{}' },
    onSubmit: async ({ value }) => {
      await create.mutateAsync(value);
    },
  });
  return (
    <SectionPage title="Destinations">
      <p className="mb-6 text-muted-foreground text-sm">
        Available loaders and their configured destinations.
      </p>
      {query.isPending && <p>Loading destinations…</p>}
      {(query.error || create.error) && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {(query.error || create.error)?.message}
        </p>
      )}
      <ul className="mb-8 divide-y divide-border">
        {query.data?.types.map((type) => (
          <li key={type.type} className="space-y-3 py-4">
            <h2 className="font-medium">{type.name ?? type.type}</h2>
            <p className="text-muted-foreground text-sm">{type.description}</p>
            <p className="text-sm">
              {
                query.data.destinations.filter((destination) => destination.type === type.type)
                  .length
              }{' '}
              configured
            </p>
            <details>
              <summary className="cursor-pointer text-sm">Configuration schema</summary>
              <JsonView value={type.configSchema} />
            </details>
          </li>
        ))}
      </ul>
      {query.data && query.data.types.length > 0 && (
        <form
          className="max-w-xl space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <h2 className="font-medium">Add destination</h2>
          <form.Field name="type">
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="destination-type" className="text-sm">
                  Destination
                </label>
                <Select
                  id="destination-type"
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  options={query.data.types.map((type) => ({
                    value: type.type,
                    label: type.name ?? type.type,
                  }))}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="config">
            {(field) => (
              <div className="space-y-2">
                <label htmlFor="destination-config" className="text-sm">
                  Configuration (JSON)
                </label>
                <Textarea
                  id="destination-config"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
          </form.Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add destination'}
          </Button>
        </form>
      )}
      {query.data?.types.length === 0 && <p>No destinations registered.</p>}
    </SectionPage>
  );
}
