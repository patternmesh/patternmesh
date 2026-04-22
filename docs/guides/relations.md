# Relations cookbook

## What it is

Declarative, named traversals over your explicit access patterns. Relations do
not invent joins or hidden routes; they attach a small typed namespace on top
of patterns you already declared. Three relation kinds are supported:

- `hasMany` — one root to many targets that live on the root's partition.
- `belongsTo` — a child pointing back at its parent (one `GetItem`).
- `hasManyThrough` — many-to-many via an explicit edge entity.

All three compose with `ap.get`, `ap.query`, `ap.unique`, and
`batchGet` under the hood.

## Prerequisites

A single-table `AppTable` and compiled entities for every participant:

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createAwsSdkV3Adapter } from "@patternmeshjs/aws-sdk-v3";
import { connect, defineTable, entity, enumType, id, key, string } from "@patternmeshjs/core";

const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
});

const Org = entity("Org", {
  orgId: id("org").required(),
  name: string().required(),
})
  .inTable(AppTable)
  .keys(({ orgId }: { orgId: string }) => ({
    pk: key("ORG", orgId),
    sk: key("ROOT"),
  }))
  .identity(["orgId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ orgId }: { orgId: string }) => ({
      pk: key("ORG", orgId),
      sk: key("ROOT"),
    })),
  }));

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

const Membership = entity("Membership", {
  orgId: id("org").required(),
  userId: id("usr").required(),
  role: enumType(["admin", "member"] as const).required(),
})
  .inTable(AppTable)
  .keys(({ orgId, userId }: { orgId: string; userId: string }) => ({
    pk: key("ORG", orgId),
    sk: key("MEMBER", userId),
  }))
  .identity(["orgId", "userId"])
  .accessPatterns((ap) => ({
    byOrg: ap.query(({ orgId }: { orgId: string }) => ({
      pk: key("ORG", orgId),
      skBeginsWith: key("MEMBER"),
    })),
    byUser: ap.query(({ userId }: { userId: string }) => ({
      pk: key("USER", userId),
      skBeginsWith: key("ORG"),
    })),
  }));
```

## End-to-end: Org / User / Membership

Wire all three relation kinds at `connect` time:

```ts
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const db = connect(AppTable, {
  adapter: createAwsSdkV3Adapter(doc),
  entities: { Org, User, Membership },
  relations: (r) =>
    r
      .hasMany("Org", "members", {
        target: "Membership",
        listPattern: "byOrg",
        mapCreate: (input) => ({
          orgId: input.orgId,
          userId: input.userId,
          role: input.role,
        }),
      })
      .hasManyThrough("User", "orgs", {
        through: "Membership",
        target: "Org",
        listPattern: "byUser",
        mapTargetKey: (edge) => ({ orgId: edge.orgId }),
        mapAdd: (input) => ({
          orgId: input.orgId,
          userId: input.userId,
          role: input.role,
        }),
      })
      .belongsTo("Membership", "org", {
        target: "Org",
        mapGet: (edge) => ({ orgId: edge.orgId }),
      }),
});

await db.Org.create({ orgId: "org_1", name: "Acme" });
await db.User.create({
  userId: "usr_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
});

await db.Org.members.add({
  orgId: "org_1",
  userId: "usr_1",
  role: "admin",
});

const members = await db.Org.members.list({ orgId: "org_1" });
const orgs = await db.User.orgs.listTargets({ userId: "usr_1" });
const edge = await db.Membership.get({ orgId: "org_1", userId: "usr_1" });
const parentOrg = edge ? await db.Membership.org.get({ orgId: edge.orgId }) : null;
```

## Contracts and failure modes

- **Alias collision**: if a relation alias collides with an existing repository
  property (for example, `create`), `applyRelations` throws `ValidationError`
  at `connect` time.
- **Unknown entity names**: `hasMany`, `belongsTo`, and `hasManyThrough` throw
  `ValidationError` if any of `root`, `target`, or `through` is not a declared
  entity.
- **Unknown list pattern**: `listPattern` must resolve to a declared
  `ap.query` on the target (for `hasMany`) or on the through-entity (for
  `hasManyThrough`).
- **`add` requires `mapCreate` / `mapAdd`**: without a mapper, the relation
  namespace will not expose `add` at all. Call the underlying repo directly
  instead.
- **`hasMany.create` alias**: calls the target repository's strict `create`,
  so it throws `ItemAlreadyExistsError` on collisions. Use `add` (identical
  behavior) in new code.
- **`listTargets` ordering**: results come back from `batchGet`, which is
  **not** order-preserving relative to the through page. Pair with client-side
  sorting if order matters.

## Non-goals

- eager, open-ended graph traversal (use read bundles for bounded composition)
- automatic join inference across multiple valid routes — every traversal is a
  declared access pattern
- cascading deletes or updates — use explicit write recipes or transactions

## See also

- [docs/guides/bundles-and-recipes.md](./bundles-and-recipes.md) for bounded
  cross-entity reads/writes built on relations.
- [docs/design/single-table-patterns.md](../design/single-table-patterns.md) for
  key-design guidance behind each relation shape.
