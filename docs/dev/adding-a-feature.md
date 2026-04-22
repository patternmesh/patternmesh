# Adding a feature

Three extension points cover almost every core change: **field types**,
**update operators**, and **access-pattern shapes**. Each has a checklist that
enforces snapshot discipline and keeps the public API consistent.

Before you start, read:

- [Repo architecture](./repo-architecture.md) for where things live in `core`
- [Testing](./testing.md) for explain-plan snapshot rules
- [Releasing](./releasing.md) for bump-type mapping

## Adding a field type

Example targets: a new scalar kind (`bigint`, `decimal`), a new composite
(`map`, `tuple`), or a semantic marker (`encrypted()`, `indexedOnly`).

### Checklist

1. **DSL entry** — add the builder to
   [`packages/core/src/fields.ts`](../../packages/core/src/fields.ts) following
   the existing `FieldBuilder<T, Req, Def>` pattern. Preserve the fluent
   chain; avoid overloads that change return shape.
2. **Scalar kind** — extend the `FieldScalarKind` union in
   [`packages/core/src/types.ts`](../../packages/core/src/types.ts) if it is a
   genuinely new kind. Prefer reusing an existing kind plus a
   normalizer/validator over inventing a new one.
3. **`FieldMeta`** — if the type changes mutability, `allowAdd` / `allowRemove`
   defaults, or requires a new flag, extend `FieldMeta` in
   [`entity-runtime.ts`](../../packages/core/src/entity-runtime.ts) and wire
   it from the builder.
4. **Codec** — add `logicalToStored` and `storedToLogicalPublic` handling if
   the type needs transformation (e.g. `datetime` → ISO string). Codecs live
   next to the field in `entity-runtime.ts`.
5. **Validation** — update `validation.ts` to enforce required/enum/scalar
   shape on `create` and `update().set` inputs.
6. **Update-operator compatibility** — decide whether the new type supports
   `set`, `add`, and `remove`. Update the mutability-matrix comment in
   `update.ts` and add type-level narrowing in `FieldMeta`-derived
   `Settable` / `Addable` / `RemovableKeys`.
7. **Explain shape** — confirm the new type renders in
   `CompiledOperation.expressionAttributeValues` without leaking internal
   representation (e.g. `Date` objects should serialize to ISO strings, never
   raw epoch numbers unless that is the contract).
8. **Type tests** — add a case to `packages/core/test/types/` covering
   `CreateInput`, `Item`, and `Settable` inference for the new type.
9. **Runtime tests** — add a file in `packages/core/test/` exercising the
   codec round-trip, validation errors, and update-operator compatibility.
10. **Explain snapshots** — add `toMatchInlineSnapshot` coverage showing how
    the new type appears in `create` / `update` / `find` plans.
11. **Guide** — if the type is user-visible and nontrivial, add or extend a
    guide under [`docs/guides/`](../guides/) (`complex-attributes.md` is the
    usual home for structural types).
12. **Changeset** — new exported symbol ⇒ `minor`. Changed default for an
    existing symbol ⇒ `major`.

## Adding an update operator

Example targets: `update().append([...])` for list-append, `update().delete(set)`
for set-delete, `update().incrementIfLt(...)` for conditional add.

### Checklist

1. **Builder surface** — add the method to `UpdateBuilder` in
   [`packages/core/src/update.ts`](../../packages/core/src/update.ts). Return
   `this`; preserve fluent chaining. Accept `FieldRef<T>` for field arguments,
   not raw strings.
2. **Disjoint surfaces** — decide whether the operator lives in `Settable`,
   `Addable`, a new surface, or none. Do **not** overload `set()`; the
   disjoint-surface property of `Settable` vs `Addable` is load-bearing for
   type safety.
3. **Expression compiler** — map to the appropriate DynamoDB
   `UpdateExpression` clause (`SET`, `ADD`, `REMOVE`, or a combination) in
   the same file. Reuse the existing `#n0` / `:v0` alias machinery; do not
   inline attribute names.
4. **Reserved-word handling** — any attribute name touched by the new
   operator must route through the `ExpressionAttributeNames` aliaser. Add a
   case to `reserved-attrs.test.ts` if the operator has a distinct code path.
