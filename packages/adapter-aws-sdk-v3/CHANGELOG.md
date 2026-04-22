# @patternmeshjs/aws-sdk-v3

## 0.9.1

### Patch Changes

- 9d11e26: Maintenance release — no public API changes.

  - `@patternmeshjs/streams`: widen `@aws-sdk/util-dynamodb` range to `^3.996.2`.
  - Internal: bump devDependencies (TypeScript `5.9.3`, vitest `2.1.9`, tsup `8.5.1`, `expect-type` `1.3.0`, `@types/aws-lambda` `8.10.161`, `@types/node` `25.6.0`, and root tooling: eslint 10, `@eslint/js` 10, typescript-eslint 8.59, typedoc 0.28.19, publint 0.3.18, syncpack 14, changesets CLI 2.31).
  - Remove dead `pkAttr` parsing in the core `mock-adapter` test helper (flagged by eslint 10's `no-useless-assignment`).

- Updated dependencies [9d11e26]
  - @patternmeshjs/core@0.9.1
