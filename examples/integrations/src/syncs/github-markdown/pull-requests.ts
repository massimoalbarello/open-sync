import type { SyncContext } from '@open-sync/core/definition';
import { acquire } from '../github/acquisition/pull-requests';
import { hydrate } from './hydrate';

/** Markdown hydration is independent of the shared GitHub acquisition/checkpoint flow. */
export function run(context: SyncContext) {
  return acquire({ context, readRecord: hydrate });
}
