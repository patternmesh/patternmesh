import { describe, expect, it } from "vitest";
import { key } from "../src/key.js";

describe("key", () => {
  it("joins segments with #", () => {
    expect(key("USER", "u1")).toBe("USER#u1");
  });
});
