# @patternmeshjs/core

[![npm version](https://img.shields.io/npm/v/%40patternmeshjs%2Fcore.svg)](https://www.npmjs.com/package/@patternmeshjs/core)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)
[![CI](https://github.com/patternmesh/patternmesh/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/patternmesh/patternmesh/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-patternmesh.github.io-blue)](https://patternmesh.github.io/patternmesh/api/core/)

The core modeling package for patternmesh.

It provides:

- table and entity declarations
- access-pattern compilation
- typed repositories
- update builders and conditions
- transactions, batch APIs, relations, read bundles, and write recipes
- lifecycle recipes (`softDelete`, `archive`)

## Install

```bash
pnpm add @patternmeshjs/core
```

Requirements:

- Node 18+
- ESM-only

## Public API reference

### Table and keys

- `defineTable`
- `key`
- `Brand`

### Field builders

- `string`
- `number`
- `boolean`
- `datetime`
- `enumType`
- `id`
- `json`
- `ttl`
- `object`
- `record`
- `list`
- `stringSet`
- `numberSet`
- `fieldRef`
- `pathRef`

### Field and schema types

- `FieldDef`
- `SchemaRecord`
- `InferItem`
- `CreateInput`
- `PrimaryKeyInput`
- `SettableShape`
- `AddableShape`
- `RemovableKeys`
- `FieldRef`

### Entity compilation

- `entity`
- `CompiledEntity`
- `COMPILED_ENTITY`

### Connection and repositories

- `connect`
- `ConnectOptions`
- `ConnectedDb`

Each repository exposes:

- `create(data, options?)` — strict not-exists write
- `put(data, options?)` — unconditional write
- `get(key)`
- `delete(key, options?)`
- `find.<pattern>(input)`
- `batchGet(keys)`
- `batchWrite({ puts, deletes })`
- `update(key)`
- `explain.create`
- `explain.put`
- `explain.get`
- `explain.delete`
- `explain.find.<pattern>`
- `explain.batchGet`
- `explain.batchWrite`

### Relations, bundles, and recipes

- `createRelations`
- `createReadBundles`
- `createWriteRecipes`
- `RelationBuilder`
- `ReadBundleBuilder`
- `ReadBundleStepBuilder`
- `WriteRecipeBuilder`
- `WriteRecipeStepBuilder`
- `RelationDecl`
- `RelationsConfig`
- `HasManyDecl`
- `BelongsToDecl`
- `HasManyThroughDecl`
- `ReadBundleStepDecl`
- `ReadBundleDecl`
- `ReadBundlesConfig`
- `WriteRecipeStepDecl`
- `WriteRecipeDecl`
- `WriteRecipesConfig`

### Transactions

- `TRANSACT_MAX_ITEMS`
- `TransactWriteBuilder`
- `TransactReadBuilder`
- `createTransactServices`

### Core types

- `CompiledOperation`
- `Page`
- `OpaqueCursor`
- `DynamoReadPlan`
- `AccessPatternDef`
- `FieldMeta`
- `BatchChunkPlan`
- `QuerySelectMode`
- `ReturnConsumedCapacityMode`

### Adapter-facing types

- `DynamoAdapter`
- `GetItemInput`
- `PutItemInput`
- `DeleteItemInput`
- `DeleteItemOutput`
- `QueryInput`
- `UpdateItemInput`
- `QueryOutput`
- `ScanInput`
- `ScanOutput`
- `ConsumedCapacity`
- `PutItemOutput`
- `BatchGetItemInput`
- `BatchGetItemOutput`
- `BatchWriteItemInput`
- `BatchWriteItemOutput`
- `BatchWritePut`
- `BatchWriteDelete`
- `TransactGetSlot`
- `TransactGetItemsInput`
- `TransactGetItemsOutput`
- `TransactWriteItemInput`
- `TransactWriteItemsInput`

### Errors

- `DynamoModelError`
- `ValidationError`
- `ConfigurationError`
- `ConditionFailedError`
- `ItemAlreadyExistsError`
- `NotUniqueError`
- `QueryLimitError`
- `BatchWriteExhaustedError`
- `BatchGetExhaustedError`
- `TransactionCanceledError`
- `IdempotentParameterMismatchError`
- `TransactionCancellationReason`

### Utilities

- `createAccessPatternFactory`
- `BATCH_GET_MAX_KEYS`
- `BATCH_WRITE_MAX_OPS`
- `chunkArray`
- `CreateReturnMode`
- `DeleteReturnMode`
- `encodeCursor`
- `decodeCursor`

## Behavioral contracts

### Repository semantics

- `create()` enforces `attribute_not_exists(partitionKey)` and throws
  `ItemAlreadyExistsError` on collision.
- `put()` overwrites unconditionally.
- public items omit `pk`, `sk`, index key attributes, and the internal
  discriminator.

### Batch contracts

- `batchGet(keys)` preserves input order and returns `null` for misses.
- `batchWrite({ puts, deletes })` is chunked per DynamoDB limits and throws
  `BatchWriteExhaustedError` if unprocessed items remain after retries.

### Query / scan rules

- `ConsistentRead` on a GSI route throws `ValidationError`.
- `ap.count(...)` is the supported COUNT surface.
- `ap.scan(...)` is explicit; there is no implicit repository scan.

### Transactions

- `db.tx.write` supports at most 100 participants.
- duplicate write targets are rejected before calling DynamoDB.
- writes accept `clientRequestToken` for DynamoDB's 10-minute idempotency window.

### Validation

- unknown create/update keys throw `ValidationError`
- empty Dynamo sets are rejected
- `ttl()` values must be non-negative integer epoch seconds
- `json()` values must be JSON-serializable
- cursor decoding validates shape and rejects malformed payloads

## Modeling guidance

- Embed `object`, `list`, and set fields when data is bounded and read with the
  parent item.
- Prefer child items and explicit access patterns for large or independently
  queried collections.
- Reserve logical field names for domain data only; internal table/index
  attribute names are rejected.

## Related docs

- [Repository root README](../../README.md)
- [Single-table design guide](../../docs/design/single-table-patterns.md)
- [Table setup guide](../../docs/design/table-setup.md)

### Topic cookbooks

- [Relations cookbook](../../docs/guides/relations.md)
- [Bundles and recipes](../../docs/guides/bundles-and-recipes.md)
- [Lifecycle recipes](../../docs/guides/lifecycle.md)
- [Complex attributes](../../docs/guides/complex-attributes.md)
- [Streams advanced](../../docs/guides/streams-advanced.md)
