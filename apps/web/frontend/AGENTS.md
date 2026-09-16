# Frontend invariants

The [root engineering principles](../../../AGENTS.md) apply here. Load guidance for the part being changed:

- `src/queries/`: [Queries](src/queries/AGENTS.md) for API calls, keys, caching, and invalidation.
- `src/routes/`: [Routes](src/routes/AGENTS.md) for navigation, loaders, guards, and URL state.
- `test/`: [Frontend tests](test/AGENTS.md) for component and route verification.
- Application presentation and interaction: [UI decisions](UI-GUIDELINES.md).
- Shared primitives or theme changes: follow the owning [UI package](../../../packages/ui/AGENTS.md).
  Application components consume that package; they do not own a parallel primitive system.

## Canonical owners

Use one owner for each kind of state:

- TanStack Router owns routes, navigation, path parameters, guards, and URL search state.
- TanStack Query owns server data, caching, refresh, and mutation invalidation.
- TanStack Form owns form values, field state, validation timing, and submission state.
- The typed Eden client owns the frontend contract with the backend.
- React owns transient state local to a component or small subtree.
- Shared UI primitives own reusable interaction and accessibility behavior.

Introduce a competing router, cache, form system, client-state store, primitive library, or styling
system only when a concrete requirement cannot be handled coherently by the established owner and
the architectural tradeoff has been discussed.

## Components and state

- Presentational components do not own data fetching, mutation orchestration, navigation, or cache
  policy. Prefer composition over reusable components whose callers require mode flags.
- Keep state at its narrowest owner. Do not copy server, router, or form state into React state
  unless it is an intentional draft with an explicit synchronization rule.
- Use an effect only to synchronize with an external system. Data fetching, derivation, user
  actions, form operations, navigation, and application workflows belong to their established
  owners rather than `useEffect`.
- Prefer lifecycle and transition state exposed by the owning system over elapsed-time guesses.
  Use a timer only when time itself is part of the interaction contract, such as debouncing,
  animation pacing, or an explicit timeout—not to infer that a query, navigation, or render has
  finished.

## Contracts and trust

- Backend validation remains authoritative. Add client validation only when it improves a concrete
  form or URL boundary; do not duplicate backend contracts to create a parallel schema.
