# Streams advanced

## What it is

`@patternmesh/streams` turns DynamoDB Stream records into typed,
entity-aware events. It is intentionally small: decode, route, and surface
typed errors. It does **not** poll shards, manage checkpoints, or wrap any
runtime.

This guide covers multi-entity routing, tolerant mode, TTL-aware handling,
and the failure-mode catalog. For the package-level contract and basic
Lambda example, see
[packages/streams/README.md](../../packages/streams/README.md).

## Prerequisites

One or more compiled entities, plus a stream with a suitable view type.
Examples below assume a `User` and `Session` from the core quick start, and
a stream configured with `NEW_AND_OLD_IMAGES`.

```ts
import type { DynamoDBStreamHandler } from "aws-lambda";
import {
  decodeStreamEvent,
  decodeStreamRecord,
  handleStreamByEntity,
  isTtlRemove,
  StreamDecodeError,
  StreamViewTypeError,
  UnknownEntityError,
} from "@patternmesh/streams";
```

## Multi-entity router

`handleStreamByEntity` dispatches on the entity discriminator and the event
name, keeping one typed decoder per entity:

```ts
export const handler: DynamoDBStreamHandler = async (event) => {
  await handleStreamByEntity(event, {
    decoders: {
      User: (item) => item,
      Session: (item) => item,
    },
    requiredViewType: ["NEW_AND_OLD_IMAGES"],
    unknownEntityMode: "strict",
    handlers: {
      INSERT: async (evt) => {
        if (evt.entityName === "User") {
          console.log("user created", evt.newItem.userId);
        }
      },
      MODIFY: async (evt) => {
        if (evt.entityName === "Session") {
          console.log("session changed", evt.oldItem.sessionId);
        }
      },
      REMOVE: async (evt) => {
        if (evt.entityName === "User") {
          console.log("user removed", evt.oldItem.userId);
        }
      },
    },
  });
};
```

Notes:

- `decoders` is keyed by the logical entity name you passed to
  `entity("Name", ...)`.
- A decoder receives the already-decoded logical item (public fields only).
  Return it as-is, or narrow to your own type before returning.
- Handlers are awaited sequentially per record. If a handler throws, the
  record is not retried by patternmesh; Lambda's retry policy applies.

## TTL-aware handling

TTL removals come through as `REMOVE` records with the `userIdentity`
populated by the DynamoDB service. Filter them explicitly:

```ts
const records = event.Records.filter(isTtlRemove);
for (const record of records) {
  // act on scheduled purge vs. user delete differently
}
```

Combine with `handleStreamByEntity` by branching inside the handler. The
decoded event exposes the service identity fields that `isTtlRemove` checks
against, so you can branch without holding onto the raw record:

```ts
await handleStreamByEntity(event, {
  decoders: { Session: (item) => item },
  handlers: {
    REMOVE: async (evt) => {
      const isServiceRemove =
        evt.userIdentityType === "Service" &&
        evt.userIdentityPrincipalId === "dynamodb.amazonaws.com";
      if (isServiceRemove) {
        await onExpired(evt.oldItem);
      } else {
        await onUserDeleted(evt.oldItem);
      }
    },
  },
});
```

If you need the raw record (for example to log it alongside the decoded
item), decode manually instead of using `handleStreamByEntity`:

```ts
for (const record of event.Records) {
  const decoded = decodeStreamRecord(record, { decoders: { Session: (item) => item } });
  if (decoded.eventName === "REMOVE" && isTtlRemove(record)) {
    await onExpired(decoded.oldItem);
  }
}
```

## Tolerant mode

Set `unknownEntityMode: "tolerant"` when the stream may contain entities this
function does not know about (for example during a rollout):

```ts
const decoded = decodeStreamEvent(event, {
  decoders: { User: (item) => item },
  unknownEntityMode: "tolerant",
});

for (const evt of decoded) {
  if (!evt.entityName) {
    // logical item with no matching decoder — raw map, not typed
    continue;
  }
  // evt.entityName and evt.newItem/oldItem are populated
}
```

Strict mode (the default) throws `UnknownEntityError` on the first unknown
discriminator so rollouts fail loudly instead of silently dropping items.

## Non-Lambda usage

`decodeStreamEvent` and `decodeStreamRecord` operate on plain objects that
match `DynamoDBStreamEvent`. Anything that can deliver that shape works:

- local unit tests that assemble an event fixture
- replay tools that pull archived events back through decode logic
- custom consumers that call `GetRecords` directly (patternmesh does not do
  this)

```ts
const fixture: DynamoDBStreamEvent = {
  Records: [
    /* ... */
  ],
};

const decoded = decodeStreamEvent(fixture, {
  decoders: { User: (item) => item },
  requiredViewType: "any",
});
```

## Failure-mode catalog

| Condition | Error class | Thrown by |
|-----------|-------------|-----------|
| stream view type does not match `requiredViewType` | `StreamViewTypeError` | `decodeStreamRecord`, `decodeStreamEvent`, `handleStreamByEntity` |
| `eventName` is not `INSERT`/`MODIFY`/`REMOVE` | `StreamDecodeError` | `decodeStreamRecord` |
| image decoding fails (malformed attribute) | `StreamDecodeError` | `decodeStreamRecord` |
| discriminator missing or unknown and mode is strict | `UnknownEntityError` | `decodeStreamRecord`, `decodeStreamEvent`, `handleStreamByEntity` |

Every error extends `StreamDecodeError` and carries a `code` string for
programmatic branching (`"STREAM_DECODE_ERROR"`, `"STREAM_VIEW_TYPE_ERROR"`,
`"UNKNOWN_ENTITY_ERROR"`).

## Operational caveats

- stream retention is typically up to 24 hours
- ordering is shard-scoped only; cross-shard ordering is not guaranteed
- `KEYS_ONLY` streams fail by default because neither `newItem` nor `oldItem`
  is available; opt out with `requiredViewType: "any"` if you truly need it
- Lambda at-least-once delivery means handlers must be idempotent

## Non-goals

- shard polling or checkpoint orchestration
- retry frameworks
- cross-region stream abstractions
- event bus or worker runtime management

## See also

- [packages/streams/README.md](../../packages/streams/README.md) for the
  package surface and the basic Lambda example.
- [docs/guides/lifecycle.md](./lifecycle.md) for how soft delete, archive,
  and TTL purges show up on the stream.
