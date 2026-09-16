import { passkey } from '@better-auth/passkey';
import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { betterAuth } from 'better-auth';
import { APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import type { SQL } from 'bun';

export function createAuth(input: {
  database: SQL;
  baseUrl: URL;
  nibrunHostname?: string;
  secret: string;
}) {
  const rpUrl = input.nibrunHostname ? new URL(`https://${input.nibrunHostname}`) : input.baseUrl;
  const trustedOrigins = [...new Set([rpUrl.origin, input.baseUrl.origin])];
  const auth = betterAuth({
    database: bunSqlAdapter({ sql: input.database, tablesPrefix: 'auth_' }),
    baseURL: input.baseUrl.origin,
    basePath: '/api/auth',
    secret: input.secret,
    trustedOrigins,
    plugins: [
      passkey({
        rpID: rpUrl.hostname,
        rpName: 'Open Sync',
        origin: trustedOrigins,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        registration: {
          requireSession: false,
          resolveUser: async ({ ctx }) => {
            if ((await ctx.context.internalAdapter.listUsers(1)).length) {
              throw registrationClosed();
            }
            const id = Bun.randomUUIDv7();
            return { id, name: id, displayName: 'My account' };
          },
          afterVerification: async ({ ctx, verification, user }) => {
            if (verification.registrationInfo?.userVerified !== true) {
              throw APIError.from('UNAUTHORIZED', {
                code: 'USER_VERIFICATION_REQUIRED',
                message: 'User verification is required.',
              });
            }
            const session = await getAuthoritativeSessionFromCtx(ctx);
            if (session) {
              if (session.user.id !== user.id) {
                throw APIError.from('FORBIDDEN', {
                  code: 'ACCOUNT_MISMATCH',
                  message: 'Account mismatch.',
                });
              }
              return { userId: session.user.id };
            }
            if ((await ctx.context.internalAdapter.listUsers(1)).length) {
              throw registrationClosed();
            }
            // Better Auth wraps user, passkey and session persistence in one transaction only
            // when createSession is requested. A failed registration must leave no owner.
            if (ctx.body.createSession !== true) {
              throw APIError.from('BAD_REQUEST', {
                code: 'SESSION_REQUIRED',
                message: 'Owner registration must create a session.',
              });
            }
            // The challenged identity is server-generated. Create it only after WebAuthn proof.
            await ctx.context.internalAdapter.createUser(
              {
                id: user.id,
                name: 'My account',
                email: `${user.id}@accounts.invalid`,
                emailVerified: false,
              },
              { method: 'passkey' },
            );
            return { userId: user.id };
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw APIError.from('UNAUTHORIZED', {
                code: 'USER_VERIFICATION_REQUIRED',
                message: 'User verification is required.',
              });
            }
          },
        },
      }),
    ],
    advanced: { database: { generateId: () => Bun.randomUUIDv7() } },
  });
  return {
    handler: (request: Request) => auth.handler(request),
    getSession: (input: { headers: Headers }) => auth.api.getSession(input),
    async registrationStatus() {
      const context = await auth.$context;
      return { ownerRegistered: (await context.internalAdapter.listUsers(1)).length > 0 };
    },
  };
}
function registrationClosed() {
  return APIError.from('FORBIDDEN', {
    code: 'OWNER_ALREADY_REGISTERED',
    message: 'This Open Sync instance already has an owner. Sign in with your passkey.',
  });
}
export type Auth = ReturnType<typeof createAuth>;
