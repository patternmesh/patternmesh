# Testing

## Layout

Tests live next to the code they cover, under `packages/*/test/`:

```text
packages/core/test/
  key.test.ts                            # key-template composition
  validation.test.ts                     # strict-shape + required/enum checks
  complex-attributes.test.ts             # object/list/set/json codecs
  update-explain.test.ts                 # update-builder explain snapshots
  reserved-attrs.test.ts                 # reserved-word handling in expressions
  put-vs-create.test.ts                  # create() vs put() semantics
  relations.test.ts                      # hasMany / belongsTo / hasManyThrough
  transact.test.ts                       # tx.write / tx.read participants
  cursor.test.ts                         # opaque cursor encode/decode
  lifecycle-ttl.test.ts                  # ttl() + softDelete / archive recipes
  repository-batch-query-explain-options.test.ts
  entity.integration.test.ts             # in-memory mock-adapter integration
  mock-adapter.ts                        # shared test double used by core
  types/                                 # expect-type suites

packages/adapter-aws-sdk-v3/test/
  index.unit.test.ts                     # unit tests over the adapter surface
  dynamodb-local.fixture.ts              # shared deterministic DynamoDB Local harness
  dynamodb-local-*.integration.test.ts   # focused integration suites

packages/streams/test/
  streams.test.ts
```

## Running tests

```bash
pnpm test                                # all packages
pnpm test:coverage                       # all packages with threshold enforcement
pnpm --filter @patternmeshjs/core test   # just core
pnpm --filter @patternmeshjs/aws-sdk-v3 test  # adapter (needs DYNAMODB_ENDPOINT)
pnpm --filter @patternmeshjs/aws-sdk-v3 test:integration
```

Turbo caches `test` task results keyed on `src/**`, `test/**`,
`vitest.config.ts`, and `package.json` plus the `DYNAMODB_ENDPOINT`
environment variable (see [`turbo.json`](../../turbo.json)).

## Unit vs integration

Two categories, both driven by Vitest:

1. **Unit tests** (default) — run anywhere with no external services. `core`
   uses the in-memory `mock-adapter.ts` for repository behavior coverage.
2. **Integration tests** — round-trip through DynamoDB Local via the AWS
   adapter. Gated on `DYNAMODB_ENDPOINT`; automatically skipped when unset.

```bash
docker compose up -d dynamodb-local
export DYNAMODB_ENDPOINT=http://localhost:8000
pnpm --filter @patternmeshjs/aws-sdk-v3 test
```

CI always sets `DYNAMODB_ENDPOINT` via the `docker compose up -d
dynamodb-local` step in both `ci.yml` and `release.yml`, so integration tests
run on every PR.

Integration suites use deterministic table names derived from the suite name
plus CI/local run IDs (instead of `Date.now()` / random suffixes) so reruns are
reproducible and failures are easier to triage.

## Coverage standards

Coverage is enforced in each package via `vitest --coverage` and package-local
thresholds:

- `@patternmeshjs/core`: lines 76, branches 67, functions 75, statements 76
- `@patternmeshjs/aws-sdk-v3`:
  - with `DYNAMODB_ENDPOINT` (CI/release): lines 85, branches 80, functions 85, statements 85
  - without local endpoint: lines 25, branches 55, functions 30, statements 25
- `@patternmeshjs/streams`: lines 90, branches 85, functions 90, statements 90

Run coverage locally with:

```bash
pnpm test:coverage
```

CI and release workflows run `pnpm test:coverage` so threshold regressions fail
before merge/publish.

CI uploads per-package `lcov.info` files as workflow artifacts (one artifact per
Node matrix entry) so coverage output can be downloaded without re-running tests
locally.

## Type tests

`packages/core/test/types/` uses
[`expect-type`](https://github.com/mmkal/expect-type) to assert static type
shapes. These are the highest-leverage regressions — a change that accidentally
loosens `CreateInput` or drops a `FieldRef` constraint will fail here before
any runtime test catches it.

When you touch generic-heavy surfaces (`entity()`, `accessPatterns(...)`,
`UpdateBuilder`), add or update the corresponding `.test-d.ts` before writing
runtime tests.

## Explain-plan snapshots

`explain()` output is **the primary compiler-regression guard.** Repositories,
update builders, and access patterns all expose an `.explain.*` entry point
that returns a `CompiledOperation` — a stable DTO containing the operation
type, expression strings, `ExpressionAttributeNames`, `ExpressionAttributeValues`,
key values, projected fields, and any warnings.

Existing snapshot coverage lives in `update-explain.test.ts` and in scattered
`toMatchInlineSnapshot` calls across the compiler suites.

### When a snapshot change is allowed

- **Bug fix**: the old snapshot was wrong (e.g. generated an invalid
  expression). The PR must include a changeset.
- **Additive improvement**: an expression gained a new, non-breaking clause
  (e.g. extra `#n0` alias). Changeset required.
- **Intentional breaking change**: expression generation changed in a way a
  consumer could observe (different attribute name, reordered values, removed
  warning). Needs a `major` changeset and a line in the CHANGELOG that calls
  the change out.

### When a snapshot change is **not** allowed

- As a side-effect of refactoring code that is supposed to be semantics-neutral.
  If you cannot explain _why_ the snapshot changed, revert.
- In a "fix lint" or "format code" PR. These must leave compiled output
  byte-identical.
- Without a changeset, in any PR that mutates a `.explain.*` or
  `.*.explain()` snapshot.

Rule of thumb: if `explain` output changes, a consumer's `aws sdk` trace would
change. That is externally visible and requires version-bump discipline
(see [ROADMAP.md](../../ROADMAP.md) "Versioning discipline").

## Property tests

`packages/core/test/property.test.ts` uses
[`fast-check`](https://github.com/dubzzz/fast-check) for invariant-driven
coverage (cursor round-trips, key composition invariants, and batch chunking
bounds). These tests are seeded to make CI failures reproducible.

When debugging a failing property test, rerun with the same seed/path from the
failure output:

```bash
pnpm --filter @patternmeshjs/core test -- --runInBand
```

## Adding a new snapshot

1. Write the test as a regular Vitest block that calls the relevant
   `.explain` entry point.
2. Use `toMatchInlineSnapshot()` with an empty argument the first time.
3. Run `pnpm --filter @patternmeshjs/core test -- -u` to populate the
   snapshot.
4. **Read the snapshot before committing.** Confirm expression strings,
   `#n0` / `:v0` aliases, and key values look intended. A snapshot captures
   _what is_, not _what should be_.

## Writing new integration tests

- Use the existing table setup in `entity.integration.test.ts` as a template.
- Clean up any tables you create in `afterAll` — DynamoDB Local persists by
  default in CI.
- Avoid `Date.now()` / random IDs without a seed in assertions; prefer
  deterministic fixtures so CI reruns produce identical traces.
- Gate the test block behind `if (!process.env.DYNAMODB_ENDPOINT) return;` or
  `describe.skipIf(!process.env.DYNAMODB_ENDPOINT)`.

## Smoke tests

`tests-smoke/smoke.mjs` packs each package with `pnpm pack`, installs the
resulting tarballs in an isolated folder, and imports them from a consumer
script. This catches broken `exports` maps, missing files in `files`, and
ESM/CJS drift that unit tests cannot see.

Run it manually with:

```bash
pnpm smoke:pack
```

It runs unconditionally in the `release.yml` workflow before publish.

## See also

- [Releasing](./releasing.md) — how Changesets decide bump types and why
  snapshot churn matters to the release cadence.
- [Adding a feature](./adding-a-feature.md) — per-feature-type checklists that
  include which snapshots to update.
