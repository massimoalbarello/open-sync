import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import {
  ArrowRightLeft,
  Database,
  Download,
  ListChecks,
  LogOut,
  Menu,
  Plug,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { sessionOptions, signOut } from '../queries/session';

export const Route = createFileRoute('/_workspace')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionOptions);
    if (!session) {
      throw redirect({ to: '/login' });
    }
    return { userId: session.user.id };
  },
  component: Workspace,
});

const sections = [
  { to: '/providers', label: 'Providers', icon: Plug },
  { to: '/syncs', label: 'Syncs', icon: RefreshCw },
  { to: '/records', label: 'Records', icon: Database },
  { to: '/delivery', label: 'Queue', icon: ListChecks },
  { to: '/sources', label: 'Sources', icon: Download },
  { to: '/destinations', label: 'Destinations', icon: Upload },
] as const;

function Workspace() {
  const [menuOpen, setMenuOpen] = useState(false);
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
    <div className="min-h-dvh bg-sidebar md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="flex flex-col md:sticky md:top-0 md:h-dvh">
        <div className="flex h-16 items-center justify-between px-4">
          <Link to="/syncs" className="flex items-center gap-3 font-semibold text-lg">
            <ArrowRightLeft aria-hidden="true" className="size-6" />
            Open Sync
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu aria-hidden="true" />
          </Button>
        </div>
        <div
          id="workspace-navigation"
          className={cn('flex-1 flex-col md:flex', menuOpen ? 'flex' : 'hidden')}
        >
          <nav aria-label="Workspace" className="grid gap-1 px-2 py-4">
            {sections.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMenuOpen(false)}
                activeProps={{ 'aria-current': 'page' }}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[status=active]:bg-card data-[status=active]:text-foreground data-[status=active]:shadow-sm"
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
              </Link>
            ))}
          </nav>
          <footer className="mt-auto p-4">
            <Button variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()}>
              <LogOut aria-hidden="true" /> Sign out
            </Button>
            {logout.error && (
              <p role="alert" className="mt-3 text-destructive text-sm">
                {logout.error.message}
              </p>
            )}
          </footer>
        </div>
      </aside>
      <main className="min-h-[calc(100dvh-4rem)] min-w-0 border-border bg-background md:min-h-dvh md:border-l">
        <Outlet />
      </main>
    </div>
  );
}
