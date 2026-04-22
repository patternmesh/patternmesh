# Single-table DynamoDB: access patterns, topologies, and how this library fits

This document is **conceptual guidance** for modeling on **one DynamoDB table**
with logical entities and explicit access patterns. It complements the runnable
snippets in the [root README](../../README.md) and the code-heavy cookbooks under
[docs/guides/](../guides/). DynamoDB behavior is authoritative; when in doubt,
see the
[AWS DynamoDB Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html).

---

## 1. Mental model: every access path is a key design

DynamoDB serves data in **O(1)** keyed access: **GetItem** and **Query** need a
concrete partition key (and usually a sort-key condition). Anything else is a
**Scan** (expensive) or a **GSI/LSI** projection you designed in advance. In
this library, **Scan is explicit opt-in** (`ap.scan`); there is no implicit
full-table scan from repositories.

In this library:

- You **define** the physical table once (`defineTable`).
- Each **entity** chooses how logical fields map to `pk` / `sk` (and optional
  GSI key attributes) via `.keys()` and `.index()`.
- Each **named access pattern** (`ap.get`, `ap.query`, `ap.unique`, `ap.count`,
  `ap.scan`) is a **supported read path** the compiler can turn into Dynamo
  requests with explicit routing.

If a question cannot be answered with "which **pk** and **sk** (or GSI)
expression do I use?", you are probably heading toward Scan, a new index, or a
denormalized item shape.

---

## 2. Single-table layout and the discriminator

**Single-table** means many logical entity kinds share one table. Items are
distinguished by:

- **Key structure** (`pk` / `sk` patterns), and
- A **discriminator** (this library uses the `entity` attribute by default,
  aligned with the entity name).

The framework **hides** `pk`, `sk`, GSI key attributes, and the internal
discriminator on **public** items returned from `get`, `find`, `create`,
`update`, and `tx.read` so application code stays **logical-first**.

**Implication:** two entities that accidentally use the **same** primary key
will collide at rest. Key design is a joint modeling exercise across entities.

---

## 3. Hierarchies: parent / child on one partition

A common topology is **one partition key per aggregate** (e.g. organization,
user, order) and **sort keys that sort related items together**:

| Pattern             | Example `sk` ideas                      | Typical access                                                  |
| ------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Root + children     | `ROOT`, `CHILD#<id>`, `CHILD#<id>#META` | `Query` partition with `begins_with` on `sk` for "all children" |
| Time-ordered events | `EVENT#<iso8601>#<id>`                  | Range queries on time prefix                                    |
| Typed slots         | `PROFILE`, `SETTINGS`, `SESSION#<id>`   | `GetItem` for singletons; `Query` for collections               |

**Parent/child listing:** prefer **Query on the base table** with a bounded key
condition (e.g. `pk = ORG#x AND begins_with(sk, "MEMBER#")`) over filtering
huge partitions without a sort-key bound.

**Limits:** a single partition is **soft-limited** in throughput (hot
partition). A deep hierarchy under one `pk` can become a **hot key** if all
traffic writes or reads that partition constantly — see §7.

---

## 4. One-to-many without a "join"

DynamoDB has **no joins**. One-to-many is expressed by:

1. **Colocation** — child items share the parent's `pk` and use `sk` ordering
   (§3), or
2. **Denormalization** — embed a bounded list or summary on the parent item
   (good for small, rarely changing sets), or
3. **GSI inversion** — project an access path "by child attribute" onto a GSI
   whose partition key is that attribute (e.g. lookup by email).

The library's **`ap.query`** and **`ap.unique`** express **one** keyed read
path per pattern name. Orchestrating "load parent then N children" is still
**application composition**; patternmesh also provides explicit relation
helpers, read bundles, and write recipes when you want named, bounded
composition surfaces. See
[docs/guides/relations.md](../guides/relations.md) and
[docs/guides/bundles-and-recipes.md](../guides/bundles-and-recipes.md).

---

## 5. Many-to-many

Typical approaches:

- **Adjacency list:** store two item types (e.g. `USER#A — FOLLOWS — USER#B`
  and reverse edge) and query each direction with appropriate `pk`/`sk` or
  GSIs.
- **Materialized "join" items:** one item per relationship with GSIs for both
  endpoints.

Both require **explicit** key and GSI design. The framework does not infer
relationships; it enforces that each **declared** pattern compiles to a valid
Dynamo request. A worked many-to-many example lives in
[docs/guides/relations.md](../guides/relations.md).

---

