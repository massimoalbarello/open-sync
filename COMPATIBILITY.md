# Compatibility policy

The [root engineering principles](./AGENTS.md) apply.

Local databases created by isolated development and tests are disposable. They do not establish
compatibility history. Prefer a coherent design over compatibility paths solely for disposable state.

Once an application has persistent users or shared deployments, preserve its owned data and public
contracts. Applied migrations are immutable. Introduce forward migrations and define verification,
failure behavior, backup scope, and recovery before changing durable state. Never assume that a
repository generated from this template is still undeployed; establish its actual state first.
