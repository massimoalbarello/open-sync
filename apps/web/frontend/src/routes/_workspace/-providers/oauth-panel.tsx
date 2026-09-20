import type { ProviderSetup as RuntimeProviderSetup } from '@context-use/open-sync';
import { Button } from '@repo/ui/button';
import { Checkbox } from '@repo/ui/checkbox';
import { Input } from '@repo/ui/input';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { configureOAuth, connectProvider, providerKeys } from '../../../queries/providers';
import { CredentialForm } from './credential-form';

type OAuth = Extract<RuntimeProviderSetup['auth'][number], { type: 'oauth2' }>;

async function startAuthorization({
  intent,
  ...input
}: Parameters<typeof connectProvider>[0] & { intent: 'open' | 'copy' }) {
  const result = await connectProvider(input);
  if (intent === 'open') {
    window.location.assign(result.authorizationUrl);
    return null;
  }
  try {
    await navigator.clipboard.writeText(result.authorizationUrl);
    return { ...result, copied: true };
  } catch {
    return { ...result, copied: false };
  }
}

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
  client: RuntimeProviderSetup['oauthClient'];
}) {
  const id = useId();
  const connect = useMutation({ mutationFn: startAuthorization });
  const options = input.auth.authorizationOptions;
  const form = useForm({
    onSubmitMeta: 'open' as 'open' | 'copy',
    defaultValues: {
      selected:
        options
          ?.filter((option) => option.required || option.defaultSelected)
          .map((option) => option.id) ?? [],
    },
    onSubmit: async ({ value, meta }) => {
      await connect.mutateAsync({
        intent: meta,
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
          <fieldset className="mt-4 space-y-4" disabled={connect.isPending}>
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
                        connect.reset();
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
      <fieldset
        className="flex flex-wrap items-center gap-3"
        disabled={
          connect.isPending || !(input.client?.configured || input.client?.automaticRegistration)
        }
      >
        <legend className="sr-only">Authorize account</legend>
        <Button type="submit">
          {input.connectionId ? 'Reconnect account' : 'Connect account'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void form.handleSubmit('copy').catch(() => undefined)}
        >
          Copy authorization link
        </Button>
      </fieldset>
      {connect.isPending && (
        <p role="status" className="text-muted-foreground text-sm">
          Preparing authorization…
        </p>
      )}
      {connect.data && (
        <div className="space-y-2">
          <p role="status" className="text-muted-foreground text-sm">
            {connect.data.copied
              ? 'Authorization link copied.'
              : 'Could not copy automatically. Select and copy the link below.'}
          </p>
          {!connect.data.copied && (
            <Input
              aria-label="Authorization link"
              readOnly
              value={connect.data.authorizationUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </div>
      )}
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
