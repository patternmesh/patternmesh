import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors.js";
import { validateAndApplyDefaults } from "../src/validation.js";
import { enumType, number, string } from "../src/fields.js";
import { buildFieldMetaMap } from "../src/fields.js";

describe("validation", () => {
  it("rejects unknown keys on create", () => {
    const schema = { email: string().required() };
    const meta = buildFieldMetaMap(schema, []);
    expect(() =>
      validateAndApplyDefaults(
        { email: "a@b.com", extra: 1 } as Record<string, unknown>,
        schema,
        meta,
      ),
    ).toThrow(ValidationError);
  });

  it("applies defaults for missing optional fields", () => {
    const schema = {
      email: string().required(),
      status: enumType(["active", "disabled"] as const).default("active"),
    };
    const meta = buildFieldMetaMap(schema, []);
    expect(
      validateAndApplyDefaults({ email: "a@b.com" } as Record<string, unknown>, schema, meta),
    ).toMatchObject({ email: "a@b.com", status: "active" });
  });

  it("rejects enum and scalar type violations", () => {
    const schema = {
      count: number().required(),
      status: enumType(["active", "disabled"] as const).required(),
    };
    const meta = buildFieldMetaMap(schema, []);
    expect(() =>
      validateAndApplyDefaults(
        { count: "1", status: "pending" } as Record<string, unknown>,
        schema,
        meta,
      ),
    ).toThrow(ValidationError);
  });
});
