import { describe, expect, it } from "vitest";
import { key } from "../src/key.js";

describe("key", () => {
  it("joins segments with #", () => {
    expect(key("USER", "u1")).toBe("USER#u1");
  });

  it("stringifies non-string segments in order", () => {
    expect(key("FLAG", true, 7, false)).toBe("FLAG#true#7#false");
  });

  it("supports empty segments without reordering", () => {
    expect(key("ROOT", "", "leaf")).toBe("ROOT##leaf");
  });
});
