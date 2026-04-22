# patternmesh

[![npm version](https://img.shields.io/npm/v/%40patternmeshjs%2Fcore?label=%40patternmeshjs%2Fcore)](https://www.npmjs.com/package/@patternmeshjs/core)
[![npm version](https://img.shields.io/npm/v/%40patternmeshjs%2Faws-sdk-v3?label=%40patternmeshjs%2Faws-sdk-v3)](https://www.npmjs.com/package/@patternmeshjs/aws-sdk-v3)
[![npm version](https://img.shields.io/npm/v/%40patternmeshjs%2Fstreams?label=%40patternmeshjs%2Fstreams)](https://www.npmjs.com/package/@patternmeshjs/streams)
[![CI](https://github.com/patternmesh/patternmesh/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/patternmesh/patternmesh/actions/workflows/ci.yml)
[![CodeQL](https://github.com/patternmesh/patternmesh/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/patternmesh/patternmesh/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![provenance](https://img.shields.io/badge/npm-provenance-informational)](https://docs.npmjs.com/generating-provenance-statements)
[![Node.js](https://img.shields.io/node/v/%40patternmeshjs%2Fcore.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docs](https://img.shields.io/badge/docs-patternmesh.github.io-blue)](https://patternmesh.github.io/patternmesh/)

TypeScript-first DynamoDB tooling for **single-table design**: logical entities,
hidden physical keys, explicit access patterns, typed repositories, and
explainable compiled operations.

## Why patternmesh?

- repositories instead of raw `pk` / `sk` strings in application code
- explicit access patterns instead of implicit query magic
- explainable compiled DynamoDB operations
- strong typing without pretending DynamoDB is relational

## Packages

| Package                                                              | Purpose                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`@patternmeshjs/core`](packages/core/README.md)                     | schema DSL, repositories, access patterns, transactions, relations |
| [`@patternmeshjs/aws-sdk-v3`](packages/adapter-aws-sdk-v3/README.md) | AWS DocumentClient adapter                                         |
| [`@patternmeshjs/streams`](packages/streams/README.md)               | typed stream decoding and routing                                  |

## Install

```bash
pnpm add @patternmeshjs/core @patternmeshjs/aws-sdk-v3 @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

Also supported:

```bash
npm install @patternmeshjs/core @patternmeshjs/aws-sdk-v3 @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
yarn add @patternmeshjs/core @patternmeshjs/aws-sdk-v3 @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

Requirements:

- **Node 18+**
- **TypeScript 5.7+**
- **ESM-only**
- a DynamoDB table that already exists and matches your `defineTable(...)`
  declaration — see [docs/design/table-setup.md](docs/design/table-setup.md)

Examples below use plain strings for IDs for readability. If your application
preserves branded ID aliases, pass those typed values at your boundaries.

## Quick start

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createAwsSdkV3Adapter } from "@patternmeshjs/aws-sdk-v3";
import { connect, defineTable, entity, id, key, string } from "@patternmeshjs/core";

const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
});

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
  name: string().required(),
})
  .inTable(AppTable)
  .keys(({ userId }: { userId: string }) => ({
    pk: key("USER", userId),
    sk: key("PROFILE"),
  }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }: { userId: string }) => ({
      pk: key("USER", userId),
      sk: key("PROFILE"),
    })),
  }));

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const db = connect(AppTable, {
  adapter: createAwsSdkV3Adapter(doc),
  entities: { User },
});

await db.User.create({
  userId: "usr_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
});

const user = await db.User.get({ userId: "usr_1" });
const plan = db.User.explain.get({ userId: "usr_1" });
```

## `create()` vs `put()`

- `create(data)` means **not exists**. It fails with `ItemAlreadyExistsError`
  if the primary key is already present.
- `put(data)` means **unconditional write / overwrite**.

## Core workflows

### Explain compiled requests

```ts
db.User.explain.create({
  userId: "usr_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
});

db.User.explain.get({ userId: "usr_1" });
```

### Updates and conditions

```ts
const updated = await db.User.update({ userId: "usr_1" }).set({ name: "Ada Byron" }).go();
```

### Transactions

```ts
await db.tx.write(
  async (w) => {
    w.put(User, {
      userId: "usr_2",
      email: "tx@example.com",
      name: "Tx User",
    });

    w.conditionCheck(User, { userId: "usr_1" }, (fields, op) => op.exists(fields.email));
  },
  { clientRequestToken: "write-001" },
);
```

Idempotent transact writes use DynamoDB's **10-minute client request token
window**.

### Relations

After declaring relations in `connect(...)`, repositories expose concrete helper
namespaces over your explicit access patterns:

```ts
// Load an org's members through a declared relation alias.
const members = await db.Org.members.list({ orgId: "org_1" });

// Resolve target entities through a many-to-many edge.
const orgs = await db.User.orgs.listTargets({ userId: "usr_1" });
```

See also: [docs/guides/relations.md](docs/guides/relations.md) for the full
`hasMany` / `belongsTo` / `hasManyThrough` cookbook.

### Streams and TTL

`@patternmeshjs/streams` decodes DynamoDB stream records into entity-aware logical
items; it is **not** a stream processing framework.

```ts
import { decodeStreamEvent, isTtlRemove } from "@patternmeshjs/streams";

const decoded = decodeStreamEvent(event, {
  decoders: { User: (item) => item },
  requiredViewType: ["NEW_AND_OLD_IMAGES"],
  unknownEntityMode: "strict",
});

const ttlRemovals = event.Records.filter(isTtlRemove);
```

TTL models the attribute and validation only. Deletion timing remains DynamoDB
service behavior, so read paths that care about expiration must still filter or
condition-check expired items explicitly.

See also: [docs/guides/streams-advanced.md](docs/guides/streams-advanced.md)
for multi-entity routing, tolerant mode, and TTL-aware handling, and
[docs/guides/lifecycle.md](docs/guides/lifecycle.md) for `softDelete` and
`archive` recipes.

## Documentation

### Hosted docs

The full documentation site (this README, all package READMEs, topic guides,
and TypeDoc API reference) is built from `main` and published to GitHub
Pages: **<https://patternmesh.github.io/patternmesh/>**.

### Packages

- [Core API](packages/core/README.md)
- [AWS SDK v3 adapter](packages/adapter-aws-sdk-v3/README.md)
- [Streams API](packages/streams/README.md)

### Guides

- [Relations cookbook](docs/guides/relations.md) — `hasMany`, `belongsTo`,
  `hasManyThrough` end-to-end.
- [Bundles and recipes](docs/guides/bundles-and-recipes.md) — declared read
  bundles and transactional write recipes.
- [Lifecycle recipes](docs/guides/lifecycle.md) — soft delete, archive, and
  TTL interplay.
- [Complex attributes](docs/guides/complex-attributes.md) — objects, records,
  lists, sets, nested path updates.
- [Streams advanced](docs/guides/streams-advanced.md) — multi-entity router,
  tolerant mode, TTL-aware handling, failure-mode catalog.

### Design and setup

- [Single-table design guide](docs/design/single-table-patterns.md)
- [Table setup guide](docs/design/table-setup.md)
- [API reference generation](docs/design/api-reference.md)

### Contributor docs

For working **on** the repo rather than with the packages:

- [Dev docs index](docs/dev/README.md)
- [Repo architecture](docs/dev/repo-architecture.md) — workspace topology,
  package boundaries, design principles
- [Validation boundary](docs/dev/validation-boundary.md) — compiler-first,
  Zod-optional architecture target

### Project

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## Positioning and limitations

patternmesh is optimized for **domain-first DynamoDB modeling** with explicit,
typed read/write surfaces.

It intentionally does **not** provide:

- automatic schema migrations
- hidden join inference or eager graph loading
- automatic sharding or hotspot mitigation
- stream checkpointing or shard polling frameworks
- Global Tables or cross-region abstractions

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

### DynamoDB Local

```bash
docker compose up -d dynamodb-local
export DYNAMODB_ENDPOINT=http://localhost:8000
pnpm --filter @patternmeshjs/aws-sdk-v3 test
```

Without `DYNAMODB_ENDPOINT`, adapter integration tests are skipped.
