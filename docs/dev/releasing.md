# Releasing

patternmesh publishes three packages to npm on every merge to `main` that
includes a changeset. The full flow runs in
[`.github/workflows/release.yml`](../../.github/workflows/release.yml).

## Changesets workflow

Every PR that changes anything a consumer can observe needs a changeset.

### Add a changeset

```bash
pnpm changeset
```

The CLI asks:

1. Which packages changed — pick all affected.
2. Bump type — `patch` / `minor` / `major` per the table below.
3. Summary — goes straight into `CHANGELOG.md`. Write it for a reader who
   will discover the change while upgrading, not for the PR reviewer.

The file lands in `.changeset/<random-name>.md` and should be committed
alongside the code change.

### Bump type table

| Bump    | Use when                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| `patch` | bug fix with no API surface change; more permissive types; improved error messages   |
| `minor` | new exported symbol; additive type widening; new entity/relation/recipe feature      |
| `major` | removed or renamed export; narrowed types; changed runtime semantics of existing API |

While on `0.x`, breaking changes are allowed inside minor bumps per SemVer
convention, but we still tag them as `major` in changesets so the CHANGELOG
flags them clearly. Once `1.0.0` ships, `major` tracks SemVer strictly. See
[ROADMAP.md](../../ROADMAP.md) "Versioning discipline" for the full policy.

### When to skip a changeset

Skip for changes that a consumer cannot observe:

- documentation-only edits (`README.md`, `docs/**`, JSDoc/TSDoc, code comments)
- internal refactors that do not alter any exported symbol
- test-only changes
- CI, tooling, or repo-hygiene changes

If unsure, add one — an extra `CHANGELOG` entry is cheaper than a silent
behavior change.

### Snapshot-only PRs require a changeset

If a PR mutates any `.explain.*` / `UpdateBuilder.explain()` snapshot, the
generated DynamoDB request a consumer sees on the wire changed. That is
externally visible; a changeset is required. See
[Testing § explain-plan snapshots](./testing.md#explain-plan-snapshots).

## Release PR flow

1. PRs merge to `main` with changesets in `.changeset/`.
2. The `release` job in
   [`release.yml`](../../.github/workflows/release.yml) runs on every push to
   `main`.
3. Before touching anything, it runs the full gate set:
   - `pnpm build`, `pnpm docs:api`, `pnpm test`
   - `pnpm format:check`, `pnpm lint`, `pnpm syncpack lint`, `pnpm typecheck`
   - `pnpm publint`, `pnpm attw`
   - `pnpm smoke:pack` (tarball consume test)

4. The `changesets/action@v1` step then:
   - If pending changesets are present **and the current commit is not a
     release commit**: opens (or updates) a "Release packages" PR that
     consumes all pending changesets, bumps versions, updates CHANGELOGs,
     and deletes the consumed changeset files.
   - If the current commit **is** a release commit (merged from that PR):
     runs `pnpm release` (= `changeset publish`) to publish to npm.

Because the workflow runs on `main` after every push, merging the "Release
packages" PR is what actually publishes. The workflow re-runs on that merge
commit and detects no pending changesets remain.

## Provenance

All three packages publish with npm provenance enabled:

- `publishConfig.provenance: true` in each package's `package.json`
- The `release` workflow has `id-token: write` permission, which GitHub OIDC
  needs to sign the attestation
- Auth to npm uses `NPM_TOKEN` (a granular, scope-limited token stored in
  repo secrets) — OIDC handles attestation, `NPM_TOKEN` handles auth

Verify provenance on a published version:

```bash
npm audit signatures
```

Or inspect a specific version:

```bash
npm view @patternmeshjs/core@<version>
```

## Gate set reference

Each gate exists to catch a specific class of drift. Do not skip one with
`continue-on-error` without a ticketed reason.

| Gate                 | Catches                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| `pnpm build`         | TypeScript errors, tsup config breakage                                         |
| `pnpm test`          | runtime regressions, explain-snapshot drift, integration-path breakage          |
| `pnpm format:check`  | Prettier drift (non-blocking to merge, blocking to release)                     |
| `pnpm lint`          | ESLint rules the codebase has opted into                                        |
| `pnpm syncpack lint` | dependency-version drift across workspaces                                      |
| `pnpm typecheck`     | type errors the emit step does not catch (e.g. `noEmit` strict-mode violations) |
| `pnpm publint`       | package.json `exports` map and metadata issues                                  |
| `pnpm attw`          | "Are the Types Wrong" — ESM/CJS and type-resolution shape issues                |
| `pnpm smoke:pack`    | consume-from-tarball: broken `files` list, missing dist artifacts               |

## Post-release verification

After the release PR merges and publish completes:

1. Watch the `release` workflow finish without error.
2. `npm view @patternmeshjs/<pkg>` shows the new version, provenance attached.
3. `npm audit signatures @patternmeshjs/<pkg>@<version>` confirms signatures.
4. The [`pages.yml`](../../.github/workflows/pages.yml) workflow redeploys the
   docs site with the updated READMEs and the regenerated TypeDoc.
5. Create the GitHub release (Changesets opens one automatically when
   `publish` is successful); double-check the auto-generated release notes
   match the CHANGELOG entries.

## Pre-publish gate list

The short, human-runnable checklist lives at
[`RELEASE_CHECKLIST.md`](../../RELEASE_CHECKLIST.md). Use it before a manual
publish or when debugging a suspicious release run.

## Emergency republish

If a published artifact is broken (wrong exports, missing file):

1. `npm deprecate @patternmeshjs/<pkg>@<bad-version> "see <issue>"` immediately.
2. Land the fix as a normal PR with a changeset.
3. Let the release workflow publish a new patch version.
4. Do **not** `npm unpublish` — npm's unpublish policy invalidates consumer
   installs and hurts trust more than a broken version plus a deprecation does.
