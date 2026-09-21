import { Button } from '@repo/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { type loadProvider, providerKeys, saveCredentials } from '../../../queries/providers';
import { syncKeys } from '../../../queries/sync';
import { accountActionLabel, authLabels } from './auth-label';
import { CredentialForm } from './credential-form';
import { AuthorizationForm, OAuthPanel } from './oauth-panel';

export function AuthorizationPanel(input: {
  userId: string;
  service: string;
  connectionId?: string;
  oauthOnly?: boolean;
  status: Awaited<ReturnType<typeof loadProvider>>;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const target = input.status.connections.find((entry) => entry.id === input.connectionId);
  const [method, setMethod] = useState<string>(target?.authType ?? 'oauth2');
  const save = useMutation({
    mutationFn: saveCredentials,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: providerKeys.setup(input) });
      await client.invalidateQueries({ queryKey: syncKeys.owner(input.userId) });
      if (input.connectionId) {
        await navigate({
          to: '/providers/$service',
          params: { service: input.service },
          search: (previous) => ({ syncId: previous.syncId }),
        });
      }
    },
  });
  const { status } = input;
  const methods = input.oauthOnly
    ? status.setup.auth.filter((entry) => entry.type === 'oauth2')
    : status.setup.auth;
  const auth = methods.find((entry) => entry.type === method) ?? methods[0];
  if (input.connectionId && !target?.authType) {
    return <p role="alert">This account is unavailable. Reload the provider page to try again.</p>;
  }
  const accounts = status.connections.filter((connection) => connection.authType === auth?.type);
  const manualOAuth = auth?.type === 'oauth2' && !status.setup.oauthClient?.automaticRegistration;
  return (
    <div className="space-y-8">
      {!target && methods.length > 1 && (
        <fieldset
          className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1"
          aria-label="Authentication methods"
        >
          {methods.map((entry) => (
            <Button
              key={entry.type}
              variant={entry.type === auth?.type ? 'default' : 'ghost'}
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
      {manualOAuth && <OAuthPanel {...input} auth={auth} client={status.setup.oauthClient} />}
      <section
        aria-labelledby="accounts-heading"
        className={manualOAuth ? 'space-y-6 border-t pt-8' : 'space-y-6'}
      >
        <h2 id="accounts-heading" className="font-medium">
          Accounts
        </h2>
        <ConnectedAccounts service={input.service} accounts={accounts} target={target} />
        {auth?.type === 'oauth2' && (
          <AuthorizationForm
            service={input.service}
            connectionId={input.connectionId}
            hasAccounts={accounts.length > 0}
            auth={auth}
            client={status.setup.oauthClient}
          />
        )}
        {(auth?.type === 'api_key' || auth?.type === 'custom_credential') && (
          <>
            {save.error && (
              <p role="alert" className="text-destructive text-sm">
                {save.error.message}
              </p>
            )}
            <CredentialForm
              key={auth.type}
              fields={auth.fields}
              label={accountActionLabel({
                connectionId: input.connectionId,
                hasAccounts: accounts.length > 0,
              })}
              onSubmit={(values) =>
                save.mutateAsync({
                  service: input.service,
                  connectionId: input.connectionId,
                  authType: auth.type,
                  values,
                })
              }
            />
          </>
        )}
        {auth?.type === 'no_auth' && (
          <p className="text-muted-foreground text-sm">No credentials needed.</p>
        )}
      </section>
    </div>
  );
}

function ConnectedAccounts(input: {
  service: string;
  accounts: Awaited<ReturnType<typeof loadProvider>>['connections'];
  target?: Awaited<ReturnType<typeof loadProvider>>['connections'][number];
}) {
  if (input.target) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium text-sm">Reconnect {input.target.account}</h3>
          <Link
            to="/providers/$service"
            params={{ service: input.service }}
            search={(previous) => ({ syncId: previous.syncId })}
            className="text-muted-foreground text-sm underline underline-offset-4"
          >
            Back to accounts
          </Link>
        </div>
        <p className="text-muted-foreground text-sm">
          Use the same account to keep your existing syncs.
        </p>
      </div>
    );
  }
  if (!input.accounts.length) {
    return <p className="text-muted-foreground text-sm">No account connected.</p>;
  }
  return (
    <ul className="divide-y">
      {input.accounts.map((connection) => (
        <li key={connection.id} className="flex items-center justify-between gap-4 py-4 first:pt-0">
          <div className="space-y-1 text-sm">
            <p className="font-medium">{connection.account}</p>
            <p className="flex items-center gap-2 text-muted-foreground">
              {connection.status === 'active' ? (
                <>
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                  Connected
                </>
              ) : (
                'Needs attention'
              )}
            </p>
          </div>
          <Link
            to="/providers/$service"
            params={{ service: input.service }}
            search={(previous) => ({ syncId: previous.syncId, connectionId: connection.id })}
            className="text-sm underline underline-offset-4"
          >
            Reconnect
          </Link>
        </li>
      ))}
    </ul>
  );
}
