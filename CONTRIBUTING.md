# Contributing to patternmesh

Thanks for your interest in improving patternmesh. This page covers what you
need to submit a change. For deeper topics — repo architecture, release
process, how to add a new field / operator / access pattern / package — see
the [dev docs](./docs/dev/).

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting started

```bash
git clone https://github.com/patternmesh/patternmesh.git
cd patternmesh
pnpm install
pnpm build
pnpm test
```

For prerequisites (Node, pnpm, Docker for DynamoDB Local), git-hook behavior,
and the full local-check incantation, see
[docs/dev/local-setup.md](./docs/dev/local-setup.md).

## Submitting changes

1. **Open an issue first** for non-trivial changes so the approach can be
   discussed before implementation.
2. **Fork and branch** from `main`.
3. **Make your changes.** Follow existing code style; keep commits focused.
4. **Add or update tests.** New behavior needs unit tests; integration tests
   where an adapter round-trip matters. If you change `explain()` output, the
   snapshot change itself requires a changeset — see
   [docs/dev/testing.md](./docs/dev/testing.md#explain-plan-snapshots).
5. **Run the full check locally**:

   ```bash
   pnpm build
   pnpm test
   pnpm format:check
   pnpm lint
   pnpm syncpack lint
   pnpm typecheck
   ```

6. **Add a changeset** describing your change (required for any release):

   ```bash
   pnpm changeset
   ```

   Pick the affected packages and the appropriate bump type. Commit the
   generated file alongside your change. See the guidance below.

7. **Open a pull request** against `main`. Fill in the PR template.

## Changeset guidance

**Add a changeset when you change anything a downstream consumer can observe.**
That includes public type signatures, runtime behavior, exported errors,
package metadata (entry points, engines, `peerDependencies`), or the rendered
shape of query/update plans returned by `explain.*`.

**Skip the changeset for:**

- documentation-only edits (`README.md`, `docs/**`, JSDoc/TSDoc, code comments)
- internal refactors that do not affect any exported symbol
- test-only changes
- CI, tooling, or repo-hygiene changes that consumers cannot see

If you are unsure, add one — an extra CHANGELOG entry is cheaper than a silent
behavior change.

**Bump type mapping for this repo:**

| Bump    | Use when                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| `patch` | bug fix with no API surface change; more permissive types; improved error messages   |
| `minor` | new exported symbol; additive type widening; new entity/relation/recipe feature      |
| `major` | removed or renamed export; narrowed types; changed runtime semantics of existing API |

While we are on `0.x`, breaking changes are allowed in minor bumps per SemVer
convention, but we still tag them as `major` in changesets so the CHANGELOG
flags them clearly. Once we cut `1.0.0`, `major` will track SemVer strictly.
The full release workflow lives in
[docs/dev/releasing.md](./docs/dev/releasing.md).

## Commit messages

Commit messages are validated with Conventional Commits. Use one of these
types:

- `feat`, `fix`, `docs`, `style`, `refactor`, `perf`
- `test`, `build`, `ci`, `chore`, `revert`

Examples:

```text
feat(core): add typed query cursor helper
fix(streams): handle missing old image on ttl remove
chore(ci): add format check and turbo cache
```

Breaking changes can be marked as `feat!:` (or another type with `!`) and
described in a `BREAKING CHANGE:` footer.

Conventional commits keep history consistent, but package versioning is still
driven by changesets (`.changeset/*.md`), not commit subjects.

## Code style

- **TypeScript** everywhere; strict mode is on. Avoid `any`.
- **ESM only**; never use CommonJS idioms.
- **Prefer readonly** for public interface surfaces.
- **No default exports** from package entry points.
- Let `eslint` and `prettier` enforce the rest.

Formatting is handled automatically by the `pre-commit` hook on staged
files. If you want to format the whole tree manually:

```bash
pnpm format         # write
pnpm format:check   # check only
```

After pulling the one-shot Prettier adoption commit, configure git blame once
so the mass reformat stays hidden:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Dev docs (for deeper contributions)

- [Repo architecture](./docs/dev/repo-architecture.md) — workspace topology,
  package boundaries, public-export discipline, design principles
- [Testing](./docs/dev/testing.md) — unit / integration, explain snapshots
- [Releasing](./docs/dev/releasing.md) — Changesets, provenance, gate set
- [Docs site](./docs/dev/docs-site.md) — TypeDoc, Pages deploy
- [Adding a feature](./docs/dev/adding-a-feature.md) — field types, update
  operators, access patterns
- [Adding a package](./docs/dev/adding-a-package.md) — new `@patternmeshjs/*`
- [Adapter contracts](./docs/dev/adapter-contracts.md) — `DynamoAdapter`
- [Validation boundary](./docs/dev/validation-boundary.md) — compiler-first,
  Zod-optional architecture

## Reporting security issues

Please do **not** open a public issue. See [SECURITY.md](./SECURITY.md) for
private disclosure.

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](./LICENSE).
