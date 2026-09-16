import { treaty } from '@elysiajs/eden';
import type { App } from '#backend/app.ts';
export const api = treaty<App>(window.location.origin);
