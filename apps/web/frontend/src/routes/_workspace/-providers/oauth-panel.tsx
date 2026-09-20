import type { ProviderSetup as RuntimeProviderSetup } from '@context-use/open-sync';
import { Button } from '@repo/ui/button';
import { Checkbox } from '@repo/ui/checkbox';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { configureOAuth, connectProvider, providerKeys } from '../../../queries/providers';
import { CredentialForm } from './credential-form';

type OAuth = Extract<RuntimeProviderSetup['auth'][number], { type: 'oauth2' }>;

function changePermission(input: {
  options: NonNullable<OAuth['authorizationOptions']>;
  selected: string[];
  option: NonNullable<OAuth['authorizationOptions']>[number];
  checked: boolean;
}) {
  const selected = new Set(input.selected);
  if (input.checked) {
    selected.add(input.option.id);
    for (const required of input.option.requires ?? []) {
      selected.add(required);
    }
  } else {
    selected.delete(input.option.id);
    for (const other of input.options) {
      if (!other.required && other.requires?.includes(input.option.id)) {
        selected.delete(other.id);
      }
    }
  }
  return [...selected];
}

export function AuthorizationForm(input: {
  service: string;
  connectionId?: string;
  auth: OAuth;
  disabled: boolean;
}) {
  const id = useId();
  const connect = useMutation({
    mutationFn: connectProvider,
    onSuccess: (result) => window.location.assign(result.authorizationUrl),
  });
  const options = input.auth.authorizationOptions;
  const form = useForm({
    defaultValues: {
      selected:
        options
          ?.filter((option) => option.required || option.defaultSelected)
          .map((option) => option.id) ?? [],
    },
    onSubmit: async ({ value }) => {
      await connect.mutateAsync({
        service: input.service,
        connectionId: input.connectionId,
        authorizationOptionIds: options ? value.selected : undefined,
      });
    },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      {options && (
        <details>
          <summary className="cursor-pointer text-muted-foreground text-sm">Permissions</summary>
          <fieldset className="mt-4 space-y-4">
            <legend className="sr-only">Permissions</legend>
            <form.Field name="selected">
              {(field) =>
                options.map((option) => (
                  <label
                    htmlFor={`${id}-${option.id}`}
                    key={option.id}
                    className="flex items-start gap-3 text-sm"
                  >
                    <Checkbox
                      id={`${id}-${option.id}`}
                      className="mt-0.5"
                      checked={field.state.value.includes(option.id)}
                      disabled={option.required}
                      onCheckedChange={(checked) => {
                        field.handleChange(
                          changePermission({
                            options,
                            selected: field.state.value,
                            option,
                            checked,
                          }),
                        );
                      }}
                    />
                    <span>
                      <span className="font-medium">
                        {option.label}
                        {option.required && ' (required)'}
                      </span>
                      <span className="mt-1 block text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))
              }
            </form.Field>
          </fieldset>
        </details>
      )}
      {connect.error && (
        <p role="alert" className="text-destructive text-sm">
          {connect.error.message}
        </p>
      )}
      <Button type="submit" disabled={connect.isPending || input.disabled}>
        {connect.isPending
          ? 'Connecting…'
          : input.connectionId
            ? 'Reconnect account'
            : 'Connect account'}
      </Button>
    </form>
  );
}

export function OAuthPanel(input: {
  service: string;
  userId: string;
  auth: OAuth;
  client: RuntimeProviderSetup['oauthClient'];
}) {
  const [editing, setEditing] = useState(false);
  const client = useQueryClient();
  const configure = useMutation({
    mutationFn: configureOAuth,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: providerKeys.setup(input) });
      setEditing(false);
    },
  });
  const showFields = !input.client?.configured || editing;
  return (
    <section aria-labelledby="oauth-heading" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 id="oauth-heading" className="font-medium">
          OAuth app
        </h2>
        {!showFields && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit OAuth app
          </Button>
        )}
      </div>
      {!showFields && <p className="text-muted-foreground text-sm">OAuth app configured.</p>}
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Authorization callback URL</p>
        <code className="block break-all">{input.client?.expectedRedirectUri}</code>
      </div>
      {showFields && (
        <div className="space-y-5">
          {input.auth.clientSetup?.docsUrl && (
            <a
              href={input.auth.clientSetup.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline underline-offset-4"
            >
              Provider setup instructions
            </a>
          )}
          {configure.error && (
            <p role="alert" className="text-destructive text-sm">
              {configure.error.message}
            </p>
          )}
          <CredentialForm
            fields={input.auth.clientFields}
            label="Save OAuth app"
            onSubmit={(values) => configure.mutateAsync({ service: input.service, values })}
          />
          {editing && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
