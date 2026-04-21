# Contributing to patternmesh

Thanks for your interest in improving patternmesh. This document describes
how to set up a local environment, run tests, and submit changes.

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js 18+** (ESM)
- **pnpm 9+** (`corepack enable` will pick up the version pinned in
  [`package.json`](./package.json) `packageManager`)
- **Docker** (optional, for adapter integration tests against DynamoDB Local)

## Getting started

```bash
git clone https://github.com/patternmesh/patternmesh.git
cd patternmesh
pnpm install
pnpm build
pnpm test
```

### Running integration tests (adapter)

The AWS SDK v3 adapter includes integration tests that run against DynamoDB
Local. Start it with the provided compose file:

```bash
docker compose up -d
export DYNAMODB_ENDPOINT=http://localhost:8000
pnpm --filter @patternmesh/aws-sdk-v3 test
```

Tests are automatically skipped when `DYNAMODB_ENDPOINT` is unset.

## Repository layout

```
packages/
  core/                  # @patternmesh/core — modeling DSL, repositories, transactions
  adapter-aws-sdk-v3/    # @patternmesh/aws-sdk-v3 — DocumentClient adapter
  streams/               # @patternmesh/streams — typed stream decoding
docs/
  single-table-patterns.md  # conceptual design guidance
  table-setup.md            # provisioning guide
  API_REFERENCE.md          # notes on generated TypeDoc output
  guides/                   # code-heavy topic cookbooks
scripts/                 # build-site.mjs and shared site template
```

## Documentation changes

User-facing docs live in three places:

1. `README.md` and each package's `README.md` — landing pages, install, quick
   start.
2. `docs/*.md` — conceptual design guidance that is not tied to a specific
   topic cookbook.
3. `docs/guides/*.md` — code-heavy topic cookbooks (relations, bundles and
   recipes, lifecycle, complex attributes, streams advanced). Each guide
   follows a shared template: what it is, prerequisites, end-to-end example,
   contracts and failure modes, non-goals.

When you add or update a guide:

- use plain string IDs in examples (never `as never`)
- use the canonical builder order `inTable` → `keys` → `index` → `identity`
  → `accessPatterns`
- cross-link the guide from `README.md` Documentation and from the relevant
  section of `docs/single-table-patterns.md`

## Docs site

`pnpm docs:api` runs TypeDoc for each package into `docs/api/` (git-ignored).

`pnpm docs:site` builds the full Pages site into `site/` (also git-ignored):
TypeDoc output plus rendered markdown from `README.md`, `docs/*.md`, and
`docs/guides/*.md`. The `pages.yml` workflow publishes this on every push to
`main`.

## Local CI with act (optional)

[act](https://github.com/nektos/act) runs our GitHub Actions workflows
locally. The repo ships an `.actrc` with portable image mappings for
`ubuntu-latest` and `ubuntu-24.04`, so a plain `act` invocation picks the
right base image:

```bash
act push -W .github/workflows/ci.yml --job test
```

Host-specific flags belong in your personal `~/.actrc`, not the repo file.
On an Apple Silicon Mac with Docker Desktop, the minimal override is:

```
--container-architecture linux/amd64
```

On Linux x86 you typically do not need any host-specific overrides. Do **not**
manually mount `/var/run/docker.sock` — act mounts the host Docker socket into
the runner container automatically, and an extra mount fails with
`Duplicate mount point`.

Caveats:

- `act` cannot deploy the Pages workflow (`pages.yml` deploy job uses GitHub
  infrastructure). Use it for `ci.yml` / `release.yml` iteration only.
- Steps that `docker compose up` DynamoDB Local still run fine under act
  because act exposes the host Docker daemon to the runner container by
  default; you do not need to configure the socket mount yourself.

## Design principles

1. **Explicit over magic.** No implicit routing, no silent fallbacks.
2. **Typed at the boundary.** Public APIs must not leak `any` or unchecked
   casts into consumer code.
3. **Errors are values.** Prefer typed error classes from `errors.ts` over
   `throw new Error(...)`.
4. **Small surface area.** Export what is necessary; keep internal helpers
   internal.
5. **Documented non-goals.** If we do not plan to build something, say so.

## Submitting changes

1. **Open an issue first** for non-trivial changes so the approach can be
   discussed before implementation.
2. **Fork and branch** from `main`.
3. **Make your changes.** Follow existing code style; keep commits focused.
4. **Add or update tests.** New behavior needs unit tests; integration tests
   where an adapter round-trip matters.
5. **Run the full check locally**:
   ```bash
   pnpm build
   pnpm test
   pnpm lint
   pnpm typecheck
   ```
6. **Add a changeset** describing your change (required for any release):
   ```bash
   pnpm changeset
   ```
   Pick the affected packages and the appropriate bump type (`patch`,
   `minor`, or `major`). Commit the generated file alongside your change.
7. **Open a pull request** against `main`. Fill in the PR template.

## Commit messages

We do not mandate a strict convention, but clear, imperative subjects help
during release. For example:

```
Reject reserved attribute names at defineEntity
Add isTtlRemove helper to @patternmesh/streams
Fix batchGet reconciliation to be O(n)
```

## Code style

- **TypeScript** everywhere; strict mode is on. Avoid `any`.
- **ESM only**; never use CommonJS idioms.
- **Prefer readonly** for public interface surfaces.
- **No default exports** from package entry points.
- Let `eslint` enforce the rest. Fix lint warnings before opening a PR.

## Reporting security issues

Please do **not** open a public issue. See
[SECURITY.md](./SECURITY.md) for private disclosure.

## License

By contributing, you agree that your contributions will be licensed under
the [Apache License 2.0](./LICENSE).
