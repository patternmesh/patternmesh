# Release Checklist

Use this checklist before publishing any release from this monorepo.

## Metadata

- Confirm package names are correct: `@patternmesh/core`, `@patternmesh/aws-sdk-v3`, `@patternmesh/streams`
- Confirm `repository`, `homepage`, and `bugs` URLs point at `https://github.com/patternmesh/patternmesh`
- Confirm `license`, `sideEffects`, and `publishConfig.provenance` are present in each publishable `package.json`

## Validation

- Run `pnpm install`
- Run `pnpm build`
- Run `pnpm test`
- Run `pnpm lint`
- Run `pnpm typecheck`

## Packaging

- Run `pnpm pack --pack-destination .artifacts` for each publishable package
- Inspect tarball contents for `dist/`, `README.md`, `LICENSE`, and `NOTICE`
- Verify generated `.d.ts` files do not import undeclared runtime dependencies

## Release management

- Add or review Changesets entries
- Review `CHANGELOG.md`
- Confirm version bumps are correct
- Create the release PR

## Publish

- Publish with provenance enabled
- Verify packages on npm
- Verify GitHub release notes
- Verify `npm audit signatures` for published packages
