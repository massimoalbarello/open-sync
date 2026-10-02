import { describe, expect, test } from 'bun:test';
import { loadEnv } from '#backend/lib/env.ts';
import { BACKEND_ENVIRONMENT, NIBRUN_DATA_FOLDER } from '#backend/lib/runtime-config.ts';

const WORKING_DIRECTORY = '/application';

describe('backend environment', () => {
  test('keeps the injected hostname when a custom public URL is configured', () => {
    const env = loadEnv({
      environment: {
        [BACKEND_ENVIRONMENT.nibrunHostname]: 'application-test.nibrun.app',
        [BACKEND_ENVIRONMENT.baseUrl]: 'https://knowledge.example.com',
      },
      workingDirectory: WORKING_DIRECTORY,
    });

    expect(env.NIBRUN_HOSTNAME).toBe('application-test.nibrun.app');
    expect(env.BASE_URL.origin).toBe('https://knowledge.example.com');
  });

  test('uses the persistent nibrun volume for application and authorization state', () => {
    const env = loadEnv({
      environment: { [BACKEND_ENVIRONMENT.nibrunHostname]: 'application-abc.nibrun.app' },
      workingDirectory: WORKING_DIRECTORY,
    });

    expect(env.DATA_FOLDER).toBe(NIBRUN_DATA_FOLDER);
    expect(env.BASE_URL.href).toBe('https://application-abc.nibrun.app/');
  });

  test('allows a nibrun data subdirectory on the persistent volume', () => {
    const env = loadEnv({
      environment: {
        [BACKEND_ENVIRONMENT.dataFolder]: '/app/data/application',
        [BACKEND_ENVIRONMENT.nibrunHostname]: 'application-abc.nibrun.app',
      },
      workingDirectory: WORKING_DIRECTORY,
    });

    expect(env.DATA_FOLDER).toBe('/app/data/application');
  });

  test('rejects ephemeral nibrun data folders', () => {
    expect(() =>
      loadEnv({
        environment: {
          [BACKEND_ENVIRONMENT.dataFolder]: '/tmp/application',
          [BACKEND_ENVIRONMENT.nibrunHostname]: 'application-abc.nibrun.app',
        },
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toThrow('DATA_FOLDER must be inside /app/data on nibrun');
  });
});
