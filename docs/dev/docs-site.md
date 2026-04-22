# Docs site

The docs site at <https://patternmesh.github.io/patternmesh/> is built from
repo markdown and TypeDoc output on every push to `main`.

## Two build modes

### `pnpm docs:api`

Runs TypeDoc three times, once per package, each driven by its own config at
the repo root:

- [`typedoc.core.json`](../../typedoc.core.json) → `docs/api/core/`
- [`typedoc.adapter.json`](../../typedoc.adapter.json) → `docs/api/aws-sdk-v3/`
- [`typedoc.streams.json`](../../typedoc.streams.json) → `docs/api/streams/`

Output lands under `docs/api/` and is **git-ignored**. Regenerate locally when
you want to preview API-reference changes.

### `pnpm docs:site`

Runs `scripts/build-site.mjs --with-api`, which:

1. Invokes `pnpm docs:api` to produce fresh TypeDoc HTML.
2. Walks a fixed `pages` list (markdown source → HTML destination), renders
   each file with `marked`, wraps it in `scripts/site-template.html`, and
   writes to `site/`.
3. Copies TypeDoc output from `docs/api/{core,aws-sdk-v3,streams}` into
   `site/api/{core,adapter,streams}`.

Output lands in `site/`, also git-ignored. Open `site/index.html` directly in
a browser to preview — everything is self-contained with relative links.

## How links are rewritten

`scripts/build-site.mjs` wraps `marked`'s link renderer to rewrite in-repo
markdown links at render time:

- `path/to/README.md` → `path/to/index.html`
- `path/to/file.md` → `path/to/file.html`
- External URLs and `#anchor`-only links pass through unchanged.

This means you can author links in markdown using `.md` extensions (which
render correctly on GitHub) and the site build handles the `.html` mapping
automatically. You do **not** need to maintain two sets of links.

## Adding a new markdown page

1. Create the markdown file somewhere sensible (e.g. `docs/guides/new-topic.md`,
   or a new `docs/dev/*.md` page for contributor docs).
2. Add an entry to the `pages` array in
   [`scripts/build-site.mjs`](../../scripts/build-site.mjs):

   ```js
   {
     src: "docs/guides/new-topic.md",
     dest: "docs/guides/new-topic.html",
     title: "New topic",
   },
   ```

3. Cross-link the page from a parent index (e.g. from the
   [user README](../../README.md) or from [docs/dev/README.md](./README.md)).
4. Run `pnpm docs:site` locally to confirm the page renders and its links
   resolve.

## Adding a new published package

When you add a new `@patternmeshjs/*` package:

1. Add a TypeDoc config at the repo root (e.g. `typedoc.<pkg>.json`) that
   mirrors one of the existing configs, pointing at the new package's
   `src/index.ts`.
2. Add the TypeDoc invocation to the `docs:api` script in
   [`package.json`](../../package.json).
3. Add an entry to `copyTypedocIfPresent` in
   [`scripts/build-site.mjs`](../../scripts/build-site.mjs):

   ```js
   { from: "docs/api/<pkg>", to: "api/<pkg>" },
   ```

4. Add the package README to the `pages` array so it appears as
   `site/packages/<pkg>/index.html`.
5. Add a link to the new API reference from
   [`docs/design/api-reference.md`](../design/api-reference.md).

See [Adding a package](./adding-a-package.md) for the full package-scaffold
checklist.

## GitHub Pages deploy

[`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) runs on
every push to `main` plus on `workflow_dispatch`. It:

1. Installs the toolchain via the shared composite action.
2. Runs `pnpm build` (TypeDoc needs the compiled types).
3. Runs `pnpm docs:api`.
4. Runs `node scripts/build-site.mjs` (without `--with-api`, since we just
   regenerated it).
5. Uploads `site/` as a Pages artifact.
6. A separate `deploy` job publishes the artifact to GitHub Pages using
   `actions/deploy-pages@v5`.

Pages uses the `github-pages` environment; the deploy URL surfaces as the
job's output.

## Caveats

- **TypeDoc errors are fatal.** If a JSDoc tag is malformed or a re-exported
  symbol is ambiguous, `docs:api` fails and the whole Pages deploy fails.
  Fix locally with `pnpm docs:api` before pushing.
- **Never commit `docs/api/` or `site/`.** Both are build outputs. `.gitignore`
  already covers them.
- **`act` cannot deploy Pages.** The deploy job uses GitHub-managed
  infrastructure. Use `act` to iterate on the `build` job only; validate the
  deploy step on `main`.

## See also

- [Releasing](./releasing.md) — package publishing uses a separate workflow
  from Pages but shares the setup action.
- [Repo architecture](./repo-architecture.md) — workspace layout referenced
  by TypeDoc configs.
