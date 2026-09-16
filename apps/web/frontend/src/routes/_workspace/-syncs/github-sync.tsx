import { Button } from '@repo/ui/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createGithubSync, githubConnectionsOptions, syncKeys } from '../../../queries/sync';

export function GithubSync(input: { userId: string; onCreated(): void }) {
  const client = useQueryClient();
  const accounts = useQuery(githubConnectionsOptions(input.userId));
  const create = useMutation({
    mutationFn: createGithubSync,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: syncKeys.owner(input.userId) });
      input.onCreated();
    },
  });
  const error = accounts.error || create.error;
  return (
    <section
      aria-labelledby="github-sync-heading"
      className="mb-8 max-w-xl space-y-4 rounded-xl border border-border p-5"
    >
      <h2 id="github-sync-heading" className="font-medium">
        GitHub pull requests
      </h2>
      <p className="text-muted-foreground text-sm">
        Sync authored pull request descriptions and metadata every 15 minutes. Deliverables are
        saved locally and printed to the server log.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
      {accounts.isPending && <p className="text-muted-foreground text-sm">Loading accounts…</p>}
      {accounts.error && (
        <Button variant="outline" onClick={() => void accounts.refetch()}>
          Try again
        </Button>
      )}
      {accounts.data?.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Connect a GitHub account to create this sync.
        </p>
      )}
      <ul className="divide-y divide-border">
        {accounts.data?.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="text-sm">{account.account}</span>
            <Button disabled={create.isPending} onClick={() => create.mutate(account.id)}>
              Sync pull requests
            </Button>
          </li>
        ))}
      </ul>
      <Link
        to="/providers/$service"
        params={{ service: 'github' }}
        search={{ section: 'connections' }}
        className="text-sm underline underline-offset-4"
      >
        Manage GitHub connections
      </Link>
    </section>
  );
}
