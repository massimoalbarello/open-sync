import type { Auth } from '#backend/lib/auth/better-auth.ts';
export async function authorizeSyncRequest(input: {
  request: Request;
  auth: Auth;
  origins: readonly string[];
}) {
  if (
    !['GET', 'HEAD'].includes(input.request.method) &&
    !input.origins.includes(input.request.headers.get('origin') ?? '')
  ) {
    return null;
  }
  const session = await input.auth.getSession({ headers: input.request.headers });
  return session ? { actorId: session.user.id, ownerId: session.user.id } : null;
}
