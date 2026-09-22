import type { OpenSyncHttp } from '@context-use/open-sync/http';
import { treaty } from '@elysiajs/eden';
import type { App } from '#backend/app.ts';
// Record payloads and previews may contain date-like text; preserve the JSON string contract.
export const api = treaty<App>(window.location.origin, { parseDate: false });
export const syncApi = treaty<OpenSyncHttp<'/api/open-sync'>>(window.location.origin).api[
  'open-sync'
];
