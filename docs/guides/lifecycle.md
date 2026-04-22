# Lifecycle recipes

## What they are

Explicit, transaction-backed helpers for item end-of-life flows. patternmesh
ships two canonical recipes and exposes the same orchestration primitive that
you can compose into your own.

- `db.lifecycle.softDelete` — in-place tombstone on the original item.
- `db.lifecycle.archive` — copy into an archive-shape entity plus an explicit
  disposition on the source (`mark`, `delete`, or `none`).

Both are built on `db.orchestrate.write`, so every step runs inside one
`TransactWriteItems` call. There are no hidden cascades and no implicit
deletes.

## Prerequisites

An entity that participates in the lifecycle. For soft delete, add
`deletedAt` (TTL or plain number) and any tombstone fields you want to carry.
For archive, model the archive as its own entity so you can query it
separately.

```ts
import {
  connect,
  defineTable,
  entity,
  enumType,
  id,
  key,
  number,
  string,
  ttl,
} from "@patternmeshjs/core";

const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
});

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
  name: string().required(),
  status: enumType(["active", "suspended", "deleted"] as const).required(),
  deletedAt: ttl().optional(),
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

const UserArchive = entity("UserArchive", {
  userId: id("usr").required(),
  email: string().required(),
  name: string().required(),
  archivedAt: number().required(),
})
  .inTable(AppTable)
  .keys(({ userId }: { userId: string }) => ({
    pk: key("USER", userId),
    sk: key("ARCHIVE"),
  }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }: { userId: string }) => ({
      pk: key("USER", userId),
      sk: key("ARCHIVE"),
    })),
  }));

const db = connect(AppTable, {
  adapter,
  entities: { User, UserArchive },
});
```

## Soft delete

```ts
const now = Math.floor(Date.now() / 1000);

await db.lifecycle.softDelete({
  entity: User,
  key: { userId: "usr_1" },
  deletedAtEpochSeconds: now,
  tombstone: { status: "deleted" },
  clientRequestToken: "delete-usr_1-001",
});
```

What this compiles to:

- one `Update` on `User` (`sk = PROFILE`) that sets `deletedAt` and every key
  in `tombstone`
- runs inside a single transact-write for idempotency and retry safety

Reads do **not** automatically hide soft-deleted items. Filter explicitly:

```ts
const user = await db.User.get({ userId: "usr_1" });
const isActive = user && user.deletedAt === undefined;
```

## Archive

```ts
const user = await db.User.get({ userId: "usr_1" });
if (!user) throw new Error("user not found");

const now = Math.floor(Date.now() / 1000);

await db.lifecycle.archive({
  sourceEntity: User,
  sourceKey: { userId: user.userId },
  archiveEntity: UserArchive,
  archiveItem: {
    userId: user.userId,
    email: user.email,
    name: user.name,
    archivedAt: now,
  },
  sourceDisposition: "mark",
  markDeletedAtEpochSeconds: now,
  markFields: { status: "deleted" },
  clientRequestToken: "archive-usr_1-001",
});
```

Dispositions:

- `mark` — updates the source with `deletedAt` (if `markDeletedAtEpochSeconds`
  is provided) plus `markFields`.
- `delete` — removes the source in the same transaction as the archive put.
- `none` — leaves the source untouched; useful for snapshot-style archives.

The `archiveEntity` can live in the same table (different `sk`) or in a
separate `defineTable` row if you connect against a different adapter.

## TTL interplay

- `deletedAt` modeled with `ttl()` schedules a service-side purge. Sweeps are
  **eventual**; the item remains readable until DynamoDB removes it.
- If `deletedAt` is in the past, reads that care about that window must still
  filter. patternmesh does not hide expired items.
- TTL purges appear as `REMOVE` stream records. Use
  [`isTtlRemove`](../../packages/streams/README.md#ttl-behavior) to distinguish
  them from user-driven deletes.

## Contracts and failure modes

- Every recipe runs in one transaction. AWS caps apply (100 participants,
  4 MB payload). Failures surface as `TransactionCanceledError` with per-item
  reasons; nothing is written.
- `clientRequestToken` makes retries idempotent for 10 minutes. Reuse the same
  token for safe retries of the same logical operation.
- Soft delete requires the `deletedAt` path to be writable on the entity.
  Unknown paths throw `ValidationError` at `setPath` time.
- Archive requires both entities to share the same `defineTable` instance you
  passed to `connect`.

## Custom recipes

When soft delete and archive are not enough, drop down to
`db.orchestrate.write` directly:

```ts
await db.orchestrate.write(
  async (o) => {
    o.put("archivePut", UserArchive, {
      userId: "usr_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      archivedAt: Math.floor(Date.now() / 1000),
    });
    o.delete("sourceDelete", User, { userId: "usr_1" });
    o.conditionCheck("orgPresent", Org, { orgId: "org_1" }, (fields, op) => op.exists(fields.name));
  },
  { clientRequestToken: "custom-archive-001" },
);
```

## Non-goals

- hidden cascades across relations — use an explicit recipe or write bundle
- scheduled purges — use DynamoDB TTL for timed removal, with filters on reads
- audit logs as a side effect — add an explicit `put` step if you need one

## See also

- [docs/guides/streams-advanced.md](./streams-advanced.md) for how soft
  delete, archive, and TTL removals look on the stream.
- [docs/guides/bundles-and-recipes.md](./bundles-and-recipes.md) for the
  declarative recipe surface that can express the same flows.
- [docs/single-table-patterns.md](../single-table-patterns.md) for the design
  rationale behind explicit recipes over implicit hooks.
