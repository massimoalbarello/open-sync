import { queryOptions } from '@tanstack/react-query';
import type { DocumentPreview } from '../routes/_workspace/-assets/document-worker';
import type { PreviewFormat } from '../routes/_workspace/-assets/format';
import { assetKeys } from './assets';

export const documentByteLimit = 20_971_520;
const previewTimeout = 20_000;

export function assetPreviewOptions(input: { userId: string; id: string; format: PreviewFormat }) {
  return queryOptions({
    queryKey: [...assetKeys.owner(input.userId), 'preview', input.id, input.format],
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      // Binary content has its own HTTP representation; JSON endpoints use the typed API client.
      const response = await fetch(`/api/receiver/assets/${encodeURIComponent(input.id)}`, {
        signal,
      });
      if (!response.ok) {
        throw new Error('Could not load this file.');
      }
      const blob = await response.blob();
      if (blob.size > documentByteLimit) {
        throw new Error(
          'This file is too large for an in-browser document preview. Download it to view the full file.',
        );
      }
      return parseDocument({ buffer: await blob.arrayBuffer(), format: input.format, signal });
    },
  });
}
function parseDocument(input: { buffer: ArrayBuffer; format: PreviewFormat; signal: AbortSignal }) {
  // biome-ignore lint/complexity/useMaxParams: Promise supplies resolve and reject.
  return new Promise<DocumentPreview>((resolve, reject) => {
    input.signal.throwIfAborted();
    const worker = new Worker(
      new URL('../routes/_workspace/-assets/document-worker.ts', import.meta.url),
      { type: 'module' },
    );
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timeout);
      input.signal.removeEventListener('abort', abort);
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const abort = () => fail('Preview cancelled.');
    const timeout = setTimeout(
      () => fail('This file is taking too long to preview. Download it to view the full file.'),
      previewTimeout,
    );
    input.signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => fail('Could not prepare this preview. Download the file to open it.');
    worker.onmessage = (event: MessageEvent<{ preview: DocumentPreview } | { error: string }>) => {
      if ('error' in event.data) {
        fail(event.data.error);
        return;
      }
      cleanup();
      resolve(event.data.preview);
    };
    worker.postMessage({ buffer: input.buffer, format: input.format }, [input.buffer]);
  });
}
