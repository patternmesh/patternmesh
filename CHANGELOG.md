# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Packages in this monorepo are versioned in lockstep until v1.0. Individual
package changelogs may be split out in a future release.

## [Unreleased]

## [0.9.0] - 2026-04-21

This is the first public open-source release. It includes
breaking changes that improve safety and clarity; please read carefully.

### Changed (breaking)

- **Packages renamed**: `@dynamodb/core`, `@dynamodb/aws-sdk-v3`, and
  `@dynamodb/streams` are now published as `@patternmesh/core`,
  `@patternmesh/aws-sdk-v3`, and `@patternmesh/streams`. Update all imports
  and `package.json` dependencies.
- **`repository.create()` now enforces not-exists.** The prior unconditional
  write has been renamed to `repository.put(data)`. A new
  `repository.create(data)` method enforces `attribute_not_exists(PK)` and
  throws `ItemAlreadyExistsError` on collision. Migrate with a search and
  replace: `repo.create(x)` → `repo.put(x)` where overwrite was intended.
- **Streams: `requiredViewType` now defaults to `["NEW_AND_OLD_IMAGES"]`.**
  Opt out explicitly with `requiredViewType: "any"` to accept any view type.
  This catches misconfigured streams at decode time rather than silently
  returning partial records.
- **Streams: invalid `eventName` values now throw** `StreamDecodeError`
  instead of being silently coerced.
- **Reserved attribute names rejected at compile time.** Entities whose field
  names collide with `partitionKey`, the configured sort-key attribute, or the
  entity discriminator (`entity` by default) now fail fast in `defineEntity`.
- **`runCountQuery` now enforces pagination limits** via a new options object
  (`{ maxPages, maxItems, budgetMs }`). Default `maxPages` is 1000. Throws
  `QueryLimitError` when exceeded to prevent runaway RCU consumption.
- **Adapter `batchWriteItem` throws on empty input** instead of silently
  succeeding.
- **`hasMany` relation: `add` is now the canonical write method.** `create`
  is retained as an alias that calls the underlying target repository's new
  strict `create()` method.
- **Duplicate read-bundle names now throw** at `connect` time.
- **`applyRelations` throws** on unknown root/target/through names instead of
  silently skipping.

### Added

- **`repository.put(data)`** — unconditional write (previous `create` behavior).
- **`ItemAlreadyExistsError`**, **`QueryLimitError`**, **`StreamDecodeError`**,
  **`StreamViewTypeError`**, **`UnknownEntityError`** typed error classes.
- **`isTtlRemove(record)`** helper in `@patternmesh/streams` for detecting
  DynamoDB TTL–driven REMOVE events.
- **`json()` field validation**: non-serializable values now throw
  `ValidationError`.
- **Stricter `datetime` field validation**: values must parse as ISO-8601.
- **Cursor shape validation**: malformed base64-url cursors throw
  `ValidationError` at decode time.
- **`update.setPath` / list / set ops validate paths** against `fieldMeta`.
- Full OSS metadata on every publishable `package.json` (`license`,
  `repository`, `homepage`, `bugs`, `keywords`, `sideEffects`, `publishConfig`).
- **Apache-2.0 licensing**, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, `ROADMAP.md`, `RELEASE_CHECKLIST.md`, GitHub issue/PR
  templates, Dependabot.
- **CI**: GitHub Actions for build, test (including DynamoDB Local
  integration), lint, `publint`, `attw`, CodeQL, and Changesets-driven
  release with npm OIDC provenance.
- **TypeDoc generation** via `pnpm docs:api`, intended for CI-hosted publishing
  rather than committed HTML.
- **`@types/aws-lambda` no longer required** to consume `@patternmesh/streams`
  — the minimal stream event shapes are now inlined.

### Fixed

- Published `.d.ts` in `@patternmesh/streams` no longer imports from
  `aws-lambda`.
- `ConnectedDb.batchGet`, `orchestrate`, and `lifecycle` are now correctly
  typed as non-optional (they are always present at runtime).
- Several `throw new Error(...)` sites in `connect` and `entity` replaced with
  `ConfigurationError` for consistent typed error handling.
- `batchGet` reconciliation is now O(n) via a keyed `Map` instead of O(n·m).

## Pre-release milestone history

The items below summarize the internal milestone progression that led to the
first public `v0.9.0` release. They are included for context, but they do not
imply that historical npm packages, git tags, or GitHub releases already exist
for these versions.

### v0.8 milestone

### Added

- **`@patternmesh/streams`** package with typed DynamoDB stream decoding,
  entity-discriminator routing, `decodeStreamRecord`, `decodeStreamEvent`,
  `handleStreamByEntity`, strict vs. tolerant unknown-entity modes, and
  `StreamViewType` safety checks.
- **`ttl()` field builder** for epoch-seconds attributes with validation.
- **Lifecycle recipes**: `db.lifecycle.softDelete` (in-place tombstone) and
  `db.lifecycle.archive` (copy to archive entity) built on the orchestration
  primitive.
- **TTL and lifecycle patterns** section in `docs/single-table-patterns.md`.

### v0.7 milestone

### Added

- **Complex attribute field builders**: `object()`, `list()`, `stringSet()`,
  `numberSet()`, `json()`, and `pathRef()` for modeling nested and
  non-scalar DynamoDB types.
- Type inference and validation for nested shapes.

### v0.6 milestone

### Added

- **Orchestration primitive** (`db.orchestrate.write`) for composing
  cross-entity transactional writes with typed condition callbacks.
- Read bundles (`db.read.bundle`) for grouping related entities into a single
  transactional read.

### v0.5 milestone

### Added

- **Relations DSL** (`createRelations`) with `hasMany`, `hasManyThrough`, and
  `belongsTo` routed traversal helpers.
- Read bundle builder foundation.

### v0.4 milestone

### Added

- **`Scan`** support on the adapter with LSI-aware routing.
- **LSI declarations** on `defineTable`; explicit index routing on access
  patterns.
- **Consumed-capacity pass-through** fields on adapter responses.

### v0.3 milestone

### Added

- **Transactions**: `db.tx.read` and `db.tx.write` builders with
  client-request-token idempotency (10-minute AWS window).
- Error mapping for `TransactionCanceledException` with per-item reason
  surfaces.

### v0.2 milestone

### Added

- **BatchGetItem** and **BatchWriteItem** with automatic chunking
  (100/25 item caps) and unprocessed-item retry shape.
- **Query** `ConsistentRead`, `Select`, and projection expressions.

### v0.1 milestone

### Added

- Initial release: `defineTable`, `entity`, `connect`, repository CRUD,
  access patterns, update builder, `explain()` helpers, base64-url cursors.
- AWS SDK v3 DocumentClient adapter.

[Unreleased]: https://github.com/patternmesh/patternmesh/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/patternmesh/patternmesh/releases/tag/v0.9.0
