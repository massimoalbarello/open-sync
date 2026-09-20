import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { SectionPage } from '../../components/section-page';
import { providerSetupOptions } from '../../queries/providers';
import { AuthorizationPanel } from './-providers/authorization-panel';

export const Route = createFileRoute('/_workspace/providers/$service')({
  component: ProviderPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { authorization?: 'failed'; syncId?: string; connectionId?: string } => ({
    authorization: search.authorization === 'failed' ? 'failed' : undefined,
    syncId: typeof search.syncId === 'string' ? search.syncId : undefined,
    connectionId: typeof search.connectionId === 'string' ? search.connectionId : undefined,
  }),
});
function ProviderPage() {
  const { userId } = Route.useRouteContext();
  const { service } = Route.useParams();
  return <Provider key={service} userId={userId} service={service} />;
}
function Provider(input: { userId: string; service: string }) {
  const { authorization, syncId, connectionId } = Route.useSearch();
  const query = useQuery(providerSetupOptions(input));
  const status = query.data;
  const connected =
    status?.connections.filter(
      (connection) =>
        connection.status === 'active' && (!syncId || connection.authType === 'oauth2'),
    ) ?? [];
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
      <div className="max-w-2xl space-y-8">
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
        {syncId && !connected.length && (
          <p className="rounded-lg bg-muted p-4 text-sm">
            Your sync is saved. Connect your account to start syncing.
          </p>
        )}
        {status && (
          <>
            <AuthorizationPanel
              key={connectionId ?? 'new'}
              {...input}
              status={status}
              connectionId={connectionId}
              oauthOnly={!!syncId && !connectionId}
            />
            {!!connected.length &&
              (syncId ? (
                <Link
                  to="/syncs/$id"
                  params={{ id: syncId }}
                  className="inline-block text-sm underline underline-offset-4"
                >
                  View sync
                </Link>
              ) : (
                <Link to="/syncs" className="inline-block text-sm underline underline-offset-4">
                  View syncs
                </Link>
              ))}
          </>
        )}
      </div>
    </SectionPage>
  );
}
