import rangeParser from 'range-parser';
import type { ReceiverService } from '#backend/services/receiver/service.ts';

const partialContent = 206;
const success = 200;

/** File reads stay lazy; byte ranges let media players seek without buffering the asset. */
export function assetResponse(input: {
  asset: NonNullable<Awaited<ReturnType<ReceiverService['asset']>>>;
  range: string | null;
}) {
  const { asset } = input;
  const headers = new Headers({
    'content-type': asset.mediaType,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'private, no-store',
    'accept-ranges': 'bytes',
  });
  const ranges = input.range ? rangeParser(asset.size, input.range, { combine: true }) : undefined;
  if (ranges === -1) {
    headers.set('content-range', `bytes */${asset.size}`);
    return new Response(null, { status: 416, headers });
  }
  // Ignore malformed/unsupported or multipart ranges, as allowed by HTTP.
  const range =
    ranges && typeof ranges !== 'number' && ranges.type === 'bytes' && ranges.length === 1
      ? ranges[0]
      : undefined;
  const body = asset.open(range ? { start: range.start, end: range.end + 1 } : undefined);
  headers.set('content-length', String(range ? range.end - range.start + 1 : asset.size));
  if (range) {
    headers.set('content-range', `bytes ${range.start}-${range.end}/${asset.size}`);
  }
  return new Response(body, { status: range ? partialContent : success, headers });
}
