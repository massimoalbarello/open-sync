import type { JsonObject } from '../models/json';
export interface SyncEvent {
  code: string;
  ownerId?: string;
  installationId?: string;
  message?: string;
  fields?: JsonObject;
}
export type Logger = (event: SyncEvent) => void;
export function safeLogger(logger?: Logger): Logger {
  return (event) => {
    try {
      logger?.(event);
    } catch {
      /* Diagnostics cannot change persistence. */
    }
  };
}
