import { expectTypeOf } from "expect-type";
import { describe, it } from "vitest";
import type { CreateInput, InferItem } from "../../src/fields.js";
import type { SchemaRecord } from "../../src/fields.js";
import { id, list, object, string, stringSet, ttl } from "../../src/fields.js";
import type { ReadBundleStepDecl, WriteRecipeStepDecl } from "../../src/index.js";

describe("type inference", () => {
  it("CreateInput requires fields without default", () => {
    type S = SchemaRecord & {
      userId: ReturnType<typeof id<"usr">>;
      email: ReturnType<typeof string>;
    };
    type _Check = CreateInput<S>;
    expectTypeOf<_Check>().toEqualTypeOf<{ userId: unknown; email?: string | undefined }>();
  });

  it("InferItem marks optional fields as undefined-able", () => {
    type S = SchemaRecord & { a: ReturnType<typeof string> };
    type I = InferItem<S>;
    expectTypeOf<I["a"]>().toEqualTypeOf<string | undefined>();
  });

  it("read bundles and write recipes expose declared step contracts", () => {
    const r: ReadBundleStepDecl = {
      kind: "rootGet",
      label: "org",
      entity: "Org",
      mapInput: () => ({ orgId: "org_1" }),
    };
    const w: WriteRecipeStepDecl = {
      kind: "put",
      label: "createOrg",
      entity: "Org",
      mapInput: () => ({ orgId: "org_1", name: "Acme" }),
    };
    expectTypeOf(r.kind).toEqualTypeOf<"rootGet" | "rootPattern" | "relation">();
    expectTypeOf(w.kind).toEqualTypeOf<"put" | "delete" | "conditionCheck" | "update">();
  });

  it("infers nested object/list/set field types", () => {
    const settings = object({
      theme: string().required(),
      locale: string().optional(),
    });
    const tags = list(string());
    const labels = stringSet();
    expectTypeOf(settings).toMatchTypeOf<{ _kind: "object" }>();
    expectTypeOf(tags).toMatchTypeOf<{ _kind: "list" }>();
    expectTypeOf(labels).toMatchTypeOf<{ _kind: "stringSet" }>();
  });

  it("ttl field is typed as numeric epoch seconds", () => {
    const expiresAt = ttl();
    expectTypeOf(expiresAt).toMatchTypeOf<{ _kind: "ttl" }>();
  });
});
