import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createSyncController } from '../src/http/controller';
import type { DestinationType } from '../src/models/delivery';
import { alpha, beta, runtime } from './support';

const schema = {
  type: 'object' as const,
  properties: { token: { type: 'string' as const, minLength: 1, writeOnly: true } },
  required: ['token'],
  additionalProperties: false,
};

test('destination setup validates both sides of preparation, persists only safe config, and isolates owners', async () => {
  const secret = 'do-not-persist-or-echo';
  let mode: 'ok' | 'throw' | 'bad-config' = 'ok';
  const scopes: unknown[] = [];
  const destination: DestinationType = {
    version: '1',
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
      new Request('http://localhost/sync/destinations/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'local', input }),
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
      expect(f.engine.api.destinations(alpha)).toHaveLength(0);
    }
    const malformed = await request([secret]);
    expect(malformed.ok).toBe(false);
    expect(await malformed.text()).not.toContain(secret);
    mode = 'ok';
    const created = await request({ token: secret });
    expect(created.ok).toBe(true);
    const first = await created.json();
    const second = await f.engine.api.setupDestination({
      ...alpha,
      type: 'local',
      input: { token: secret },
    });
    expect(second).toEqual(first);
    const other = await f.engine.api.setupDestination({
      ...beta,
      type: 'local',
      input: { token: secret },
    });
    expect(other.id).not.toBe(first.id);
    expect(scopes.at(-1)).toEqual(beta);
    expect(db.query('SELECT config FROM destinations').all()).toEqual([
      { config: '{"reference":"safe-reference"}' },
      { config: '{"reference":"safe-reference"}' },
    ]);
    expect(JSON.stringify(f.engine.api.destinations(alpha))).not.toContain('reference');
    const catalog = f.engine.api.destinationTypes(alpha);
    expect(catalog[0]?.setupSchema).toEqual(schema);
    catalog[0]!.setupSchema.required = [];
    expect(f.engine.api.destinationTypes(alpha)[0]?.setupSchema.required).toEqual(['token']);
  } finally {
    db.close();
    await f.close();
  }
});
