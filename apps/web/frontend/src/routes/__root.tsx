import { Button } from '@repo/ui/button';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  pendingComponent: () => (
    <main className="p-8" aria-live="polite">
      Loading…
    </main>
  ),
  errorComponent: ({ reset }) => (
    <main className="space-y-4 p-8">
      <h1>Something went wrong</h1>
      <Button onClick={reset}>Try again</Button>
    </main>
  ),
  notFoundComponent: () => (
    <main className="space-y-4 p-8">
      <h1>Page not found</h1>
      <Link to="/">Go to your dashboard</Link>
    </main>
  ),
});
