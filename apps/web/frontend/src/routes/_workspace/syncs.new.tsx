import { Button } from '@repo/ui/button';
import { Select } from '@repo/ui/select';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useId } from 'react';
import { SectionPage } from '../../components/section-page';
import { catalogOptions, createSync, type loadCatalog } from '../../queries/catalog';
import { type loadProvider, providerSetupOptions } from '../../queries/providers';
import { syncKeys } from '../../queries/sync';
import { accountLabel } from './-syncs/account-label';
import { SetupControl } from './-syncs/setup-control';
import { fieldError, setupError, setupFields, setupInput, setupValue } from './-syncs/setup-schema';

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
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data && <SyncForm catalog={query.data} search={search} userId={userId} />}
    </SectionPage>
  );
}

function SyncForm(input: {
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  search: { source?: string; destination?: string };
  userId: string;
}) {
  const { catalog, search, userId } = input;
  const fieldId = useId();
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
    defaultValues: {
      source: search.source ?? '',
      sourceValues: [] as string[],
      connectionId: '',
      destination: search.destination ?? catalog.types[0]?.type ?? '',
      values: [] as string[],
    },
    onSubmit: async ({ value }) => {
      const type = catalog.types.find((entry) => entry.type === value.destination);
      const source = catalog.sources.find((entry) => entry.id === value.source);
      if (!type || !source) {
        return;
      }
      await create.mutateAsync({
        source: value.source,
        config: setupInput({
          fields: setupFields(source.configSchema),
          values: value.sourceValues,
        }),
        connectionId: value.connectionId || undefined,
        destination: {
          type: type.type,
          input: setupInput({ fields: setupFields(type.setupSchema), values: value.values }),
        },
      });
      form.resetField('values');
    },
    validators: {
      onSubmit: ({ value }) => {
        const source = catalog.sources.find((entry) => entry.id === value.source);
        if (!source) {
          return 'Select a source.';
        }
        if (source.provider) {
          const status = client.getQueryData(
            providerSetupOptions({ userId, service: source.provider.service }).queryKey,
          );
          const error = accountSelectionError({ status, connectionId: value.connectionId });
          if (error) {
            return error;
          }
        }
        const type = catalog.types.find((entry) => entry.type === value.destination);
        if (!type) {
          return 'Select a destination.';
        }
        try {
          return (
            setupError({
              schema: source.configSchema,
              values: setupInput({
                fields: setupFields(source.configSchema),
                values: value.sourceValues,
              }),
            }) ??
            setupError({
              schema: type.setupSchema,
              values: setupInput({ fields: setupFields(type.setupSchema), values: value.values }),
            })
          );
        } catch {
          return 'Check the settings.';
        }
      },
    },
  });
  return (
    <>
      {create.error && (
        <p role="alert" className="mb-4 text-destructive text-sm">
          {create.error.message}
        </p>
      )}
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
              !catalog.sources.some((source) => source.id === value)
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
                onValueChange={(value) => {
                  field.handleChange(value);
                  form.resetField('connectionId');
                  form.resetField('sourceValues');
                }}
                options={catalog.sources.map((source) => ({
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
        <form.Subscribe selector={(state) => state.values.source}>
          {(source) => {
            const service = catalog.sources.find((entry) => entry.id === source)?.provider?.service;
            return (
              service && (
                <form.Field name="connectionId">
                  {(field) => (
                    <AccountSelection
                      userId={userId}
                      service={service}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  )}
                </form.Field>
              )
            );
          }}
        </form.Subscribe>
        <form.Subscribe selector={(state) => state.values.source}>
          {(definitionId) => {
            const source = catalog.sources.find((entry) => entry.id === definitionId);
            return (
              source &&
              [...setupFields(source.configSchema).entries()].map(([index, definition]) => (
                <form.Field
                  key={`${definitionId}:${definition.name}`}
                  name={`sourceValues[${index}]`}
                  validators={{
                    onSubmit: ({ value }) =>
                      fieldError({
                        field: definition,
                        value: setupValue({ field: definition, value }),
                      }),
                  }}
                >
                  {(field) => (
                    <SetupControl
                      definition={definition}
                      id={`${fieldId}-source-${index}`}
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      errors={field.state.meta.errors}
                    />
                  )}
                </form.Field>
              ))
            );
          }}
        </form.Subscribe>
        <form.Field
          name="destination"
          validators={{
            onSubmit: ({ value }) =>
              !catalog.types.some((type) => type.type === value)
                ? 'Select a destination.'
                : undefined,
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
                onValueChange={(value) => {
                  field.handleChange(value);
                  form.resetField('values');
                }}
                options={catalog.types.map((type) => ({
                  value: type.type,
                  label: type.name ?? type.type,
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
        <form.Subscribe selector={(state) => state.values.destination}>
          {(destination) => {
            const type = catalog.types.find((entry) => entry.type === destination);
            return (
              type &&
              [...setupFields(type.setupSchema).entries()].map(([index, definition]) => (
                <form.Field
                  key={`${destination}:${definition.name}`}
                  name={`values[${index}]`}
                  validators={{
                    onSubmit: ({ value }) =>
                      fieldError({
                        field: definition,
                        value: setupValue({ field: definition, value }),
                      }),
                  }}
                >
                  {(field) => (
                    <SetupControl
                      definition={definition}
                      id={`${fieldId}-destination-${index}`}
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                      errors={field.state.meta.errors}
                    />
                  )}
                </form.Field>
              ))
            );
          }}
        </form.Subscribe>
        <form.Subscribe selector={(state) => state.errors}>
          {(errors) =>
            errors.map((error) => (
              <p key={String(error)} role="alert" className="text-destructive text-sm">
                {String(error)}
              </p>
            ))
          }
        </form.Subscribe>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create sync'}
        </Button>
      </form>
    </>
  );
}

function AccountSelection(input: {
  userId: string;
  service: string;
  value: string;
  onChange(value: string): void;
}) {
  const query = useQuery(providerSetupOptions(input));
  if (query.isPending) {
    return <p className="text-muted-foreground text-sm">Loading accounts…</p>;
  }
  if (query.error) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{query.error.message}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const accounts = query.data.connections
    .filter((entry) => entry.status === 'active' && entry.authType === 'oauth2')
    .map((entry) => ({ ...entry, service: input.service }));
  if (accounts.length < 2) {
    return accounts[0] ? (
      <p className="text-muted-foreground text-sm">Account: {accounts[0].account}</p>
    ) : null;
  }
  return (
    <div className="space-y-2">
      <label htmlFor="sync-account" className="font-medium text-sm">
        Account
      </label>
      <Select
        id="sync-account"
        value={input.value}
        onValueChange={input.onChange}
        options={accounts.map((entry) => ({
          value: entry.id,
          label: accountLabel({
            id: entry.id,
            connections: accounts,
          }),
        }))}
      />
    </div>
  );
}

function accountSelectionError(input: {
  status: Awaited<ReturnType<typeof loadProvider>> | undefined;
  connectionId: string;
}) {
  if (!input.status) {
    return 'Wait for accounts to load, then try again.';
  }
  const accounts = input.status.connections.filter(
    (entry) => entry.status === 'active' && entry.authType === 'oauth2',
  );
  if (
    (accounts.length > 1 || input.connectionId) &&
    !accounts.some((entry) => entry.id === input.connectionId)
  ) {
    return 'Select a connected account for this source.';
  }
}
