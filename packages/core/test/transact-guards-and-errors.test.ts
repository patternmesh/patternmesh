import { describe, expect, it } from "vitest";
import {
  IdempotentParameterMismatchError,
  TransactionCanceledError,
  ValidationError,
  connect,
  defineTable,
  entity,
  id,
  key,
  string,
} from "../src/index.js";
import type { DynamoAdapter } from "../src/adapter.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const T = defineTable({ name: "tx_guard_t", partitionKey: "pk", sortKey: "sk" });
const E = entity("TxEntity", {
  id: id("e").required(),
  name: string().required(),
})
  .inTable(T)
  .keys(({ id }) => ({ pk: key("E", id), sk: key("ROW") }))
  .identity(["id"])
  .accessPatterns(() => ({}));

describe("transact guards and error mapping", () => {
  it("rejects empty write participants", async () => {
    const db = connect(T, { adapter: createMemoryAdapter(), entities: { E } });
    await expect(db.tx.write(async () => {})).rejects.toThrow(ValidationError);
  });

  it("maps transaction canceled errors with reasons", async () => {
    const base = createMemoryAdapter();
    const adapter: DynamoAdapter = {
      ...base,
      transactWriteItems: async () => {
        throw {
          name: "TransactionCanceledException",
          CancellationReasons: [{ Code: "ConditionalCheckFailed", Message: "failed condition" }],
        };
      },
    };
    const db = connect(T, { adapter, entities: { E } });
    await expect(
      db.tx.write(async (w) => {
        w.put(E, { id: "e1" as never, name: "n1" });
      }),
    ).rejects.toBeInstanceOf(TransactionCanceledError);
  });

  it("maps idempotent token mismatch errors", async () => {
    const base = createMemoryAdapter();
    const adapter: DynamoAdapter = {
      ...base,
      transactWriteItems: async () => {
        throw { __type: "IdempotentParameterMismatchException" };
      },
    };
    const db = connect(T, { adapter, entities: { E } });
    await expect(
      db.tx.write(async (w) => {
        w.put(E, { id: "e2" as never, name: "n2" });
      }),
    ).rejects.toBeInstanceOf(IdempotentParameterMismatchError);
  });
});
