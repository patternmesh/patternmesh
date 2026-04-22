# Bundles and recipes

## What they are

- **Read bundles** are named, bounded orchestrations over declared access
  patterns and relation aliases. They execute as explicit labeled steps; no
  recursive traversal, no open-ended "include" graph.
- **Write recipes** are named transactional write sequences. Every step is a
  declared `put`, `update`, `delete`, or `conditionCheck`, and the entire
  recipe runs in a single `TransactWriteItems` call.

Both surfaces are for repeatable flows where the list of participants is
known at modeling time. For ad-hoc cross-entity work, use
`db.orchestrate.write` directly.

## Prerequisites

The Org / User / Membership setup from
[docs/guides/relations.md](./relations.md), plus a small denormalized
`OrgSummary` entity for the write-recipe example:

```ts
import { entity, id, key, number, string } from "@patternmeshjs/core";

const OrgSummary = entity("OrgSummary", {
  orgId: id("org").required(),
  name: string().required(),
  memberCount: number().required().default(0),
})
  .inTable(AppTable)
  .keys(({ orgId }: { orgId: string }) => ({
    pk: key("ORG", orgId),
    sk: key("SUMMARY"),
  }))
  .identity(["orgId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ orgId }: { orgId: string }) => ({
      pk: key("ORG", orgId),
      sk: key("SUMMARY"),
    })),
  }));
```

Declare both the read bundle and write recipe at `connect` time:

```ts
const db = connect(AppTable, {
  adapter: createAwsSdkV3Adapter(doc),
  entities: { Org, User, Membership, OrgSummary },
  relations: (r) =>
    r.hasMany("Org", "members", {
      target: "Membership",
      listPattern: "byOrg",
      mapCreate: (input) => ({
        orgId: input.orgId,
        userId: input.userId,
        role: input.role,
      }),
    }),
  readBundles: (b) =>
    b.bundle("orgHydrate", (s) =>
      s
        .rootGet("org", "Org", (input) => ({ orgId: input.orgId }))
        .relation("members", "Org", "members", "list", (input) => ({
          orgId: input.orgId,
        })),
    ),
  writeRecipes: (b) =>
    b.recipe("createOrgSummary", (s) =>
      s
        .put("summary", "OrgSummary", (input) => ({
          orgId: input.orgId,
          name: input.name,
          memberCount: input.memberCount,
        }))
        .conditionCheck(
          "orgExists",
          "Org",
          (input) => ({ orgId: input.orgId }),
          (fields, op) => op.exists(fields.name),
        ),
    ),
});
```

## End-to-end example

### Run a read bundle

```ts
const hydrated = await db.read.run(
  "orgHydrate",
  { orgId: "org_1" },
  { maxSteps: 10, fanOutCap: 200 },
);

// hydrated.org        => Org | null
// hydrated.members    => readonly Membership[]
```

Inspect the compiled plan without running it:

```ts
const plan = db.read.explain("orgHydrate", { orgId: "org_1" });

for (const step of plan.steps) {
  console.log(step.label, step.kind);
}
for (const warning of plan.warnings) {
  console.warn("bundle warning:", warning);
}
```

### Run a write recipe

```ts
const labels = await db.recipes.run(
  "createOrgSummary",
  {
    orgId: "org_1",
    name: "Acme",
    memberCount: 42,
  },
  { clientRequestToken: "summary-create-001" },
);

// labels.summary    => { operation: "Put", entity: "OrgSummary" }
// labels.orgExists  => { operation: "ConditionCheck", entity: "Org" }
```

Inspect a recipe without running it:

```ts
const recipePlan = db.recipes.explain("createOrgSummary");
for (const step of recipePlan.steps) {
  console.log(step.label, step.kind, step.entity);
}
```

## Contracts and failure modes

- **Duplicate names / labels throw at `connect` time.** Bundle names, recipe
  names, step labels within a bundle, and step labels within a recipe are all
  unique; duplicates throw `ValidationError`.
- **Unknown entity / pattern references throw at `connect` time.** Every
  `rootGet`, `rootPattern`, `relation`, `put`, `update`, `delete`, and
  `conditionCheck` references a declared entity and (where applicable)
  access pattern or relation alias. Typos fail fast.
- **Read bundles are one-hop in this release.** `opts.maxDepth` above 1 throws
  `ValidationError`. Use another bundle or a caller-driven compose for deeper
  flows.
- **Read bundle budgets**: `maxSteps` (default 20) and `fanOutCap` (default
  unlimited) guard against accidental blowups. Both throw `ValidationError`
  when exceeded.
- **Write recipe atomicity**: all steps run in one `TransactWriteItems` call,
  so the 100-participant and 4 MB payload caps apply across the recipe. Pass
  `clientRequestToken` to make retries idempotent (10-minute AWS window).
- **No partial commits**: a recipe failure surfaces as
  `TransactionCanceledError` with per-item reasons; nothing is written.

## Non-goals

- graph-like "view bundles" with hidden expansion
- automatic cascade engines or implicit relationship discovery
- multi-table transactions — recipes are single-table by construction

## See also

- [docs/guides/relations.md](./relations.md) for the underlying relation
  aliases a bundle can step through.
- [docs/guides/lifecycle.md](./lifecycle.md) for soft-delete and archive
  recipes built on the same orchestration primitive.
- [docs/design/single-table-patterns.md](../design/single-table-patterns.md) for
  the design principles that motivate "declared-only" orchestration.
