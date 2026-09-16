import { Button } from '@repo/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { sessionOptions, signOut } from '../queries/session';

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionOptions);
    if (!session) {
      throw redirect({ to: '/login' });
    }
    return { userId: session.user.id };
  },
  component: Dashboard,
});

function Dashboard() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      client.clear();
      await navigate({ to: '/login' });
    },
  });
  return (
    <main className="mx-auto max-w-5xl space-y-12 px-6 py-10 sm:py-16">
      <header className="flex items-center justify-between gap-4">
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          Open Sync
        </span>
        <Button variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()}>
          Sign out
        </Button>
      </header>
      <section className="space-y-3">
        <p className="text-muted-foreground text-sm">Your workspace</p>
        <h1 className="font-semibold text-4xl tracking-tight">Sync dashboard</h1>
        <p className="max-w-xl text-muted-foreground">
          Follow your data from its source to its destination.
        </p>
      </section>
      {logout.error && (
        <p role="alert" className="text-destructive">
          {logout.error.message}
        </p>
      )}
      <div className="divide-y divide-border">
        <section aria-labelledby="providers-heading" className="grid gap-4 py-8 sm:grid-cols-3">
          <h2 id="providers-heading" className="font-medium text-lg">
            Providers
          </h2>
          <div className="space-y-2 sm:col-span-2">
            <p>No providers connected</p>
            <p className="text-muted-foreground text-sm">
              Provider connections will appear here when setup is available.
            </p>
          </div>
        </section>
        <section aria-labelledby="syncs-heading" className="grid gap-4 py-8 sm:grid-cols-3">
          <h2 id="syncs-heading" className="font-medium text-lg">
            Syncs
          </h2>
          <div className="space-y-2 sm:col-span-2">
            <p>No syncs yet</p>
            <p className="text-muted-foreground text-sm">
              Your syncs and their latest progress will appear here.
            </p>
          </div>
        </section>
        <section aria-labelledby="delivery-heading" className="grid gap-4 py-8 sm:grid-cols-3">
          <h2 id="delivery-heading" className="font-medium text-lg">
            Delivery queue
          </h2>
          <div className="space-y-2 sm:col-span-2">
            <p>Nothing waiting for delivery</p>
            <p className="text-muted-foreground text-sm">
              Pending deliveries and items that need attention will appear here.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
