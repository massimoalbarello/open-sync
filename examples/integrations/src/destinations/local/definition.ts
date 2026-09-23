import type { Scope } from '@context-use/open-sync';
import type { Deliverable, DestinationType } from '@context-use/open-sync/delivery';

/** The receiver durably owns the original bundle and its asset bytes before acceptance. */
export function localDestination(input: {
  accept(input: { scope: Scope; deliverable: Deliverable; signal: AbortSignal }): Promise<void>;
}): DestinationType {
  return {
    name: 'Local SQLite',
    description: 'Stores complete deliverables in this application.',
    configSchema: { type: 'object', additionalProperties: false },
    async deliver({ scope, deliverable, signal }) {
      signal.throwIfAborted();
      await input.accept({ scope, deliverable, signal });
      return { status: 'accepted' };
    },
  };
}
