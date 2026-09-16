# Shared UI invariants

The [root engineering principles](../../AGENTS.md) apply here. For changes under
`src/components/ui/`, also read the [primitive guide](src/components/ui/AGENTS.md).

- This package owns reusable presentation and interaction contracts. Application routes, data
  fetching, forms, and product workflows remain with their consuming application.
- Use the Minimal Neutral theme and semantic tokens. Introduce tokens or shared variants only
  for recurring distinctions with stable meaning across consumers.
- Evolve a shared primitive or theme by considering its existing consumers together. Keep a
  product-specific exception with the application rather than expanding the shared API for it.
