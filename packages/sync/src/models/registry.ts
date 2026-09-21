import {
  type DefinitionRef,
  definitionKey,
  type SyncDefinition,
  type SyncRegistration,
} from './definition';
import type { DestinationType } from './delivery';
import { fail } from './error';
import { canonicalJson } from './json';
import { identifier, validate } from './validation';

export class Registry {
  readonly #definitions = new Map<string, SyncRegistration>();
  readonly #destinations: ReadonlyMap<string, DestinationType>;
  constructor(input: {
    definitions: readonly SyncRegistration[];
    destinations: Readonly<Record<string, DestinationType>>;
  }) {
    this.#destinations = new Map(
      Object.entries(input.destinations).map(([name, type]) => {
        identifier(name);
        identifier(type.version);
        return [
          name,
          {
            ...type,
            configSchema: structuredClone(type.configSchema),
            setup: type.setup
              ? { ...type.setup, schema: structuredClone(type.setup.schema) }
              : undefined,
          },
        ];
      }),
    );
    for (const registration of input.definitions) {
      const definition = canonicalJson(registration.definition).value as unknown as SyncDefinition;
      identifier(definition.id);
      identifier(definition.version);
      identifier(definition.artifactId);
      validate({ value: definition.initialCheckpoint, schema: definition.checkpointSchema });
      if (!Object.keys(definition.kinds).length) {
        fail('missing_record_kinds');
      }
      for (const kind of Object.keys(definition.kinds)) {
        identifier(kind);
      }
      const key = definitionKey(definition);
      if (this.#definitions.has(key)) {
        fail('definition_conflict');
      }
      this.#definitions.set(key, { definition, load: () => registration.load() });
    }
  }
  definitions(): SyncDefinition[] {
    return [...this.#definitions.values()].map((entry) => structuredClone(entry.definition));
  }
  definition(ref: DefinitionRef): SyncRegistration {
    const registration = this.#definitions.get(definitionKey(ref));
    if (!registration) {
      fail('definition_unavailable');
    }
    return {
      definition: structuredClone(registration.definition),
      load: () => registration.load(),
    };
  }
  destinationTypes() {
    return [...this.#destinations].map(([type, entry]) => ({
      type,
      version: entry.version,
      name: entry.name,
      description: entry.description,
      configSchema: structuredClone(entry.configSchema),
      setupSchema: structuredClone(entry.setup?.schema ?? entry.configSchema),
    }));
  }
  destination(name: string): DestinationType {
    const type = this.#destinations.get(name);
    if (!type) {
      fail('destination_unavailable');
    }
    return type;
  }
}