## 6. GSI topology and projections

**When to add a GSI:** when a **new query axis** is required (lookup by email,
by status, by external id) that is **not** the base table's primary key.

**Projection tradeoffs:**

- **`ALL`** — simplest; higher storage cost on the index; `Query` can satisfy
  more attribute reads from the index alone.
- **`KEYS_ONLY` / `INCLUDE`** — cheaper index storage; application may need
  **additional GetItem** calls if projected attributes are insufficient (this
  library's `ap.query` returns logical fields mapped from whatever Dynamo
  returned — be mindful of **partial** index payloads).

### 6.1 Local secondary indexes (LSI)

An **LSI** provides an **alternate sort key** for the **same base-table
partition key**. Items are still addressed by the same `pk`; the LSI defines a
second sort dimension (e.g. `CreatedAt`, `Priority`) for **Query** within that
partition.

**What LSIs unlock (compared to base table only)**

- **Different sort order or key shape on the same partition** — e.g. base
  table `sk` optimized for one access path; LSI sort key for "newest first"
  or "by status then time" within the same `pk`.
- **Strongly consistent reads on the LSI** — DynamoDB supports **strongly
  consistent** `Query` on an LSI (unlike GSIs, which are **eventually
  consistent**). Use when a workflow already depends on consistent reads and
  you must not see stale index rows for that partition.
- **No extra partition key** — you are not "inverting" the table onto another
  partition key; you stay within one hot partition's data layout (which is
  both a feature and a capacity risk).

**What LSIs do _not_ do**

- They **cannot** introduce a **new partition key** — that is always a **GSI**
  (or a second table).
- They **do not** fix a **hot partition**; they **share** the same `pk` as
  the base item set.

**DynamoDB constraints (brief)**

- Up to **5** LSIs per table; **10 GB** maximum per **partition key value**
  across base table + all LSI projections for that key.
- LSIs are defined **at table creation** (no adding an LSI to an existing
  table without a migration path).
- **GetItem** / **BatchGetItem** do **not** target LSIs; use Query/Scan
  patterns for LSI paths.

> [!WARNING]
> The **10 GB item-collection limit** for LSIs is one of the easiest DynamoDB
> constraints to hit unintentionally in single-table designs with
> high-cardinality children under one partition key.

**Library status:** `@patternmeshjs/core` supports **LSI declarations** on
`defineTable` and explicit Query/Scan routing by access pattern (`indexName`).
Routing remains access-pattern disciplined: no ambiguous automatic route
selection.

### 6.2 Table Scan and parallel segments

**Scan** reads items across the table (or a segment) without a partition key.
It is **expensive** in RCUs and should not replace **Query** when a key design
exists.

**When Scan is still appropriate**

- **Controlled backfills** or **exports** with **`Segment` / `TotalSegments`**
  so multiple workers scan disjoint partitions of the key space in parallel.
- **Operational** passes with tight **`Limit`**, **`FilterExpression`**, and
  projection — never "load the world" in a request path.

The library shape is an **explicit opt-in** `ap.scan` with segment parameters,
**not** an implicit repository scan. `explain()` emits stronger scan warnings
than query-filter warnings to make the cost model obvious.

---

## 7. Sharding, hot partitions, and "fan-out writes"

If **one partition key** receives a disproportionate share of traffic
(celebrity user, global counter, single "config" row), you hit **hot
partition** throttling.

Mitigations (all are **design** choices, not framework magic):

- **Salt or shard writes** — spread logical ids across `pk` prefixes and use
  parallel **Query** or **BatchGet** to reassemble (complexity cost at read
  time).
- **Write sharding + aggregation** — separate counters per shard, periodic
  reducer (Streams/Lambda) — not built into core.
- **Avoid unbounded monolithic partitions** — cap list growth; paginate;
  archive to S3 + metadata row.

`@patternmeshjs/core` does not auto-shard; it helps you **keep keys explicit**
in `keys()` and access patterns so you can reason about hotspots.

---

## 8. Versioning and optimistic locking

A common pattern is a **numeric version** on an item, incremented on each
successful write, with a **condition** that the version read is still current.

This library supports a **`number().version()`** field: updates use
**`add()`** for the counter (not `set()`), and you can attach **`.if(...)`**
conditions on `update()` or in **transactions** (`tx.write`) so conflicting
writers fail with **`ConditionFailedError`** (single-item) or
**`TransactionCanceledError`** (transact).

