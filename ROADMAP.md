# Roadmap

This is the public-facing roadmap for patternmesh. Items are **directional,
not commitments**; we reserve the right to change priorities, designs, and
delivery windows. For what has shipped, see [CHANGELOG.md](./CHANGELOG.md).

## Shipped

- **v0.1 – v0.4:** core modeling DSL, repositories, access patterns,
  transactions, batch, `Scan`, LSI routing, consumed-capacity passthrough.
- **v0.5 – v0.6:** relations DSL, read bundles, orchestration primitive.
- **v0.7:** complex attribute types (`object`, `list`, `stringSet`,
  `numberSet`, `json`, `pathRef`).
- **v0.8:** `@patternmeshjs/streams` package, `ttl()` field, lifecycle recipes
  (`softDelete`, `archive`).

## In progress — v0.9 (first OSS release)

- Correctness and safety hardening (reserved-attribute guards, strict cursor
  validation, `put` vs. strict `create` split, streams defaults).
- Apache-2.0 licensing, full OSS metadata on every published package.
- CI pipeline with Changesets-driven releases, npm OIDC provenance, and
  `publint` / `attw` gates.
- TypeDoc-generated API reference.

## Next — v1.0 (API stability)

- Public API-surface audit and stabilization commitment.
- Per-package independent versioning (currently lockstep).
- Named `SemVer` policy statement.
- `tests-smoke/` consume-from-tarball harness in CI.
- Additional adapter tests covering middleware/retry interop.

## Exploring (post-1.0, no commitments)

- **DynamoDB Local helpers**: schema-from-`defineTable` create-table helper
  to reduce onboarding friction.
- **Observability hooks**: typed `on*` callbacks for decode / unknown-entity
  / view-type-mismatch in `@patternmeshjs/streams`.
- **Validation interop**: optional `@patternmeshjs/zod` (or Valibot) package
  aligning runtime validation with inferred types.
- **Cursor signing**: HMAC-signed opaque cursors for untrusted boundaries.
- **`@patternmeshjs/kinesis`**: parallel package for Kinesis Data Streams
  consumers.
- **Shard polling**: direct `GetRecords` helpers for non-Lambda consumers.

## Deferred on purpose

- **Global Tables / multi-region routing**: consumer-owned.
- **Schema migrations**: no built-in migration framework; guidance lives in
  [`docs/single-table-patterns.md`](./docs/single-table-patterns.md).
- **Automatic sharding**: the library exposes explicit key building so
  consumers can reason about hotspots.

## How to influence the roadmap

Open an issue describing your use case, prior art, and constraints. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.
