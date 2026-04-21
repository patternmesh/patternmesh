# Changesets

This repository uses Changesets for versioning and release notes.

## Create a changeset

```bash
pnpm changeset
```

Select the affected package(s), choose the bump type, and write a short summary
that explains why the change matters.

## Release flow

- contributors add changesets in pull requests
- the Changesets GitHub Action opens or updates a release PR on `main`
- merging that PR publishes packages with npm provenance enabled
