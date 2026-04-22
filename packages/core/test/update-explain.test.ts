import { describe, expect, it } from "vitest";
import { connect, defineTable, entity, id, key, number, string } from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

describe("update explain", () => {
  it("compiles SET and optional condition", () => {
    const T = defineTable({ name: "t", partitionKey: "pk", sortKey: "sk" });
    const E = entity("E", {
      id: id("x").required(),
      name: string().optional(),
      v: number().version().required().default(0),
    })
      .inTable(T)
      .keys(({ id }) => ({ pk: key("P", id), sk: key("S") }))
      .identity(["id"])
      .accessPatterns((ap) => ({
        one: ap.get(({ id }) => ({ pk: key("P", id), sk: key("S") })),
      }));

    const db = connect(T, { adapter: createMemoryAdapter(), entities: { E } });
    const op = db.E.update({ id: "x_1" as never })
      .set({ name: "n" })
      .explain();
    expect({
      operation: op.operation,
      tableName: op.tableName,
      key: op.key,
      updateExpression: op.updateExpression,
    }).toMatchInlineSnapshot(`
      {
        "key": {
          "pk": "P#x_1",
          "sk": "S",
        },
        "operation": "UpdateItem",
        "tableName": "t",
        "updateExpression": "SET #u0 = :u0",
      }
    `);
  });
});
