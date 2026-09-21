import { fail } from './error';
import { validate } from './validation';

export interface SourceTimestamps {
  /** Creation time in the source, when known. ISO 8601; delivered as UTC. */
  createdAt?: string;
  /** Last modification time in the source, when known. Never the sync time. */
  updatedAt?: string;
}

export interface RecordMetadata extends SourceTimestamps {
  /** Plain text for listings; acquisition collapses whitespace and keeps at most 200 characters. */
  preview?: string;
}

export function normalizeSourceTimestamps(input: SourceTimestamps): SourceTimestamps {
  const result: SourceTimestamps = {};
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (input[field] !== undefined) {
      validate({ value: input[field], schema: { type: 'string', format: 'date-time' } });
      result[field] = new Date(input[field]).toISOString();
    }
  }
  return result;
}

export function normalizeRecordMetadata(input: RecordMetadata): RecordMetadata {
  const timestamps = normalizeSourceTimestamps(input);
  if (input.preview === undefined) {
    return timestamps;
  }
  if (typeof input.preview !== 'string') {
    return fail('invalid_record_metadata');
  }
  const maxPreviewCharacters = 200;
  return {
    ...timestamps,
    preview: [...input.preview.replace(/\s+/gu, ' ').trim()]
      .slice(0, maxPreviewCharacters)
      .join(''),
  };
}
