import { expect, test } from 'bun:test';
import type { SyncEvent } from '../src/execution/diagnostics';
import type { SyncContext } from '../src/models/definition';
import { SyncError } from '../src/models/error';
import { defaultLimits, defaultTiming } from '../src/models/limits';
import { Registry } from '../src/models/registry';
import { DirectoryAssets } from '../src/repositories/assets/filesystem';
import { SqliteAssets } from '../src/repositories/assets/sqlite';
import { createSyncRuntime } from '../src/runtime';
import { AcquisitionService } from '../src/services/acquisition';
import {
  accepted,
  alpha,
  configure,
  fixture,
  page,
  repositories,
  savedSync,
  storage,
} from './support';

test.each(['paused', 'interrupted', 'timed_out', 'waiting_for_capacity'])(
  '%s waits for another poll instead of retrying during the drain',
  async (state) => {
    const f = repositories();
    const events: SyncEvent[] = [];
    const service = new AcquisitionService({
      repository: f.acquisition,
      assets: new SqliteAssets({ db: f.db, maxBytes: defaultLimits.maxPendingAssetBytes }),
      files: new DirectoryAssets(`${f.files.path}.assets`),
      maxAssetBytes: defaultLimits.maxAssetBytes,
      registry: new Registry({
        definitions: [
          {
            ...fixture,
            load: () => {
              throw new SyncError({ code: state, message: 'test' });
            },
          },
        ],
        destinations: { local: accepted },
      }),
      timing: defaultTiming,
      log: (event) => events.push(event),
    });
    try {
      const signal =
        state === 'waiting_for_capacity'
          ? new AbortController().signal
          : AbortSignal.abort(
              state === 'timed_out' ? new DOMException('deadline', 'TimeoutError') : state,
            );
      await service.execute({ lease: service.claim()!, signal });
      expect(events[0]?.code).toBe(state);
      expect(f.catalog.sync({ ...alpha, id: f.sync.id }).status).toBe(
        state === 'timed_out'
          ? 'retrying'
          : state === 'waiting_for_capacity'
            ? state
            : 'interrupted',
      );
      expect(service.claim()).toBeUndefined();
      service.poll();
      expect(service.claim()?.sync.id).toBe(f.sync.id);
    } finally {
      f.close();
    }
  },
);

test.each(['records', 'assets'])(
  '%s failures preserve the checkpoint across restarts and resume on the next cron or manual run',
  async (mode) => {
    const files = storage();
    const events: SyncEvent[] = [];
    const seen: unknown[] = [];
    let failing = true;
    const options = {
      databasePath: files.path,
      definitions: [
        {
          ...fixture,
          load: () => ({
            async step(context: SyncContext) {
              seen.push(context.checkpoint);
              if (context.checkpoint === 0) {
                return page;
              }
              if (failing) {
                const failure = new SyncError({
                  code: 'connector_request_failed',
                  message: 'private upstream payload',
                  status: 429,
                });
                if (mode === 'assets') {
                  await context.assets.capture({
                    id: 'file',
                    version: '1',
                    name: 'file.bin',
                    mediaType: 'application/octet-stream',
                    read: () => Promise.reject(failure),
                  });
                } else {
                  throw failure;
                }
              }
              return { ...page, complete: true };
            },
          }),
        },
      ],
      destinationTypes: { local: accepted },
      onEvent: (event: SyncEvent) => events.push(event),
    };
    let engine = createSyncRuntime(options);
    try {
      const sync = await configure(engine);
      const scope = { ...alpha, id: sync.id };
      await engine.runDue();
      expect(seen).toEqual([0, 1]);
      expect(savedSync({ path: files.path, scope })).toMatchObject({
        checkpoint: 1,
        status: 'retrying',
      });
      await engine.tick();
      expect(seen).toEqual([0, 1]);
      await engine.close();
      engine = createSyncRuntime(options);
      await engine.tick();
      expect(seen).toEqual([0, 1]);
      await engine.runDue();
      expect(seen).toEqual([0, 1, 1]);
      expect(events.at(-1)?.fields).toEqual({ httpStatus: 429 });
      expect(JSON.stringify(events)).not.toContain('private upstream payload');
      failing = false;
      engine.api.runNow(scope);
      await engine.tick();
      expect(seen).toEqual([0, 1, 1, 1]);
      expect(engine.api.sync(scope).status).toBe('succeeded');
      await engine.tick();
      expect(seen).toEqual([0, 1, 1, 1]);
    } finally {
      await engine.close();
      files.close();
    }
  },
);
