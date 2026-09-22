import { SyncError } from '../models/error';
import type { JsonValue } from '../models/json';
import { connectorFailure } from './failure';

/** File IDs come only from a just-authorized action, never from source-supplied URLs. */
export async function downloadFile(input: {
  file: JsonValue;
  service: string;
  operation: string;
  fetch(request: Request): Promise<Response>;
  baseUrl: string;
  adminToken: string;
  runtimeToken: string;
  signal: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const fileId =
    input.file && typeof input.file === 'object' && !Array.isArray(input.file)
      ? input.file.fileId
      : undefined;
  if (typeof fileId !== 'string' || !/^[a-f0-9]{32}(?:\.[a-z0-9]{1,16})?$/.test(fileId)) {
    throw connectorFailure({ ...input, kind: 'invalid_response' });
  }
  const url = `${input.baseUrl.replace(/\/$/, '')}/api/files/${encodeURIComponent(fileId)}`;
  const remove = async () => {
    // Cleanup must outlive caller cancellation. Connector expiry remains the fallback on failure.
    const timeoutMs = 5000;
    await input
      .fetch(
        new Request(url, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${input.adminToken}` },
          signal: AbortSignal.timeout(timeoutMs),
        }),
      )
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
  };
  let response: Response;
  try {
    input.signal.throwIfAborted();
    response = await input.fetch(
      new Request(url, {
        headers: { authorization: `Bearer ${input.runtimeToken}` },
        signal: input.signal,
      }),
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw connectorFailure({ ...input, response, kind: 'rejected' });
    }
  } catch (error) {
    await remove();
    input.signal.throwIfAborted();
    if (error instanceof SyncError) {
      throw error;
    }
    throw connectorFailure({ ...input, kind: 'transport' });
  }
  const reader = response.body!.getReader();
  let cleanup: Promise<void> | undefined;
  let abort: () => void;
  const finish = () => {
    cleanup ??= (async () => {
      input.signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      await remove();
    })();
    return cleanup;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        controller.error(input.signal.reason);
        void finish();
      };
      input.signal.addEventListener('abort', abort, { once: true });
      if (input.signal.aborted) {
        abort();
      }
    },
    async pull(controller) {
      try {
        input.signal.throwIfAborted();
        const chunk = await reader.read();
        input.signal.throwIfAborted();
        if (chunk.done) {
          await finish();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch {
        await finish();
        controller.error(
          input.signal.aborted
            ? input.signal.reason
            : connectorFailure({ ...input, kind: 'transport' }),
        );
      }
    },
    cancel: finish,
  });
}
