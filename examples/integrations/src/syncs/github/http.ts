import { type ProviderResponse, SourceHttpError } from '@context-use/open-sync/definition';

/** GitHub reports limits through HTTP headers and through HTTP-200 GraphQL errors. */
export function checkResponse(response: ProviderResponse): void {
  const headers = new Headers(response.headers);
  const forbidden = 403;
  const rateLimited = 429;
  if (
    response.status === rateLimited ||
    (response.status === forbidden &&
      (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))
  ) {
    throw new SourceHttpError({ status: rateLimited });
  }
  const ok = 200;
  if (response.status !== ok) {
    throw new SourceHttpError(response);
  }
  const body = response.body;
  const errors = body && typeof body === 'object' && !Array.isArray(body) ? body.errors : undefined;
  if (!Array.isArray(errors)) {
    return;
  }
  const types = errors.flatMap((error) =>
    error && typeof error === 'object' && !Array.isArray(error) && typeof error.type === 'string'
      ? [error.type]
      : [],
  );
  if (
    types.includes('RATE_LIMITED') ||
    (errors.length && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))
  ) {
    throw new SourceHttpError({ status: rateLimited });
  }
  if (types.includes('FORBIDDEN')) {
    throw new SourceHttpError({ status: forbidden });
  }
}
