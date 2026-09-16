import type { RuntimeProviderSetup } from '@oomol-lab/open-connector';
import { BadRequestError } from '#backend/lib/errors.ts';

type OAuthSetup = Extract<RuntimeProviderSetup['auth'][number], { type: 'oauth2' }>;

export function oauthClientValues(input: { auth: OAuthSetup; values: Record<string, string> }) {
  const extra: Record<string, string> = {};
  const secretExtra: Record<string, string> = {};
  for (const field of input.auth.clientFields) {
    if (field.key === 'clientId' || field.key === 'clientSecret') {
      continue;
    }
    const value = input.values[field.key] ?? field.defaultValue;
    if (value !== undefined) {
      (field.location === 'secretExtra' ? secretExtra : extra)[field.key] = value;
    }
  }
  return {
    clientId: input.values.clientId,
    clientSecret: input.values.clientSecret,
    extra,
    secretExtra,
  };
}

export function publicConnection(input: { metadata: Record<string, unknown>; service: string }) {
  const { metadata } = input;
  if (
    typeof metadata.id !== 'string' ||
    metadata.service !== input.service ||
    metadata.status !== 'active'
  ) {
    throw new BadRequestError('Provider connection is unavailable.');
  }
  const account = [metadata.accountLabel, metadata.displayName, metadata.providerAccountId].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return { connectorId: metadata.id, service: input.service, account: account ?? input.service };
}
