import { Button } from '@repo/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { registerAccount, sessionOptions, signIn } from '../queries/session';
export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.fetchQuery(sessionOptions)) {
      throw redirect({ to: '/' });
    }
  },
  component: Login,
});
function Login() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const completed = async () => {
    client.clear();
    await navigate({ to: '/' });
  };
  const register = useMutation({ mutationFn: registerAccount, onSuccess: completed });
  const login = useMutation({ mutationFn: signIn, onSuccess: completed });
  const pending = register.isPending || login.isPending;
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-8 px-6 py-16">
      <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
        Notebook / Your own space
      </p>
      <div className="space-y-4">
        <h1 className="font-semibold text-5xl tracking-tight">
          A little room
          <br />
          for your thoughts.
        </h1>
        <p className="text-lg text-muted-foreground">
          Save what matters. Your notes stay in your account, ready when you need them.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3">
        <Button size="lg" disabled={pending} onClick={() => register.mutate()}>
          {register.isPending ? 'Creating your account…' : 'Create account with a passkey'}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => login.mutate()}>
          {login.isPending ? 'Signing in…' : 'Sign in with a passkey'}
        </Button>
      </div>
      {(register.error || login.error) && (
        <p role="alert" className="text-destructive">
          {(register.error || login.error)?.message}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Use your fingerprint, face, or device lock. No password to remember.
      </p>
    </main>
  );
}
