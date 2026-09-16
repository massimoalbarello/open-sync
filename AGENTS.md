# Application engineering principles

This file contains repository-wide principles. Before changing a file, read the `AGENTS.md` files
along its ancestor path, from this root to the nearest guide. A nested guide governs its subtree
and overrides broader guidance there. Directories without a nested guide inherit their ancestors.

## Find the relevant guidance

Use the affected paths and task to choose an entry below. Follow child links only when their scope
is involved; do not recursively load every guide. If work crosses a boundary, read the other
owner's guide for that boundary. A cross-reference shares a specific contract, not every rule from
the linked guide's sibling directories.

| When working on | Start here |
| --- | --- |
| `apps/web/backend/` | [Backend](apps/web/backend/AGENTS.md): database, repositories, transport, and backend tests. |
| `apps/web/frontend/` | [Frontend](apps/web/frontend/AGENTS.md): queries, routes, application UI, and frontend tests. |
| `packages/ui/` | [Shared UI](packages/ui/AGENTS.md): shared theme and primitive ownership. |
| `packages/browser-testing/` or its browser-journey callers | [Browser testing](packages/browser-testing/AGENTS.md): authentication fidelity and credential isolation. |
| Root `scripts/` | [Scripts](scripts/AGENTS.md): disposable development state and seeding. |
| Persistent data, migrations, or externally visible contracts | [Compatibility policy](COMPATIBILITY.md). |

Load workflow skills when performing their task, independently of file scope:

- Implementing a feature or fix: [ship-change](.agents/skills/ship-change/SKILL.md).
- Preparing or opening a PR: [open-pull-request](.agents/skills/open-pull-request/SKILL.md).
- Building or deploying the nibrun executable, or changing its runtime contract:
  [deploy-to-nibrun](.agents/skills/deploy-to-nibrun/SKILL.md). This includes relevant work in
  `apps/web/scripts/`, `apps/web/test/`, `packages/build-tools/`, and build/deployment CI.

## What belongs in an AGENTS.md

Use these files for durable engineering principles that require judgment. Do not record feature
history, current project status, temporary rollout advice, or facts that are readily discoverable
from code and configuration.

Implementing a feature does not justify adding a guideline. Never append a description of the
feature, its operations, or its implementation choices after it lands. Preserve behavior in code,
types, and tests; use prose only to guide future decisions that those mechanisms cannot determine.

Before adding or expanding a rule, all three answers must be clear:

1. What future engineering judgment will this rule change?
2. Why can that constraint not be enforced or derived deterministically?
3. Why is this directory the narrowest scope in which the rule is valid?

If any answer is missing, do not add the rule.

- Put a rule in the narrowest directory where it applies.
- Prefer types, tests, lint rules, and generated checks for deterministic constraints. Do not
  duplicate those checks in prose.
- Add guidance only when violating it would create a meaningful design, security, data-integrity,
  or maintenance risk.
- Remove guidance when its underlying constraint disappears or becomes deterministic.

## Before implementation

State the problem, desired outcome, constraints, and success condition before writing code.
Distinguish the root cause from its symptoms.

For a non-trivial change, discuss ownership, boundaries, important invariants, plausible
alternatives, and tradeoffs with the requester. Include doing nothing when it is a meaningful
alternative. Do not build a capability without a concrete current need.

## Design

- Conform new code to the patterns established by the existing code that owns the same
  responsibility. If an established pattern appears suboptimal, explain the concern and tradeoffs
  to the requester before extending it or introducing a competing pattern; decide together whether
  to refactor the shared pattern first.
- Before writing custom logic for a broadly solved problem, evaluate established, maintained
  libraries. Prefer a suitable library when it meets the required behavior, security, runtime, and
  dependency constraints; use bespoke code only when concrete tradeoffs justify owning it.
- Choose the smallest coherent design with the fewest necessary concepts, states, dependencies,
  and special cases. Prefer deletion or consolidation before addition.
- Give each module one cohesive responsibility and one primary reason to change. Split unrelated
  workflows instead of joining them with flags or broadly optional inputs.
- Assign each invariant to the component that owns and can enforce it. Share a contract only when
  its consumers should change together.
- Keep dependencies explicit and directed toward domain-owned contracts. Construct stateful
  dependencies at a composition root; importing a module must not acquire resources or mutate
  global state.
- Maintain one source of truth for schemas, identifiers, vocabulary, and enum-like values. Derive
  secondary representations instead of copying them.
- Keep public contracts narrow. Generalize only after concrete implementations reveal a stable
  shared abstraction.
- Treat contorted control flow, repeated domain logic, growing mode switches, and lengthy
  explanations as evidence that ownership or boundaries need reconsideration.

## Trust and durable state

- Make the acting identity and resource owner explicit at trust, service, and persistence
  boundaries. Never rely on a process-global principal or an implicit single user.
- Treat persistent data and externally visible contracts as owned state. Destructive or
  irreversible changes require a proven scope, verification method, failure behavior, and recovery
  plan.
- Preserve trust boundaries when sharing code. Authentication, authorization, ownership filtering,
  and capability checks remain with the surface that can enforce them.

## Tests

Each test must protect an important invariant, boundary, or failure mode. Test at the lowest layer
that can prove the behavior, using the real boundary when correctness depends on a database,
filesystem, protocol, or framework contract. Assert observable behavior rather than private call
sequences, and remove redundant tests when a stronger test supersedes them.

## Change scope

Every change should have one outcome a reviewer can state in one sentence. Keep unrelated
refactors, upgrades, generated churn, and renames separate; preserve work already present in the
tree. Update the nearest `AGENTS.md` only when the change establishes or removes an enduring
principle that belongs there.

Do not add README files, component guides, implementation summaries, or other documentation
artifacts unless explicitly requested. Keep discoverable usage and implementation details in code
and configuration. Preserve required third-party notices in an existing license or attribution
file instead of adding a per-feature file.
