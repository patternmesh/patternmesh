import { describe, expect, it } from "vitest";
import { defineTable, entity, id, key, string, ValidationError } from "../src/index.js";

describe("reserved logical attribute names", () => {
  it("rejects field names that collide with internal table attributes", () => {
    const table = defineTable({ name: "reserved", partitionKey: "pk", sortKey: "sk" });

    expect(() =>
      entity("BadEntity", {
        pk: string().required(),
        itemId: id("itm").required(),
      })
        .inTable(table)
        .keys(({ itemId }: { itemId: string }) => ({ pk: key("ITEM", itemId), sk: key("ROOT") }))
        .identity(["itemId"])
        .accessPatterns((ap) => ({
          byId: ap.get(({ itemId }: { itemId: string }) => ({
            pk: key("ITEM", itemId),
            sk: key("ROOT"),
          })),
        })),
    ).toThrow(ValidationError);
  });
});
