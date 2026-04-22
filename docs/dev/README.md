# Dev docs

These docs are for contributors and maintainers working **on** patternmesh. If
you are a package consumer, start with the top-level
[README](../../README.md) and the [user guides](../guides/).

## Audience

This layer answers "how do I work in this repository?" It does **not** repeat
how to use the published packages — that content lives in:

- **User docs** — [`README.md`](../../README.md), each package's README,
  [`docs/guides/`](../guides/) cookbook
- **Design docs** — [`docs/design/`](../design/) conceptual rationale for
  single-table modeling, table setup, and API-reference generation
- **Dev docs** — this folder

## Pages

- [Local setup](./local-setup.md) — prerequisites, bootstrap, DynamoDB Local,
  running CI locally with `act`
- [Repo architecture](./repo-architecture.md) — workspace topology, package
  boundaries, public-export discipline, design principles
- [Testing](./testing.md) — unit / integration split, explain-plan snapshots,
  `DYNAMODB_ENDPOINT` gating, snapshot hygiene
- [Releasing](./releasing.md) — Changesets workflow, release PR flow,
  provenance, `publint` / `attw` / `syncpack` / smoke-pack gates, post-release
  verification
- [Docs site](./docs-site.md) — TypeDoc config, `pnpm docs:api` vs
  `pnpm docs:site`, how `scripts/build-site.mjs` composes the site, Pages deploy
- [Adding a feature](./adding-a-feature.md) — playbooks for new field types,
  update operators, and access-pattern shapes
- [Adding a package](./adding-a-package.md) — minimum template for a new
  `@patternmeshjs/*` workspace package
- [Adapter contracts](./adapter-contracts.md) — `DynamoAdapter` surface,
  round-trip guarantees, integration-test expectations for new adapters
- [Validation boundary](./validation-boundary.md) — the compiler-first,
  Zod-optional architecture: what `core` owns vs what an optional
  `@patternmeshjs/zod` adapter owns

## Relationship to `CONTRIBUTING.md`

[`CONTRIBUTING.md`](../../CONTRIBUTING.md) at the repo root is intentionally
short: it is what GitHub surfaces to first-time contributors on PR creation. It
covers the submit-a-PR checklist, Changeset guidance, commit conventions, and
code style. For anything deeper — how the compiler is structured, how to add a
new update operator, how releases actually run — see the pages above.