5. **Type narrowing** — if the operator only applies to a subset of fields
   (e.g. only lists, only numeric), synthesize a new derived type from
   `FieldMeta` alongside `Settable` / `Addable` and have the new method
   accept that narrower shape.
6. **Error mapping** — if DynamoDB can fail the operation with a new
   condition-like exception, extend `aws-error.ts` and the error classes in
   `errors.ts` so repositories produce typed errors (see
   [Validation boundary](./validation-boundary.md) for the mapping
   philosophy).
7. **Explain rendering** — update `explain-helpers.ts` and make sure the new
   operator shows up in `CompiledOperation.updateExpression` with stable
   aliasing.
8. **Type tests** — add `expect-type` cases covering the narrowed accepted
   shape and the return type of `.go()`.
9. **Runtime tests** — exercise the operator in `update-explain.test.ts` and
   a round-trip integration test.
10. **Explain snapshots** — add a snapshot for the generated
    `UpdateExpression`, `ExpressionAttributeNames`, and
    `ExpressionAttributeValues`.
11. **Guide or README update** — mention the operator wherever existing
    operators are enumerated (`packages/core/README.md`, relevant guide).
12. **Changeset** — new method on `UpdateBuilder` ⇒ `minor`. Narrowed
    acceptance of an existing method ⇒ `major`.

## Adding an access-pattern shape

Example targets: a new `ap.countBetween(...)` that wraps `Select: COUNT`, a
new `ap.contains(...)` for membership queries.

### Checklist

1. **DSL ergonomics** — add the factory method to
   [`packages/core/src/access-pattern-factory.ts`](../../packages/core/src/access-pattern-factory.ts).
   Prefer returning a `AccessPatternDef<Input>` whose `buildRequest` is a
   pure function from `Input` to `DynamoReadPlan`.
2. **Kind** — if the shape cannot be expressed as `get` / `query` / `unique`,
   extend `AccessPatternKind` in `types.ts` and teach the repository
   factory how to materialize it.
3. **Key compilation** — reuse the `key()` template composer from
   [`packages/core/src/key.ts`](../../packages/core/src/key.ts) for building
   the compiled key values. Do not write raw string concatenation at this
   layer.
4. **Index routing** — if the pattern targets a GSI, ensure the entity's
   `index(...)` declaration defines the same key attributes. Mismatches
   should produce a `ValidationError` at `connect()` time, not at runtime.
5. **Repository surface** — the repository factory in `repository.ts`
   synthesizes `find.*` and `explain.find.*` accessors from the entity's
   declared access patterns. New kinds need factory branches here. Preserve
   the type inference — `Input` and result shapes must flow from the pattern
   declaration to the caller without `any`.
6. **Explain** — every access-pattern kind must be explainable. Add
   rendering in `explain-helpers.ts` that produces a deterministic
   `CompiledOperation` (including `indexName` where applicable).
7. **Relations** — if the new pattern makes sense as a relation target
   (e.g. a new `hasMany` shape), wire it through `relations.ts` so
   `db.Parent.children.<method>` works uniformly.
8. **Type tests** — `FindAccessors<CompiledPatterns>` and
   `ExplainFindAccessors<...>` synthesized types should include the new
   pattern with correct `Input` and result shapes.
9. **Runtime tests** — cover both the mock-adapter path (in
   `entity.integration.test.ts` or a new file) and, if the shape has adapter
   implications, DynamoDB Local.
10. **Explain snapshots** — for every pattern shape, add a snapshot of the
    `CompiledOperation` showing index routing, key conditions, filter
    expressions, and any warnings.
11. **Single-table design guide** — add the new shape to
    [`docs/design/single-table-patterns.md`](../design/single-table-patterns.md)
    under the operator matrix / pattern catalog section.
12. **Changeset** — new pattern method ⇒ `minor`. New `AccessPatternKind` or
    changed factory semantics ⇒ `major`.

## Cross-cutting rule

Every one of these playbooks ends with "snapshot + changeset." If you find
yourself skipping either, stop and re-read
[Testing § explain-plan snapshots](./testing.md#explain-plan-snapshots). The
snapshot is the compiler regression guard; the changeset is the version-bump
contract. Neither is optional.
