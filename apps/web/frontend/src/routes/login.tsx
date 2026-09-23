import { Button } from '@repo/ui/button';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { AnimatedOpenSyncLogo } from '../components/brand/animated-open-sync-logo';
import { OpenSyncLogo } from '../components/brand/open-sync-logo';
import { registerAccount, registrationOptions, sessionOptions, signIn } from '../queries/session';
export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.fetchQuery(sessionOptions)) {
      throw redirect({ to: '/' });
    }
  },
  loader: ({ context }) => context.queryClient.fetchQuery(registrationOptions),
  component: Login,
});
function Login() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data: registration } = useSuspenseQuery(registrationOptions);
  const completed = async () => {
    client.clear();
    await navigate({ to: '/' });
  };
  const register = useMutation({
    mutationFn: registerAccount,
    onSuccess: completed,
    onError: () => client.invalidateQueries({ queryKey: registrationOptions.queryKey }),
  });
  const login = useMutation({ mutationFn: signIn, onSuccess: completed });
  const pending = register.isPending || login.isPending;
  return (
    <main className="grid min-h-dvh grid-rows-[45dvh_1fr] lg:grid-cols-2 lg:grid-rows-1">
      <div className="dark relative lg:sticky lg:top-0 lg:h-dvh">
        <AnimatedOpenSyncLogo className="absolute inset-0 size-full" />
        <div className="absolute top-6 left-6 z-10 flex items-center gap-2.5 font-semibold text-foreground text-lg sm:top-8 sm:left-8">
          <OpenSyncLogo className="size-8" />
          Open Sync
        </div>
      </div>
      <section className="flex min-w-0 items-center justify-center bg-background px-6 py-12 sm:px-10 lg:px-16">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
            {registration.ownerRegistered ? 'Welcome back' : 'First-time setup'}
          </p>
          <div className="space-y-4">
            <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">
              {registration.ownerRegistered ? 'Sign in' : 'Your data. Kept in sync.'}
            </h1>
            <p className="text-lg text-muted-foreground">
              One place to manage your providers, follow your syncs, and check delivery.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3">
            {registration.ownerRegistered ? (
              <Button size="lg" disabled={pending} onClick={() => login.mutate()}>
                {login.isPending ? 'Signing in…' : 'Sign in with a passkey'}
              </Button>
            ) : (
              <>
                <Button size="lg" disabled={pending} onClick={() => register.mutate()}>
                  {register.isPending ? 'Creating your account…' : 'Create account with a passkey'}
                </Button>
                <p className="text-muted-foreground text-sm">
                  Your passkey will make you the owner of this Open Sync instance.
                </p>
              </>
            )}
          </div>
          {(register.error || login.error) && (
            <p role="alert" className="text-destructive">
              {(register.error || login.error)?.message}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            Use your fingerprint, face, or device lock. No password to remember.
          </p>
        </div>
      </section>
    </main>
  );
}
