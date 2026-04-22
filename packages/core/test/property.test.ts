import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { connect, defineTable, entity, id, key, string } from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

describe("property-based invariants", () => {
  it("encodeCursor/decodeCursor round-trips object payloads", async () => {
    const { encodeCursor, decodeCursor } = await import("../src/cursor.js");
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
        async (v) => {
          expect(decodeCursor(encodeCursor(v))).toEqual(v);
        },
      ),
      { seed: 4242, numRuns: 100 },
    );
  });

  it("key preserves segment order and delimiters", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), { minLength: 1 }),
        (parts) => {
          expect(key(...parts)).toBe(parts.map(String).join("#"));
        },
      ),
      { seed: 4242, numRuns: 200 },
    );
  });

  it("batchGet explain always chunks to <= 100 items", () => {
    const T = defineTable({ name: "t", partitionKey: "pk", sortKey: "sk" });
    const E = entity("E", {
      id: id("e").required(),
      email: string().required(),
    })
      .inTable(T)
      .keys(({ id }) => ({ pk: key("E", id), sk: key("ROW") }))
      .identity(["id"])
      .accessPatterns((ap) => ({
        byId: ap.get(({ id }) => ({ pk: key("E", id), sk: key("ROW") })),
      }));
    const db = connect(T, { adapter: createMemoryAdapter(), entities: { E } });

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 350 }), (size) => {
        const keys = Array.from({ length: size }, (_, i) => ({ id: `e_${i}` as never }));
        const plans = db.E.explain.batchGet(keys);
        expect(plans.every((p) => (p.keys?.length ?? 0) <= 100)).toBe(true);
        const total = plans.reduce((acc, p) => acc + (p.keys?.length ?? 0), 0);
        expect(total).toBe(size);
      }),
      { seed: 4242, numRuns: 100 },
    );
  });
});
