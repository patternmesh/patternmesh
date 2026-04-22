# Roadmap

This is the public-facing roadmap for patternmesh. Items are **directional,
not commitments**; we reserve the right to change priorities, designs, and
delivery windows. For what has shipped, see [CHANGELOG.md](./CHANGELOG.md).

## What parity means for this product

The parity bar is: every core **DynamoDB data-plane** operation is reachable
through **first-class typed APIs** _or_ a **structured raw escape hatch**
(e.g. `toSdkCommand(compiled)`) that does not block advanced SDK use.
Obscure SDK flags do not need to be individually modeled in the DSL if the
escape hatch is honest and documented.

Explicitly **out of scope** for parity: control-plane operations
(`CreateTable`, `UpdateTable`, `DescribeTable`, IAM, backups/PITR,
Contributor Insights) — those are AWS account operations, not application
data access. **PartiQL** is an optional parity extension, not a core
requirement.

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

## v1.1 – v1.3 — Operator-grade ergonomics (exploring)

- **Policy / access lint**: warn on hot-path `FilterExpression` usage, non-`ALL`
  GSI projection, accidental table scans.
- **10 GB item-collection lint**: static check / warning when an item
  collection approaches the per-partition-key limit across base table plus
  all LSIs.
- **Observability**: OpenTelemetry spans around adapter calls; log redaction
  hooks.
- **Mock adapter + contract tests** against recorded `CompiledOperation`
  fixtures, published as part of `@patternmeshjs/testing`.
- **IAM policy generator** (optional): least-privilege skeleton from
  declared access patterns (human-reviewed, never auto-applied).

## v2.0 — PartiQL, edge adapters, last-mile parity (exploring)

- **Optional PartiQL package**: `ExecuteStatement` / `BatchExecuteStatement`
  with entity mapping where possible, raw row fallback otherwise.
- **Alternative runtimes**: Bun / edge guidance; optional fetch-based
  adapter if AWS-supported patterns warrant it.
- **`toSdkCommand(compiled)` escape hatch**: 100% SDK option coverage for
  niche flags the DSL never models, so advanced users never hit a wall.

## Ecosystem

> Adjacent packages reinforce the core differentiator; the core compiler
> stays narrow and owns nothing it can delegate. See
> [docs/dev/validation-boundary.md](./docs/dev/validation-boundary.md) for
> the architectural boundary that governs package splits.

### Adjacent packages (ordered, exploring)

1. **`@patternmeshjs/testing`** — DynamoDB Local harness, fixtures,
   `expectQueryPlan(...)` helpers, explain-snapshot assertions. Highest
   leverage because every downstream adopter needs this for their own
   entities.
2. **`@patternmeshjs/zod`** — parse / normalize / JSON Schema export layer
   generated from the DSL. Zod owns runtime validation and
   `z.toJSONSchema(...)` export; the core compiler still owns keys and
   access-pattern planning. See
   [docs/dev/validation-boundary.md](./docs/dev/validation-boundary.md).
3. **`@patternmeshjs/devtools`** (a.k.a. explain visualizer) — renders
   compiled plans, entity-to-index routing, non-key-filter warnings, and
   PR-ready plan reports. Directly reinforces our `explain()` story.
4. **`@patternmeshjs/migrations`** — versioned item transforms, backfill
   runner, checkpoint cursors, dry-run, rate limiting, index-rollout helpers.
   Deliberately outside `core` because migrations need their own release
   cadence and failure modes.
5. **Visual modeler / schema explorer** — second-wave product once the
   packages above have enough adoption to justify the tooling investment.

### Platform directions (long-term, directional)

- **A coherent DynamoDB developer platform** stitching the adjacent packages
  above — modeling, testing, visualization, migration, docs — so teams do
  not have to assemble their own toolkit for each project.
- **JSON Schema / OpenAPI / agent-facing export pipeline** anchored by
  `@patternmeshjs/zod` plus docs generation. Makes patternmesh models
  first-class citizens in API frameworks and structured-output tooling.
- **AI / agent-friendly repo surface** (MCP-style tooling, machine-readable
  model definitions, AGENTS.md discipline). Phase-3 exploration, not a
  near-term goal, and it rides on top of the Zod / devtools / docs layers —
  not a separate product.

## DynamoDB parity checklist

Tracking artifact for what the library covers at the SDK level. Statuses are
approximate; CHANGELOG.md and package READMEs are the source of truth for any
specific version.

