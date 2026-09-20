import type { OpenSyncHttp } from '@context-use/open-sync/http';
import { treaty } from '@elysiajs/eden';
import type { App } from '#backend/app.ts';
export const api = treaty<App>(window.location.origin);
export const syncApi = treaty<OpenSyncHttp<'/api/open-sync'>>(window.location.origin).api[
  'open-sync'
];
