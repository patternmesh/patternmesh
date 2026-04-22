# Adapter contracts

`@patternmeshjs/core` defines a narrow `DynamoAdapter` interface; everything
else is an implementation. This page specifies what a new adapter must
deliver and which guarantees are the adapter's problem vs. `core`'s problem.

## The `DynamoAdapter` surface

The current interface lives in
[`packages/core/src/adapter.ts`](../../packages/core/src/adapter.ts) and
covers the subset of DynamoDB operations the library compiles to:

- `getItem`
- `putItem` (supports `ReturnValues: ALL_NEW` so `create()` / `put()` can
  round-trip via one call)
- `deleteItem`
- `query`
- `updateItem` (supports `ReturnValues: ALL_NEW`)
- batch + transact variants matching the batch/tx surfaces in `core`

The reference implementation is
[`createAwsSdkV3Adapter`](../../packages/adapter-aws-sdk-v3/src/index.ts) in
`@patternmeshjs/aws-sdk-v3`.

## Round-trip guarantees

An adapter **must** round-trip faithfully for every operation. "Faithfully"
means:

1. **Field preservation** — every field `core` writes comes back unchanged
   on the next read. Numbers stay numbers, sets stay sets, binary stays
   binary. If the underlying SDK requires marshalling (as DocumentClient
   does), the adapter is responsible for the round-trip.
2. **Attribute-name transparency** — adapters must pass through
   `ExpressionAttributeNames` / `ExpressionAttributeValues` unchanged. Do not
   merge, deduplicate, or rename aliases; `core` may rely on stable aliasing
   for test snapshots.
3. **`ReturnValues` honored** — when `core` requests `ALL_NEW`, the adapter
   must surface the returned attributes as the operation's result (e.g. from
   `PutItemOutput.Attributes` or `UpdateItemOutput.Attributes`). `create()`
   and `update().go()` both rely on this to avoid a follow-up `Get`.
4. **Consumed-capacity passthrough** — when a consumer opts into
   `ReturnConsumedCapacity`, the adapter must surface the SDK response field
   on the operation result unchanged. `core` does not synthesize these
   numbers and will not validate them — it just passes them up.
5. **Error fidelity** — AWS errors surface as typed SDK errors (or their
   structural equivalent in non-SDK adapters). Do **not** catch-and-rethrow
   as generic `Error`s; do not downgrade
   `ConditionalCheckFailedException` into a different error type. `core`
   owns mapping those exceptions to `ConditionFailedError`,
   `NotUniqueError`, etc. via `aws-error.ts`.

## Layering rules

- **`core` owns semantics.** Error mapping, `Item` stripping, `explain`
  formatting, condition/update expression generation — all live in `core`.
  Adapters must not re-implement any of these.
- **Adapters own transport and serialization.** Retry, middleware,
  marshalling, endpoint resolution, credential handling.
- **Adapters are minimal.** The reference adapter is a single file. If a new
  adapter grows past ~200 lines of non-test code, stop and ask whether logic
  belongs in `core` instead.

## Middleware / retry neutrality

An adapter must not:

- Retry on `ConditionalCheckFailedException`. This is a success path for
  `create()` (item already exists) and must reach `core` intact.
- Retry on `TransactionCanceledException` automatically. Idempotency via
  `ClientRequestToken` is the caller's choice; the adapter must surface the
  cancellation so `core` can decide.
- Coalesce batches. If `core` passes 100 `BatchGet` keys, the adapter does one
  `BatchGet` with 100 keys. Chunking is `core`'s job (see `batch.ts`).

Retry policy for truly transient errors (`ProvisionedThroughputExceeded`,
network errors) is an adapter concern, but should be opt-in configuration,
not a default that hides backpressure from consumers.

## Integration test expectations

A new adapter needs, at minimum, integration-test parity with the AWS SDK v3
adapter. The reference suite lives in
[`packages/adapter-aws-sdk-v3/test/dynamodb-local.integration.test.ts`](../../packages/adapter-aws-sdk-v3/test/dynamodb-local.integration.test.ts).

Coverage bar:

- [ ] `create()` with all scalar field types round-trips
- [ ] `create()` on an existing key throws `ItemAlreadyExistsError` (maps
      from `ConditionalCheckFailedException`)
- [ ] `put()` overwrites silently
- [ ] `get()` returns `null` for a missing key, not `undefined` or an error
- [ ] `update().set().go()` returns the public `Item` shape (no physical
      attrs, no discriminator)
- [ ] `update().if(...).go()` with a failing condition throws
      `ConditionFailedError`
- [ ] `delete()` is idempotent (no error on missing key)
- [ ] `find.<pattern>` queries work on base table keys **and** on every
      declared GSI
- [ ] `find.<unique>(...)` throws `NotUniqueError` on a 2+ match
- [ ] Pagination via `cursor` round-trips through `OpaqueCursor` encoding
- [ ] `batchGet` / `batchWrite` handle chunking correctly at ≥ 100 / ≥ 25
      items respectively
- [ ] `tx.write(...)` with a `conditionCheck` participant fails atomically
      with `ConditionFailedError` when the check fails
- [ ] `tx.write(...)` with `clientRequestToken` is idempotent within the
      DynamoDB 10-minute window
- [ ] `explain.<op>(...)` and the actual adapter invocation produce
      identical `ExpressionAttributeNames` / `ExpressionAttributeValues`
      maps (catches accidental aliasing divergence)

Snapshots from `packages/core/test/` must still pass against the mock
adapter — a new adapter cannot change compiler output. If a snapshot changes
because of the new adapter, the adapter is doing too much; move the logic
into `core`.

## Related docs

- [Repo architecture § package boundaries](./repo-architecture.md#package-boundaries)
  — why `core` has zero AWS SDK dependencies.
- [Adding a package](./adding-a-package.md) — scaffold a new adapter package
  alongside the adapter contract.
- [Testing](./testing.md) — how the integration suite is wired up.
