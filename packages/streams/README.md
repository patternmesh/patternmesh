# @patternmeshjs/streams

[![npm version](https://img.shields.io/npm/v/%40patternmeshjs%2Fstreams.svg)](https://www.npmjs.com/package/@patternmeshjs/streams)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)
[![CI](https://github.com/patternmesh/patternmesh/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/patternmesh/patternmesh/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-patternmesh.github.io-blue)](https://patternmesh.github.io/patternmesh/api/streams/)

Typed DynamoDB Streams decoding for `@patternmeshjs/core` entity shapes.

This package is intentionally small: decode stream records, enforce stream view
contracts, and route by entity discriminator.

## Install

```bash
pnpm add @patternmeshjs/streams
```

Requirements:

- Node 18+
- ESM-only
- no `@types/aws-lambda` dependency is required for consumers

## Exports

- `decodeStreamRecord(record, options)`
- `decodeStreamEvent(event, options)`
- `handleStreamByEntity(event, options)`
- `isTtlRemove(record)`
- `StreamDecodeError`
- `StreamViewTypeError`
- `UnknownEntityError`

## Example

```ts
import { decodeStreamEvent, isTtlRemove } from "@patternmeshjs/streams";

const decoded = decodeStreamEvent(event, {
  decoders: {
    User: (item) => item,
    Order: (item) => item,
  },
  requiredViewType: ["NEW_AND_OLD_IMAGES"],
  unknownEntityMode: "strict",
});

const ttlRemovals = event.Records.filter(isTtlRemove);
```

## Lambda handler example

```ts
import type { DynamoDBStreamHandler } from "aws-lambda";
import { handleStreamByEntity } from "@patternmeshjs/streams";

export const handler: DynamoDBStreamHandler = async (event) => {
  await handleStreamByEntity(event, {
    decoders: {
      User: (item) => item,
    },
    requiredViewType: ["NEW_IMAGE", "NEW_AND_OLD_IMAGES"],
    handlers: {
      INSERT: async (evt) => {
        console.log("created", evt.entityName, evt.newItem);
      },
      MODIFY: async (evt) => {
        console.log("changed", evt.entityName, evt.oldItem, evt.newItem);
      },
      REMOVE: async (evt) => {
        console.log("removed", evt.entityName, evt.oldItem);
      },
    },
  });
};
```

## View type rules

- default `requiredViewType` is `["NEW_AND_OLD_IMAGES"]`
- set `requiredViewType: "any"` to opt out explicitly
- `newItem` consumers typically want `NEW_IMAGE` or `NEW_AND_OLD_IMAGES`
- `oldItem` consumers typically want `OLD_IMAGE` or `NEW_AND_OLD_IMAGES`
- mismatches throw `StreamViewTypeError`

## Unknown entity behavior

- `unknownEntityMode: "strict"` is the default
- strict mode throws `UnknownEntityError`
- tolerant mode passes through the logical item without typed decoding

## TTL behavior

DynamoDB TTL removals appear as service-originated `REMOVE` records. Use
`isTtlRemove(record)` to distinguish them from user-initiated deletes.

## Non-Lambda usage

The decode functions operate on the event shape, not on Lambda runtime globals.
Anything that provides a `DynamoDBStreamEvent`-compatible object can use this
package: Lambda, local tests, replay tools, or custom consumers.

## Non-goals

- shard polling / checkpoint orchestration
- retry frameworks
- cross-region stream abstractions
- event bus or worker runtime management

## Operational caveats

- stream retention is typically up to 24 hours
- ordering is shard-scoped, not global
- KEYS_ONLY streams will fail by default unless you opt out with
  `requiredViewType: "any"`

## See also

- [Streams advanced cookbook](../../docs/guides/streams-advanced.md) —
  multi-entity routing, TTL-aware flows, tolerant mode, and failure-mode
  catalog.
- [Lifecycle recipes](../../docs/guides/lifecycle.md) — how soft delete and
  archive writes appear on the stream.
