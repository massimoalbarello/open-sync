import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createSyncController } from '../src/http/controller';
import type { DestinationType } from '../src/models/delivery';
import { createSyncRuntime } from '../src/runtime';
import { alpha, beta, fixture, runtime } from './support';

const schema = {
  type: 'object' as const,
  properties: { token: { type: 'string' as const, minLength: 1, writeOnly: true } },
  required: ['token'],
  additionalProperties: false,
};

test('destination setup validates both sides of preparation, persists only prepared config, and isolates owners', async () => {
  const secret = 'do-not-persist-or-echo';
  let mode: 'ok' | 'throw' | 'bad-config' = 'ok';
  const scopes: unknown[] = [];
  const destination: DestinationType = {
    configSchema: {
      type: 'object',
      properties: { reference: { type: 'string' } },
      required: ['reference'],
      additionalProperties: false,
    },
    setup: {
      schema,
      prepare({ scope, input }) {
        scopes.push({ ...scope });
        scope.ownerId = 'injected-owner';
        if (mode === 'throw') {
          throw new Error(String(input.token));
        }
        return mode === 'bad-config' ? input : { reference: 'safe-reference' };
      },
    },
    deliver: () => Promise.resolve({ status: 'accepted' }),
  };
  const f = runtime({ destination });
  const db = new Database(f.files.path, { readonly: true });
  const app = createSyncController({ api: f.engine.api, authorize: () => alpha });
  const request = (input: unknown) =>
    app.handle(
      new Request('http://localhost/sync/syncs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          definition: fixture.definition.id,
          config: { count: 1 },
          destination: { type: 'local', input },
        }),
      }),
    );
  try {
    const missing = await request({});
    expect(missing.ok).toBe(false);
    expect(scopes).toHaveLength(0);
    for (const value of ['throw', 'bad-config'] as const) {
      mode = value;
      const rejected = await request({ token: secret });
      expect(rejected.ok).toBe(false);
      expect(await rejected.text()).not.toContain(secret);
      expect(f.engine.api.syncs(alpha)).toHaveLength(0);
    }
    const malformed = await request([secret]);
    expect(malformed.ok).toBe(false);
    expect(await malformed.text()).not.toContain(secret);
    mode = 'ok';
    const created = await request({ token: secret });
    expect(created.ok).toBe(true);
    const first = await created.json();
    const other = await f.engine.api.createSync({
      ...beta,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination: { type: 'local', input: { token: secret } },
    });
    expect(other.id).not.toBe(first.id);
    expect(scopes.at(-1)).toEqual(beta);
    expect(() => f.engine.api.sync({ ...beta, id: first.id })).toThrow('not found');
    expect(db.query('SELECT destination_config FROM syncs').all()).toEqual([
      { destination_config: '{"reference":"safe-reference"}' },
      { destination_config: '{"reference":"safe-reference"}' },
    ]);
    for (const response of [
      first,
      other,
      f.engine.api.syncs(alpha),
      f.engine.api.sync({ ...alpha, id: first.id }),
    ]) {
      const json = JSON.stringify(response);
      expect(json).not.toContain(secret);
      expect(json).not.toContain('reference');
      for (const field of ['checkpoint', 'destination', 'ownerId', 'config']) {
        expect(json).not.toContain(`"${field}"`);
      }
    }
    const catalog = f.engine.api.destinationTypes(alpha);
    expect(catalog[0]?.setupSchema).toEqual(schema);
    catalog[0]!.setupSchema.required = [];
    expect(f.engine.api.destinationTypes(alpha)[0]?.setupSchema.required).toEqual(['token']);
  } finally {
    db.close();
    await f.close();
  }
});

test('queued deliveries retain their own prepared destination config across restart', async () => {
  let accepting = false;
  const observed: { syncId: string; ownerId: string; config: unknown }[] = [];
  const f = runtime({
    destination: {
      configSchema: {
        type: 'object',
        required: ['secret'],
        properties: { secret: { type: 'string' } },
        additionalProperties: false,
      },
      setup: {
        schema: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        },
        prepare: ({ scope, input }) => ({ secret: `${scope.ownerId}/${input.name}` }),
      },
      deliver: ({ scope, config, deliverable: delivery }) => {
        if (!accepting) {
          return Promise.resolve({ status: 'retry', retryAfterMs: 0 });
        }
        observed.push({ syncId: delivery.syncId, ownerId: scope.ownerId, config });
        expect(delivery).not.toHaveProperty('sourceId');
        expect(delivery).not.toHaveProperty('installationId');
        return Promise.resolve({ status: 'accepted' });
      },
    },
  });
  try {
    const first = await f.engine.api.createSync({
      ...alpha,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination: { type: 'local', input: { name: 'first' } },
    });
    const second = await f.engine.api.createSync({
      ...beta,
      definition: fixture.definition.id,
      config: { count: 1 },
      destination: { type: 'local', input: { name: 'second' } },
    });
    await f.engine.tick();
    await f.engine.close();
    accepting = true;
    const reopened = createSyncRuntime(f.options);
    try {
      for (const scope of [alpha, beta]) {
        for (const pending of reopened.api.deliveries(scope).deliveries) {
          reopened.api.retryDelivery({ ...scope, id: pending.id });
        }
      }
      await reopened.tick();
      expect(observed).toEqual(
        expect.arrayContaining([
          { syncId: first.id, ownerId: alpha.ownerId, config: { secret: 'alpha/first' } },
          { syncId: second.id, ownerId: beta.ownerId, config: { secret: 'beta/second' } },
        ]),
      );
      expect(JSON.stringify(reopened.api.syncs(alpha))).not.toContain('secret');
      expect(() => reopened.api.sync({ ...beta, id: first.id })).toThrow('not found');
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
});
