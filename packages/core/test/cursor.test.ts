import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, ValidationError } from "../src/index.js";

describe("cursor", () => {
  it("round-trips an opaque cursor payload", () => {
    const original = { pk: "USER#1", sk: "ROOT" };
    const encoded = encodeCursor(original);
    expect(decodeCursor(encoded)).toEqual(original);
  });

  it("rejects malformed cursor payloads", () => {
    expect(() => decodeCursor("not-json" as never)).toThrow(ValidationError);
  });
});