**Note:** DynamoDB **TransactWriteItems** cannot mix arbitrary
**read-your-write** semantics with writes in **one** API call the way some
SQL databases can; **TransactGetItems** and **TransactWriteItems** are
separate operations. The framework enforces **single-table** transact
participants today.

---

## 9. Transactions (`db.tx`) in this stack

Use **`db.tx.write`** when you need **all-or-nothing** writes (Put / Update /
Delete / ConditionCheck) up to **100** items, optional **`ClientRequestToken`**
for idempotent retries on writes.

Use **`db.tx.read`** for up to **100** consistent structured reads with
**labeled** results. Missing keys or **discriminator mismatch** for the
requested entity surface as **`null`** (post-read validation/mapping — not
server-side filtering).

Core **preflights**: same **table name** as `connect()`, **no duplicate item
targets** on writes, **100-item** cap. The **4 MB** payload limit is enforced
by AWS; oversized marshalled requests may still fail after validation.

---

## 10. Pagination, counts, and filters

- **Query pagination** — use cursors returned from paginated `ap.query`
  patterns where exposed by the repository API.
- **`ap.count`** — issues **COUNT** queries (multi-page internally as needed);
  understand that **filters** and GSIs affect **what Dynamo charges** vs
  **what you infer** — see AWS docs on consumed capacity.
- **User `FilterExpression`** on queries — supported with explicit name/value
  maps; non-key filters can consume capacity on non-matching items (the
  library's `explain()` can surface warnings).

---

## 11. Batch operations

**`batchGet`** — order-preserving, **`null`** for misses; chunked under the
hood.

**`batchWrite`** — chunked puts/deletes; **`Promise<void>`**; not a substitute
for **transactions** (no atomicity across chunks, no conditions on the same
guarantees as TransactWrite).

---

## 12. Anti-patterns (short list)

| Anti-pattern                                                  | Why                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Using **FilterExpression** as a **join**                      | No relational engine; you pay to read candidate items.                                    |
| **Unbounded `Query`** without a tight sort key                | Large partitions + `begins_with` on short prefix → high RCU.                              |
| **GSI sprawl** without query proof                            | Every index costs storage and write amplification.                                        |
| **Same logical entity, two key shapes**                       | Collision or explain-time confusion; pick one canonical key.                              |
| Expecting **cross-item atomic read+write** in one Dynamo call | Use TransactWrite + application-level read strategy, or redesign for single-item updates. |

---

## 12.1 Complex attributes: when to embed vs model child items

Use embedded `object` / `record` / `list` / `set` fields when data is:

- bounded in size,
- read/written with the same parent item,
- not independently queried by alternate access patterns.

Prefer separate child items/entities when data is:

- high-cardinality or unbounded,
- high-churn with frequent partial mutations,
- independently queried, paginated, or access-pattern routed.

Operational notes:

- Dynamo sets are unordered/unique and cannot be empty.
- Large mutable lists are often better modeled as child items.
- Nested maps are convenient for per-item settings but can become opaque if
  used as a substitute for explicit access patterns.

For builder-level examples and nested update patterns, see
[docs/guides/complex-attributes.md](../guides/complex-attributes.md).

---

## 13. TTL, lifecycle, and streams interplay

Design notes (runnable examples live in the topic guides):

- TTL is an **eventual** purge. Expired items can remain queryable until the
  service-side sweeper runs. For correctness-sensitive reads, apply an
  explicit filter on the TTL attribute.
- **Soft delete** is an in-place marker (for example `deletedAt` plus
  tombstone fields); good for short retention windows and undo flows.
- **Archive** copies the item into an archive-shape entity, then marks or
  deletes the source. Always modeled as an explicit recipe; there are no
  hidden cascades.
- TTL purges appear as service-originated **REMOVE** stream records. Use
  `isTtlRemove(record)` to distinguish them from user deletes.
- Streams have roughly 24-hour retention and shard-scoped ordering. Do not
  rely on global cross-shard order.

Code-heavy walkthroughs:

- [docs/guides/lifecycle.md](../guides/lifecycle.md) for soft delete and archive
  recipes.
- [docs/guides/streams-advanced.md](../guides/streams-advanced.md) for decode,
  routing, and TTL-aware handling.

---

## 14. Where to look next

- **Access-pattern and key design**: stay on this page.
- **Runnable end-to-end flows**: [docs/guides/](../guides/).
- **API contracts (batch sizes, errors, `explain`)**:
  [packages/core/README.md](../../packages/core/README.md).
- **Table provisioning**: [docs/design/table-setup.md](./table-setup.md).
