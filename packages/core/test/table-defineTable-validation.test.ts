import { describe, expect, it } from "vitest";
import { defineTable } from "../src/table.js";

describe("defineTable local index validation", () => {
  it("rejects more than five local secondary indexes", () => {
    expect(() =>
      defineTable({
        name: "too_many_lsi",
        partitionKey: "pk",
        sortKey: "sk",
        localIndexes: {
          L1: { partitionKey: "pk", sortKey: "l1" },
          L2: { partitionKey: "pk", sortKey: "l2" },
          L3: { partitionKey: "pk", sortKey: "l3" },
          L4: { partitionKey: "pk", sortKey: "l4" },
          L5: { partitionKey: "pk", sortKey: "l5" },
          L6: { partitionKey: "pk", sortKey: "l6" },
        },
      }),
    ).toThrow(/at most 5 local secondary indexes/);
  });

  it("rejects local indexes without base sort key", () => {
    expect(() =>
      defineTable({
        name: "missing_base_sort",
        partitionKey: "pk",
        localIndexes: {
          L1: { partitionKey: "pk", sortKey: "l1" },
        },
      }),
    ).toThrow(/localIndexes require a base-table sortKey/);
  });

  it("validates INCLUDE projection nonKeyAttributes rules", () => {
    expect(() =>
      defineTable({
        name: "include_without_attrs",
        partitionKey: "pk",
        sortKey: "sk",
        localIndexes: {
          L1: { partitionKey: "pk", sortKey: "l1", projectionType: "INCLUDE" },
        },
      }),
    ).toThrow(/nonKeyAttributes is required/);

    expect(() =>
      defineTable({
        name: "all_with_attrs",
        partitionKey: "pk",
        sortKey: "sk",
        localIndexes: {
          L1: {
            partitionKey: "pk",
            sortKey: "l1",
            projectionType: "ALL",
            nonKeyAttributes: ["a"],
          },
        },
      }),
    ).toThrow(/only valid with projectionType INCLUDE/);
  });

  it("accepts a valid local index shape", () => {
    const table = defineTable({
      name: "valid_lsi",
      partitionKey: "pk",
      sortKey: "sk",
      localIndexes: {
        L1: {
          partitionKey: "pk",
          sortKey: "l1",
          projectionType: "INCLUDE",
          nonKeyAttributes: ["status"],
        },
      },
    });
    expect(table.localIndexes?.L1?.sortKey).toBe("l1");
  });
});
