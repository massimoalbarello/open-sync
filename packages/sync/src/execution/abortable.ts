/** Stop waiting for trusted async code that ignores cancellation; late results cannot commit. */
export async function abortable<T>(input: { signal: AbortSignal; run(): Promise<T> }): Promise<T> {
  input.signal.throwIfAborted();
  const stopped = Promise.withResolvers<never>();
  const abort = () => stopped.reject(input.signal.reason);
  input.signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([input.run(), stopped.promise]);
  } finally {
    input.signal.removeEventListener('abort', abort);
  }
}
