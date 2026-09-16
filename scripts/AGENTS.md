# Script invariants

The [root engineering principles](../AGENTS.md) apply to this directory. When changing browser
journeys, read the [browser-testing contract](../packages/browser-testing/AGENTS.md) for
authentication fidelity, credential isolation, and browser lifecycle ownership.

- Seed application state only after real registration and through authenticated application
  boundaries.
- Keep isolated data disposable and prove cleanup cannot affect a developer's ordinary data.
