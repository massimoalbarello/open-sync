import { expect, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { accepted, alpha, beta, fixture, storage } from './support';

const next = {
  ...fixture,
  definition: { ...fixture.definition, version: '2', artifactId: 'test/2' },
  upgradeFrom: [fixture.definition],
};

test('explicit compatible upgrades preserve owned sources and committed progress across restart', async () => {
  const files = storage();
  const options = {
    databasePath: files.path,
    destinationTypes: { local: accepted },
    timing: { maxPages: 1 },
  };
  let engine = createSyncRuntime({ ...options, definitions: [fixture] });
  try {
    const destination = engine.api.createDestination({ ...alpha, type: 'local', config: {} });
    const installation = await engine.api.createInstallation({
      ...alpha,
      definition: fixture.definition,
      destinationId: destination.id,
      config: { count: 3 },
    });
    await engine.tick();
    const scope = { ...alpha, id: installation.id };
    const before = engine.api.installation(scope);
    expect(before.checkpoint).toBe(1);
    await engine.close();
    engine = createSyncRuntime({ ...options, definitions: [next] });
    expect(engine.api.installation(scope)).toEqual({
      ...before,
      definition: {
        id: next.definition.id,
        version: next.definition.version,
        artifactId: next.definition.artifactId,
      },
    });
    expect(() => engine.api.installation({ ...beta, id: installation.id })).toThrow('not found');
    engine.api.queueRun(scope);
    await engine.tick();
    expect(engine.api.installation(scope).checkpoint).toBe(2);
    await engine.close();
    engine = createSyncRuntime({ ...options, definitions: [next] });
    expect(engine.api.installation(scope).checkpoint).toBe(2);
  } finally {
    await engine.close();
    files.close();
  }
});

test('manifest mismatches roll back registration and upgrades without changing existing sources', async () => {
  const files = storage();
  const options = { databasePath: files.path, destinationTypes: { local: accepted } };
  let engine = createSyncRuntime({ ...options, definitions: [fixture] });
  try {
    const destination = engine.api.createDestination({ ...alpha, type: 'local', config: {} });
    const installation = await engine.api.createInstallation({
      ...alpha,
      definition: fixture.definition,
      destinationId: destination.id,
      config: { count: 3 },
    });
    await engine.close();
    expect(() =>
      createSyncRuntime({
        ...options,
        definitions: [
          {
            ...next,
            upgradeFrom: [{ ...fixture.definition, description: 'not the stored manifest' }],
          },
        ],
      }),
    ).toThrow('definition conflict');
    engine = createSyncRuntime({ ...options, definitions: [fixture] });
    expect(engine.api.installation({ ...alpha, id: installation.id })).toEqual(installation);
    await engine.close();
    // A failed attempt must not leave the new manifest registered either.
    engine = createSyncRuntime({
      ...options,
      definitions: [{ ...next, definition: { ...next.definition, name: 'Corrected' } }],
    });
  } finally {
    await engine.close();
    files.close();
  }
});

test('automatic upgrades reject incompatible checkpoints or provider identities', () => {
  const files = storage();
  try {
    for (const definition of [
      { ...next.definition, checkpointSchema: { type: 'string' as const }, initialCheckpoint: '' },
      { ...next.definition, provider: { service: 'different', actions: [] } },
    ]) {
      expect(() =>
        createSyncRuntime({
          databasePath: files.path,
          definitions: [{ ...next, definition }],
          destinationTypes: { local: accepted },
        }),
      ).toThrow('incompatible definition upgrade');
    }
  } finally {
    files.close();
  }
});