### Item APIs

- [x] `GetItem` (with `ConsistentRead`, `ProjectionExpression`)
- [x] `PutItem` (with `ConditionExpression`, `ReturnValues`)
- [x] `UpdateItem` (with `ReturnValues` variants,
      `ReturnValuesOnConditionCheckFailure`)
- [x] `DeleteItem` (with condition and return options)
- [x] `Query` (full `KeyConditionExpression` expressiveness,
      `FilterExpression`, `Select`, pagination)
- [x] `Scan` (with `Segment` / `TotalSegments`, filters, projection,
      pagination)
- [x] `BatchGetItem` (with unprocessed retry)
- [x] `BatchWriteItem` (with unprocessed retry)
- [x] `TransactGetItems`
- [x] `TransactWriteItems` (checks, writes, cancellation semantics)
- [ ] `ExecuteStatement` / `BatchExecuteStatement` (PartiQL — optional, v2.0)

### Cross-cutting options

- [x] `ExpressionAttributeNames` / `ExpressionAttributeValues` on all
      compiled paths
- [x] `ReturnConsumedCapacity` passthrough
- [ ] `ReturnItemCollectionMetrics` (partial — add where relevant)
- [x] `ClientRequestToken` / idempotency for transact writes
- [x] Error-taxonomy mapping for common AWS exceptions

### Optional packages beyond core item parity

- [x] Streams consumer helpers (`@patternmeshjs/streams`)
- [x] TTL modeling helpers (`ttl()` field + lifecycle recipes)
- [ ] Control-plane toolkit (separate product decision, not planned near term)

## Versioning discipline

- **`0.x` minor** = additive public API; deprecations with warnings.
- **`1.0` onwards** = strict SemVer for public types and runtime behavior.
- **Snapshot `explain()` output** in tests whenever compilers are tightened,
  so patch releases cannot silently change generated expressions. This is
  the primary compiler-regression guard; see
  [docs/dev/testing.md § explain-plan snapshots](./docs/dev/testing.md#explain-plan-snapshots)
  for the enforcement mechanics.
- **Snapshot churn requires a changeset.** If a PR mutates any `.explain.*`
  or `UpdateBuilder.explain()` snapshot, a consumer's on-the-wire DynamoDB
  request changed — that is externally visible and needs the right bump.

## Exploring (post-1.0, no commitments)

- **DynamoDB Local helpers**: schema-from-`defineTable` create-table helper
  to reduce onboarding friction.
- **Observability hooks**: typed `on*` callbacks for decode / unknown-entity
  / view-type-mismatch in `@patternmeshjs/streams`.
- **Cursor signing**: HMAC-signed opaque cursors for untrusted boundaries.
- **`@patternmeshjs/kinesis`**: parallel package for Kinesis Data Streams
  consumers.
- **Shard polling**: direct `GetRecords` helpers for non-Lambda consumers.

## Not planned

Items we have explicitly decided not to pursue, with reasons.

- **Global Tables / multi-region routing** — consumer-owned; DynamoDB
  handles the replication and we don't want to be in the routing business.
- **Schema migrations** _inside_ `core` — migrations belong in
  `@patternmeshjs/migrations` with their own cadence. Guidance lives in
  [docs/design/single-table-patterns.md](./docs/design/single-table-patterns.md).
- **Automatic sharding** — the library exposes explicit key building so
  consumers can reason about hotspots; auto-sharding hides the problem.
- **GraphQL integration, NestJS integration** — framework-specific
  integrations dilute focus. Consumers can wrap repositories themselves.
- **Full codegen / ORM platform** — directly opposed to "repositories over
  generated code."
- **Visual Workbench clone as a primary product** — `@patternmeshjs/devtools`
  explains compiled plans; it does not try to replace NoSQL Workbench.
- **Multi-backend / non-DynamoDB abstraction** — our differentiator is
  access-pattern-first DynamoDB design. Broadening would weaken the story.
- **Public `derived()` / `internal()` field builders** — these stay
  compiler-internal (see
  [docs/dev/repo-architecture.md](./docs/dev/repo-architecture.md)). Re-open
  only when a concrete use case requires them.
- **Decorators-based DSL** — the fluent builder expresses everything
  decorators would, without coupling to TypeScript's decorator evolution.

## How to influence the roadmap

Open an issue describing your use case, prior art, and constraints. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process and
[docs/dev/](./docs/dev/) for the deeper maintainer docs.
