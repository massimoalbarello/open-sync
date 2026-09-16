# Browser-testing invariants

The [root engineering principles](../../AGENTS.md) apply here. These helper contracts also govern
browser journeys that use this package; callers read this guide when changing those journeys.

- Exercise the real passkey registration and authentication path. Do not add an authentication
  bypass, seed a session, weaken passkey verification, or enable a second sign-in mechanism for tests.
- Virtual authenticator credentials are ephemeral secrets. Never export, persist, or commit them.
- Keep browser sessions and authenticator state isolated per journey. The caller owns cleanup of
  the browser and application resources it creates, including after partial startup or failure.
