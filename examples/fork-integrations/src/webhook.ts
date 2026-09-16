import type { DestinationType } from '@open-sync/core/delivery';
import { createHttpDestination } from '@open-sync/http-delivery';
import { markdownRecord } from './record';

/** Opt-in Markdown receiver convention. Authentication and endpoint selection belong to the host. */
export function createMarkdownWebhook(
  input: Parameters<typeof createHttpDestination>[0],
): DestinationType {
  const transport = createHttpDestination(input);
  return {
    ...transport,
    version: `markdown-1:${transport.version}`,
    create(scope) {
      const handler = transport.create(scope);
      return {
        deliver(attempt) {
          attempt.signal.throwIfAborted();
          if (
            attempt.delivery.deliverable.records.some(
              (record) =>
                record.operation === 'upsert' && !markdownRecord.safeParse(record.data).success,
            )
          ) {
            return Promise.resolve({ status: 'rejected', code: 'invalid_markdown_record' });
          }
          return handler.deliver(attempt);
        },
      };
    },
  };
}
