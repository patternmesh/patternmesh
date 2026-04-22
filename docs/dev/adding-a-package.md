# Adding a package

This page walks through adding a new `@patternmeshjs/*` package to the
workspace. Use it when you land one of the
[adjacent packages on the roadmap](../../ROADMAP.md) (`testing`, `zod`,
`devtools`, `migrations`) or any other workspace package we agree on.

## Scope check

Before scaffolding:

1. Read [Repo architecture § hard rules](./repo-architecture.md#hard-rules).
   The new package must respect them — in particular, it must not drag an AWS
   SDK runtime dependency into `@patternmeshjs/core`.
2. Read [Validation boundary](./validation-boundary.md) if the package has
   anything to do with input parsing, normalization, or JSON Schema export.
3. Confirm the package is on the [ROADMAP](../../ROADMAP.md) or discuss it in
   an issue first. We do not accept out-of-band new packages.

## Scaffolding steps

### 1. Folder and `package.json`

```text
packages/<name>/
  src/
    index.ts
  test/
  package.json
  tsconfig.json
  tsup.config.ts
  README.md
  LICENSE       # Apache-2.0, identical to other packages
  NOTICE        # identical to other packages
```

Use [`packages/core/package.json`](../../packages/core/package.json) as the
template. Required fields:

```json
{
  "name": "@patternmeshjs/<name>",
  "version": "0.1.0",
  "description": "...",
  "license": "Apache-2.0",
  "author": "patternmesh contributors",
  "homepage": "https://github.com/patternmesh/patternmesh/tree/main/packages/<name>#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/patternmesh/patternmesh.git",
    "directory": "packages/<name>"
  },
  "bugs": { "url": "https://github.com/patternmesh/patternmesh/issues" },
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE", "NOTICE"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=18" },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

### 2. Dependencies

- **Workspace deps** use `workspace:*`:

  ```json
  "dependencies": {
    "@patternmeshjs/core": "workspace:*"
  }
  ```

- **External runtime deps** need to stay minimal and justified. Prefer
  `peerDependencies` over `dependencies` for any consumer-supplied library
  (AWS SDK clients, `zod`, etc.) so consumers control the version.
- **Dev deps** for build/test reuse the versions already in the root or in
  sibling packages — `syncpack lint` catches drift.

### 3. `tsup.config.ts` and `tsconfig.json`

Copy both from a sibling package. Change only the entry point if needed. The
house build targets ESM-only, Node 18+, with isolated declarations emitted.

### 4. README and badges

The package README lands in `packages/<name>/README.md` and becomes the
landing page both on npm and on the docs site. Start from
[`packages/core/README.md`](../../packages/core/README.md). Include the
standard badge block (npm version, license, node, TypeScript strict).

### 5. Changesets config

Because `.changeset/config.json` uses `"fixed": []` and `"linked": []`, new
packages are versioned independently by default. If this package should
version in lockstep with `core` (rare), add it to `linked`. Otherwise nothing
to configure.

### 6. TypeDoc

Add a new TypeDoc config at the repo root, e.g. `typedoc.<name>.json`, that
mirrors `typedoc.core.json`:

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": ["packages/<name>/src/index.ts"],
  "out": "docs/api/<name>",
  "tsconfig": "packages/<name>/tsconfig.json",
  "readme": "packages/<name>/README.md"
}
```

Add the invocation to the root `docs:api` script:

```json
"docs:api": "typedoc --options typedoc.core.json && typedoc --options typedoc.adapter.json && typedoc --options typedoc.streams.json && typedoc --options typedoc.<name>.json"
```

Then update [`scripts/build-site.mjs`](../../scripts/build-site.mjs):

1. Add the README to the `pages` array so it appears as
   `site/packages/<name>/index.html`.
2. Add the TypeDoc copy entry in `copyTypedocIfPresent`:

   ```js
   { from: "docs/api/<name>", to: "api/<name>" },
   ```

3. Link the new API reference from
   [`docs/design/api-reference.md`](../design/api-reference.md).

### 7. Publish gates

Add the package to the root `publint` and `attw` scripts in
[`package.json`](../../package.json):

```json
"publint": "publint packages/core && publint packages/adapter-aws-sdk-v3 && publint packages/streams && publint packages/<name>",
"attw": "attw --profile esm-only --pack packages/core && ... && attw --profile esm-only --pack packages/<name>"
```

And to `tests-smoke/smoke.mjs` if applicable (the smoke harness packs and
installs every publishable package).

### 8. Turbo pipeline

`turbo.json` targets every workspace package that declares matching `build`,
`test`, and `typecheck` scripts. As long as your `package.json` uses the same
script names, Turbo picks the package up automatically — no edits needed.

### 9. CI matrix

`.github/workflows/ci.yml` runs `pnpm build`, `pnpm test`, etc. at the root,
which Turbo fans out across every workspace package. No per-package CI
changes are needed for a standard package.

### 10. Release

- Confirm `publishConfig.provenance: true` is set (required for npm
  provenance — see [Releasing § provenance](./releasing.md#provenance)).
- Add a changeset for the new package's first release (initial version is
  `0.1.0` by convention).
- Cross-link from [ROADMAP.md](../../ROADMAP.md) under "Adjacent packages."

## Pre-publish checklist

Before opening the first-release PR:

- [ ] `pnpm install` from a clean clone picks up the new package
- [ ] `pnpm --filter @patternmeshjs/<name> build` produces `dist/`
- [ ] `pnpm --filter @patternmeshjs/<name> test` passes
- [ ] `pnpm --filter @patternmeshjs/<name> typecheck` passes
- [ ] `pnpm publint` passes for the new package
- [ ] `pnpm attw` passes for the new package
- [ ] `pnpm smoke:pack` succeeds (new package installs from tarball)
- [ ] `pnpm docs:site` renders the new README and its TypeDoc output
- [ ] `pnpm syncpack lint` is clean (no dependency drift)
- [ ] Root [README.md](../../README.md) Packages table includes the new package
- [ ] [ROADMAP.md](../../ROADMAP.md) reflects the package moving from
      "exploring" to shipped if applicable

## After the first release

- Re-verify `npm audit signatures @patternmeshjs/<name>@<version>` to confirm
  provenance attached.
- Update any design docs that reference the package.
- If the package affects the core compiler contract (e.g. `@patternmeshjs/zod`
  introduces a parse/normalize pipeline callable from `core`), update
  [Validation boundary](./validation-boundary.md) to reflect the concrete
  implementation.
