# Local setup

This page walks through bootstrapping a working patternmesh development
environment and the optional extras for running integration tests and CI
workflows locally.

## Prerequisites

- **Node.js 18+** (ESM). The test matrix also runs on 20 and 22.
- **pnpm 9+**. The repo pins the version via `packageManager` in
  [`package.json`](../../package.json); `corepack enable` is enough to pick it
  up.
- **Docker** — optional, required only for adapter integration tests against
  DynamoDB Local.

## Bootstrap

```bash
git clone https://github.com/patternmesh/patternmesh.git
cd patternmesh
pnpm install
pnpm build
pnpm test
```

`pnpm install` runs the `prepare` script, which initializes
[Husky](https://github.com/typicode/husky) and installs the local git hooks:

- `pre-commit` runs `lint-staged` (ESLint + Prettier on staged files only)
- `commit-msg` runs `commitlint` with Conventional Commit rules

Emergency bypass (use sparingly):

```bash
HUSKY=0 git commit -m "..."
git commit --no-verify
```

## Hide the one-shot format commit in `git blame`

After pulling the Prettier adoption commit, configure git blame once so the
mass reformat does not dominate history:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Running the full local check

This mirrors what the `ci.yml` job runs, minus the Node matrix:

```bash
pnpm install
pnpm build
pnpm test
pnpm format:check
pnpm lint
pnpm syncpack lint
pnpm typecheck
pnpm publint
pnpm attw
```

Turbo caches the results of `build`, `test`, and `typecheck`, so reruns that
touch nothing are near-instant. Delete `.turbo/` if a cache looks stuck.

## DynamoDB Local for integration tests

A `docker-compose.yml` at the repo root ships a DynamoDB Local service:

```bash
docker compose up -d dynamodb-local
export DYNAMODB_ENDPOINT=http://localhost:8000
pnpm --filter @patternmeshjs/aws-sdk-v3 test
```

Without `DYNAMODB_ENDPOINT`, adapter integration tests are skipped — the unit
tests in `packages/core` and `packages/streams` do **not** require DynamoDB
Local.

## Running CI locally with `act`

[act](https://github.com/nektos/act) runs our GitHub Actions workflows locally.
The repo ships an `.actrc` with portable image mappings for `ubuntu-latest`
and `ubuntu-24.04`, so a plain `act` invocation picks the right base image:

```bash
act push -W .github/workflows/ci.yml --job test
```

Host-specific flags belong in your personal `~/.actrc`, not the repo file. On
an Apple Silicon Mac with Docker Desktop, the minimal override is:

```text
--container-architecture linux/amd64
```

On Linux x86 you typically do not need any host-specific overrides. Do **not**
manually mount `/var/run/docker.sock` — act mounts the host Docker socket into
the runner container automatically, and an extra mount fails with
`Duplicate mount point`.

Caveats:

- `act` cannot deploy the Pages workflow (`pages.yml`'s deploy job uses GitHub
  infrastructure). Use it for `ci.yml` / `release.yml` iteration only.
- Steps that `docker compose up` DynamoDB Local still run fine under act
  because act exposes the host Docker daemon to the runner container by
  default; you do not need to configure the socket mount yourself.

## Next steps

- Learn the workspace layout in [Repo architecture](./repo-architecture.md).
- Before changing compiler code, read [Testing](./testing.md) to understand
  how explain-plan snapshots gate compiler regressions.
