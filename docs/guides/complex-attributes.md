# Complex attributes

## What it is

Builders for nested and non-scalar DynamoDB attribute types, plus the path
helpers that drive targeted updates into them:

- `object(shape)` — typed fixed-shape map
- `record(valueField)` — open-key map with a uniform value type
- `list(itemField)` — ordered list of typed items
- `stringSet()` / `numberSet()` — Dynamo sets
- `json<T>()` — opaque JSON-serializable payload (the library validates that
  it serializes)
- `pathRef(path)` / update path methods — targeted mutation of nested paths
  without rewriting the whole attribute

Use these when the data is bounded and read with its parent. Prefer child
items when data is independently queried or high-churn (see
[docs/design/single-table-patterns.md §12.1](../design/single-table-patterns.md)).

## Prerequisites

A table and a User with a typed profile plus a couple of collection fields:

```ts
import {
  connect,
  defineTable,
  entity,
  enumType,
  id,
  key,
  list,
  numberSet,
  object,
  record,
  string,
  stringSet,
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
  status: enumType(["active", "suspended"] as const).required(),
  profile: object({
    locale: string().optional(),
    displayName: string().optional(),
  }).optional(),
  settings: record(string()).optional(),
  tags: list(string()).optional(),
  labels: stringSet().optional(),
  scores: numberSet().optional(),
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

const db = connect(AppTable, {
  adapter,
  entities: { User },
});
```

## End-to-end example

### Create with nested attributes

```ts
await db.User.create({
  userId: "usr_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  status: "active",
  profile: { locale: "en-GB", displayName: "Ada" },
  settings: { theme: "dark", density: "comfortable" },
  tags: ["early-adopter", "beta"],
  labels: new Set(["owner", "admin"]),
  scores: new Set([100, 200]),
});
```

### Targeted updates with `setPath`, list appends, and set add/delete

```ts
await db.User.update({ userId: "usr_1" })
  .setPath("profile.displayName", "Ada B.")
  .setPath("settings.theme", "light")
  .listAppend("tags", ["newsletter"])
  .setAdd("labels", new Set(["editor"]))
  .setDelete("scores", new Set([100]))
  .if((fields, op) => op.eq(fields.status, "active"))
  .go();
```

What to note:

- `setPath` accepts dotted paths into `object` fields and bracketed indexes
  into `list` fields (for example `"tags[0]"`). Unknown root fields throw
  `ValidationError` at build time.
- `listAppend` / `listPrepend` target `list()` fields; `setAdd` / `setDelete`
  target `stringSet()` / `numberSet()` fields. Mixing them throws
  `ValidationError`.
- Set fields reject empty sets. DynamoDB has no concept of an empty set, so
  writing one throws `ValidationError` rather than silently dropping the
  attribute.

### Conditional removes on nested paths

```ts
await db.User.update({ userId: "usr_1" })
  .removePath(["profile.displayName"])
  .if((fields, op) => op.exists(fields.profile))
  .go();
```

### `json()` payloads

```ts
import { json } from "@patternmeshjs/core";

// in the entity schema
// metadata: json<{ source: string; ingestedAt: number }>().optional(),

await db.User.update({ userId: "usr_1" })
  .set({ metadata: { source: "import-2026-04-20", ingestedAt: 1_713_600_000 } })
  .go();
```

Non-serializable values (for example functions, `undefined` inside arrays,
cycles) throw `ValidationError`.

## Contracts and failure modes

- **Schema enforcement**: every nested path the update touches must resolve to
  a declared field. Unknown paths throw `ValidationError`.
- **Empty sets rejected**: matches DynamoDB semantics; use `removePath`
  instead.
- **`json()` must be serializable**: values are round-tripped through
  `JSON.stringify`; non-serializable inputs throw `ValidationError`.
- **`datetime` must be ISO-8601**: values that fail `Date.parse` throw
  `ValidationError`.
- **`ttl()` must be non-negative integer epoch seconds**.

## Embed vs child items: a quick decision guide

| Signal                                | Embed | Child item |
| ------------------------------------- | ----- | ---------- |
| bounded size, always read with parent | yes   |            |
| high-cardinality or unbounded         |       | yes        |
| independently paginated or queried    |       | yes        |
| high-churn with many partial writes   |       | yes        |
| ordered feed with cursors             |       | yes        |

For an Org / User / Membership style many-to-many, see
[docs/guides/relations.md](./relations.md).

## Non-goals

- automatic JSON schema inference — you still declare fields explicitly
- deep validation of arbitrary JSON payloads (`json()` is opaque)
- silent coercion of invalid paths — every unknown path fails fast

## See also

- [docs/guides/relations.md](./relations.md) for child-item modeling with
  access patterns.
- [docs/guides/lifecycle.md](./lifecycle.md) for TTL and archive patterns
  that often pair with nested attributes.
- [docs/design/single-table-patterns.md §12.1](../design/single-table-patterns.md)
  for the embed-vs-child decision guidance in prose.
