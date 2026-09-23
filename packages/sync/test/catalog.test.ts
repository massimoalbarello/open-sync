import { expect, test } from 'bun:test';
import { createSyncRuntime } from '../src/runtime';
import { alpha, fixture, runtime } from './support';

test('public registration metadata excludes execution state and duplicate source names are rejected', async () => {
  const f = runtime();
  try {
    expect(() => createSyncRuntime({ ...f.options, definitions: [fixture, fixture] })).toThrow(
      'definition conflict',
    );
    expect(f.engine.api.destinationTypes(alpha)).toMatchObject([
      { type: 'local', setupSchema: { type: 'object', additionalProperties: false } },
    ]);
    const definition = f.engine.api.definitions(alpha)[0]!;
    expect(definition).not.toHaveProperty('initialCheckpoint');
    expect(definition).not.toHaveProperty('checkpointSchema');
    expect(definition).not.toHaveProperty('kinds');
  } finally {
    await f.close();
  }
});
