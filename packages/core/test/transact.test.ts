import { describe, expect, it } from "vitest";
import {
  TRANSACT_MAX_ITEMS,
  ValidationError,
  connect,
  defineTable,
  entity,
  id,
  key,
  string,
} from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const T = defineTable({
  name: "t",
  partitionKey: "pk",
  sortKey: "sk",
});

const E = entity("E", {
  id: id("e").required(),
  name: string().required(),
})
  .inTable(T)
  .keys(({ id }) => ({ pk: key("E", id), sk: key("ROW") }))
  .identity(["id"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ id }) => ({ pk: key("E", id), sk: key("ROW") })),
  }));

describe("transact", () => {
  it("rejects duplicate write targets", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(T, { adapter, entities: { E } });
    await expect(
      db.tx.write(async (w) => {
        w.put(E, { id: "e_dup" as never, name: "a" });
        w.delete(E, { id: "e_dup" as never });
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("tx.read returns labeled public items and null for misses", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(T, { adapter, entities: { E } });
    await db.E.create({ id: "e1" as never, name: "one" });
    const got = await db.tx.read(async (r) => {
      r.get("hit", E, { id: "e1" as never });
      r.get("miss", E, { id: "missing" as never });
    });
    expect(got.hit).toMatchObject({ id: "e1", name: "one" });
    expect(got.miss).toBeNull();
  });

  it("explain.tx.write returns participant-ordered plans", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(T, { adapter, entities: { E } });
    await db.E.create({ id: "e2" as never, name: "two" });
    const plans = db.explain.tx.write((w) => {
      w.put(E, { id: "e2b" as never, name: "other" });
      w.update(E, { id: "e2" as never }).set({ name: "TWO" });
    });
    expect(plans).toHaveLength(2);
    expect(plans[0]?.operation).toBe("PutItem");
    expect(plans[1]?.operation).toBe("UpdateItem");
  });

  it("explain.tx.read returns [] when no gets registered", () => {
    const adapter = createMemoryAdapter();
    const db = connect(T, { adapter, entities: { E } });
    expect(db.explain.tx.read(() => {})).toEqual([]);
  });

  it("rejects more than TRANSACT_MAX_ITEMS read slots", () => {
    const adapter = createMemoryAdapter();
    const db = connect(T, { adapter, entities: { E } });
    expect(() =>
      db.explain.tx.read((r) => {
        for (let i = 0; i < TRANSACT_MAX_ITEMS + 1; i++) {
          r.get(`k${i}`, E, { id: `e${i}` as never });
        }
      }),
    ).toThrow(ValidationError);
  });

  it("memory transactWrite applies put then update on another item", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(T, { adapter, entities: { E } });
    await db.E.create({ id: "e3" as never, name: "three" });
    await db.tx.write(async (w) => {
      w.put(E, { id: "e3b" as never, name: "sibling" });
      w.update(E, { id: "e3" as never }).set({ name: "THREE" });
    });
    expect((await db.E.get({ id: "e3" as never }))?.name).toBe("THREE");
    expect((await db.E.get({ id: "e3b" as never }))?.name).toBe("sibling");
  });
});
