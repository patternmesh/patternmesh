import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors.js";
import { validateAndApplyDefaults } from "../src/validation.js";
import { string } from "../src/fields.js";
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
});
