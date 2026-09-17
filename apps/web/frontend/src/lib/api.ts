import { treaty } from '@elysiajs/eden';
import type { OpenSyncHttp } from '@open-sync/core/http';
import type { App } from '#backend/app.ts';
export const api = treaty<App>(window.location.origin);
export const syncApi = treaty<OpenSyncHttp<'/api/open-sync'>>(window.location.origin).api[
  'open-sync'
];
