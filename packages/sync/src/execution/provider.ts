import type { ConnectionRef, ProviderOperations, ProviderRequirements } from '../models/definition';
import { fail } from '../models/error';
import type { Scope } from '../models/identity';
export interface ProviderGateway {
  bind(
    input: Scope & {
      connection: ConnectionRef;
      requirements: ProviderRequirements;
      signal: AbortSignal;
    },
  ): Promise<ProviderOperations>;
}
export const noProvider: ProviderOperations = {
  action: () => Promise.reject(new Error('operation_denied')),
  download: () => Promise.reject(new Error('operation_denied')),
  get: () => Promise.reject(new Error('operation_denied')),
  post: () => Promise.reject(new Error('operation_denied')),
};
export async function bindProvider(
  input: Scope & {
    gateway?: ProviderGateway;
    connection?: ConnectionRef;
    requirements?: ProviderRequirements;
    signal: AbortSignal;
  },
): Promise<ProviderOperations> {
  if (!input.requirements) {
    return noProvider;
  }
  if (!input.gateway || !input.connection) {
    return fail('connection_required');
  }
  return await input.gateway.bind({
    ...input,
    connection: input.connection,
    requirements: input.requirements,
  });
}
