# Guides

Runnable, code-heavy cookbooks for working **with** patternmesh. For
conceptual rationale behind the patterns these guides use, see
[`docs/design/`](../design/).

## Pages

- [Relations cookbook](./relations.md) — `hasMany`, `belongsTo`,
  `hasManyThrough`, including many-to-many via a join entity.
- [Bundles and recipes](./bundles-and-recipes.md) — the declarative
  orchestration primitive for bounded cross-entity reads and writes.
- [Lifecycle recipes](./lifecycle.md) — `softDelete`, `archive`, and TTL
  patterns built on the orchestration primitive.
- [Complex attributes](./complex-attributes.md) — `object`, `list`,
  `stringSet`, `numberSet`, `json`, and nested update operators.
- [Streams advanced](./streams-advanced.md) — decoding `DynamoDBRecord`
  images, TTL-aware routing, and shard-scoped ordering considerations.

## Related doc layers

- **Design docs** — [`docs/design/`](../design/) for the conceptual guide
  that motivates these patterns.
- **Contributor docs** — [`docs/dev/`](../dev/) for working on the repo.
