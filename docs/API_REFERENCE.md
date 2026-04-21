# API reference

patternmesh generates API reference from source with TypeDoc.

The generated HTML output is **not committed** to the repository. It is treated
as a build artifact so the git history stays focused on source and docs edits,
not generated files.

## Hosted API reference

The latest API reference is built from `main` and published as part of the
docs site on GitHub Pages:

- **<https://patternmesh.github.io/patternmesh/api/core/>** — `@patternmesh/core`
- **<https://patternmesh.github.io/patternmesh/api/adapter/>** — `@patternmesh/aws-sdk-v3`
- **<https://patternmesh.github.io/patternmesh/api/streams/>** — `@patternmesh/streams`

## Generate locally

```bash
pnpm docs:api
```

This writes HTML output under `docs/api/`, which is ignored by git.

To build the whole Pages site locally (HTML for every markdown page plus
TypeDoc output), run:

```bash
pnpm docs:site
```

This writes the composed site into `site/`, which is also ignored by git.

## Recommended publishing model

- keep TypeDoc config and generation scripts in git
- keep generated `docs/api/` output out of git
- publish generated HTML from CI (for example GitHub Pages)

## What is tracked in git

- TypeDoc config files:
  - `typedoc.core.json`
  - `typedoc.adapter.json`
  - `typedoc.streams.json`
- the `pnpm docs:api` script in the root `package.json`
- this guide

## Why this approach

- smaller diffs
- cleaner history
- less merge noise
- no stale generated HTML committed by accident
