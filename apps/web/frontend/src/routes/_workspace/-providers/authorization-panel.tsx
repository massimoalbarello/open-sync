import { Button } from '@repo/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { type loadProvider, providerKeys, saveCredentials } from '../../../queries/providers';
import { authLabels } from './auth-label';
import { CredentialForm } from './credential-form';
import { AuthorizationForm } from './oauth-panel';

export function AuthorizationPanel(input: {
  userId: string;
  service: string;
  status: Awaited<ReturnType<typeof loadProvider>>;
}) {
  const client = useQueryClient();
  const [method, setMethod] = useState<string>();
  const save = useMutation({
    mutationFn: saveCredentials,
    onSuccess: () => client.invalidateQueries({ queryKey: providerKeys.setup(input) }),
  });
  const { status } = input;
  const auth = status.setup.auth.find((entry) => entry.type === method) ?? status.setup.auth[0];
  return (
    <section aria-labelledby="authorization-heading" className="space-y-5">
      <h2 id="authorization-heading" className="font-medium">
        Connect an account
      </h2>
      {status.setup.auth.length > 1 && (
        <fieldset className="flex flex-wrap gap-2" aria-label="Authentication methods">
          {status.setup.auth.map((entry) => (
            <Button
              key={entry.type}
              variant={entry.type === auth?.type ? 'secondary' : 'ghost'}
              aria-pressed={entry.type === auth?.type}
              onClick={() => {
                setMethod(entry.type);
                save.reset();
              }}
            >
              {authLabels[entry.type]}
            </Button>
          ))}
        </fieldset>
      )}
      {auth?.type === 'oauth2' &&
        (status.setup.oauthClient?.configured ? (
          <AuthorizationForm
            service={input.service}
            auth={auth}
            name={status.provider.displayName}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Configure the{' '}
            <Link
              to="/providers/$service"
              params={{ service: input.service }}
              search={{ section: 'oauth' }}
              className="text-foreground underline underline-offset-4"
            >
              OAuth app
            </Link>{' '}
            before connecting an account.
          </p>
        ))}
      {(auth?.type === 'api_key' || auth?.type === 'custom_credential') && (
        <>
          {save.error && (
            <p role="alert" className="text-destructive text-sm">
              {save.error.message}
            </p>
          )}
          {save.isSuccess && (
            <p role="status" className="text-sm">
              Account connected.
            </p>
          )}
          <CredentialForm
            key={auth.type}
            fields={auth.fields}
            label={`Connect ${status.provider.displayName}`}
            onSubmit={(values) =>
              save.mutateAsync({ service: input.service, authType: auth.type, values })
            }
          />
        </>
      )}
      {auth?.type === 'no_auth' && (
        <p className="text-muted-foreground text-sm">This provider does not require credentials.</p>
      )}
    </section>
  );
}
