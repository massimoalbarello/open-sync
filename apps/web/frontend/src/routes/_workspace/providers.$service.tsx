import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';
import { type loadProvider, providerSetupOptions } from '../../queries/providers';
import { AuthorizationPanel } from './-providers/authorization-panel';
import { OAuthPanel } from './-providers/oauth-panel';

type Section = 'connections' | 'authorization' | 'oauth';

export const Route = createFileRoute('/_workspace/providers/$service')({
  component: ProviderPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { authorization?: 'failed'; section?: Section } => ({
    authorization: search.authorization === 'failed' ? 'failed' : undefined,
    section:
      search.section === 'authorization' || search.section === 'oauth'
        ? search.section
        : 'connections',
  }),
});

function ProviderPage() {
  const { userId } = Route.useRouteContext();
  const { service } = Route.useParams();
  return <Provider key={service} userId={userId} service={service} />;
}

function Provider(input: { userId: string; service: string }) {
  const { authorization, section = 'connections' } = Route.useSearch();
  const query = useQuery(providerSetupOptions(input));
  const status = query.data;
  return (
    <SectionPage
      title={status?.provider.displayName ?? 'Provider'}
      action={
        <Link
          to="/providers"
          search={{ q: '' }}
          className="text-muted-foreground text-sm hover:text-foreground"
        >
          All providers
        </Link>
      }
    >
      <div className="max-w-xl space-y-8">
        {query.isPending && <p className="text-muted-foreground text-sm">Loading provider…</p>}
        {query.error && (
          <div role="alert" className="space-y-3">
            <p>{query.error.message}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {authorization === 'failed' && (
          <p role="alert" className="text-destructive text-sm">
            Authorization did not complete. Connect again to retry.
          </p>
        )}
        {status && (
          <>
            <nav
              aria-label="Provider sections"
              className="flex flex-wrap gap-6 border-border border-b"
            >
              {[
                { id: 'connections' as const, label: 'Connections' },
                { id: 'authorization' as const, label: 'Authorization' },
                ...(status.setup.auth.some((entry) => entry.type === 'oauth2')
                  ? [{ id: 'oauth' as const, label: 'OAuth app' }]
                  : []),
              ].map((entry) => (
                <Link
                  key={entry.id}
                  to="/providers/$service"
                  params={{ service: input.service }}
                  search={{ section: entry.id }}
                  aria-current={section === entry.id ? 'page' : undefined}
                  className={`border-b-2 pb-3 text-sm ${section === entry.id ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {entry.label}
                </Link>
              ))}
            </nav>
            {section === 'connections' && (
              <Connections service={input.service} connections={status.connections} />
            )}
            {section === 'oauth' &&
              status.setup.auth.map(
                (entry) =>
                  entry.type === 'oauth2' && (
                    <OAuthPanel
                      key={entry.type}
                      {...input}
                      auth={entry}
                      client={status.setup.oauthClient}
                    />
                  ),
              )}
            {section === 'authorization' && <AuthorizationPanel {...input} status={status} />}
          </>
        )}
      </div>
    </SectionPage>
  );
}

function Connections({
  service,
  connections,
}: {
  service: string;
  connections: Awaited<ReturnType<typeof loadProvider>>['connections'];
}) {
  return (
    <section aria-labelledby="connections-heading" className="space-y-5">
      <h2 id="connections-heading" className="font-medium">
        Connection status
      </h2>
      {connections.length ? (
        <ul className="divide-y divide-border">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex flex-wrap items-center justify-between gap-4 py-4"
            >
              <p className="text-sm">{connection.account}</p>
              <p className="text-muted-foreground text-sm">
                {connection.status === 'active'
                  ? 'Connected'
                  : connection.status === 'reauth_required'
                    ? 'Authorization required'
                    : 'Unable to check status'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No accounts connected yet.</p>
      )}
      <Link
        to="/providers/$service"
        params={{ service: service }}
        search={{ section: 'authorization' }}
        className="text-sm underline underline-offset-4"
      >
        Connect an account
      </Link>
    </section>
  );
}
