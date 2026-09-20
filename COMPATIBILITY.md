# Compatibility policy

The [root engineering principles](./AGENTS.md) apply.

Development databases and preview deployments explicitly designated disposable by the owner do not
establish compatibility history. Revise schemas in unmerged work and reset disposable state instead
of maintaining upgrade paths for it.

For non-disposable deployments, preserve owned data and public contracts. Applied migrations are
immutable. Introduce forward migrations and define verification, failure behavior, backup scope,
and recovery before changing durable state. Never assume that a
repository generated from this template is still undeployed; establish its actual state first.
