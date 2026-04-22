import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, ValidationError } from "../src/index.js";

describe("cursor", () => {
  it("round-trips an opaque cursor payload", () => {
    const original = { pk: "USER#1", sk: "ROOT" };
    const encoded = encodeCursor(original);
    expect(decodeCursor(encoded)).toEqual(original);
  });

  it("rejects malformed cursor payloads", () => {
    const malformed: unknown[] = [
      "not-json",
      Buffer.from("[]", "utf8").toString("base64url"),
      Buffer.from("null", "utf8").toString("base64url"),
      Buffer.from('"str"', "utf8").toString("base64url"),
    ];
    for (const value of malformed) {
      expect(() => decodeCursor(value as never)).toThrow(ValidationError);
    }
  });
});
