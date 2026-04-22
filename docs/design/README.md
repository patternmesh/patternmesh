# Design docs

Conceptual rationale for how patternmesh models DynamoDB single-table designs.
These docs explain **why** the library is shaped the way it is — for the
user-facing cookbooks and runnable examples, see
[`docs/guides/`](../guides/).

## Pages

- [Single-table design patterns](./single-table-patterns.md) — the core design
  guide: identity, key layout, GSI topology, access-pattern catalog, TTL and
  lifecycle interplay, child-vs-embed decision guidance.
- [Table setup](./table-setup.md) — how `defineTable` declares keys and
  indexes, how that drives routing, and the provisioning boundary between the
  library and your infrastructure code.
- [API reference generation](./api-reference.md) — how the TypeDoc output is
  produced and organized, and where to find per-symbol documentation.

## Related doc layers

- **User docs** — [root README](../../README.md),
  [topic guides](../guides/), package READMEs
- **Contributor docs** — [dev docs](../dev/) for working on the repo
