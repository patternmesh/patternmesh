import { describe, expect, it } from "vitest";
import {
  connect,
  defineTable,
  entity,
  enumType,
  id,
  key,
  string,
  ValidationError,
} from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
  indexes: { GSI1: { partitionKey: "gsi1pk", sortKey: "gsi1sk" } },
});

const LsiTable = defineTable({
  name: "lsi_app",
  partitionKey: "pk",
  sortKey: "sk",
  localIndexes: {
    LSI1: {
      partitionKey: "pk",
      sortKey: "lsi1sk",
      projectionType: "ALL",
      type: "LSI",
    },
  },
  indexes: { GSI1: { partitionKey: "gsi1pk", sortKey: "gsi1sk", type: "GSI" } },
});

const LsiUser = entity("LsiUser", {
  userId: id("usr").required(),
  email: string().required(),
  status: enumType(["active", "disabled"] as const).default("active"),
})
  .inTable(LsiTable)
  .keys(({ userId }) => ({
    pk: key("USER", userId),
    sk: key("PROFILE"),
  }))
  .index("LSI1", ({ status }) => ({
    lsi1sk: key("STATUS", status),
  }))
  .index("GSI1", ({ email }) => ({
    gsi1pk: key("EMAIL", email),
    gsi1sk: key("USER"),
  }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byStatusLsi: ap.query("LSI1", ({ userId, status }) => ({
      pk: key("USER", userId),
      skBeginsWith: key("STATUS", status),
      consistentRead: true,
    })),
    byEmailGsiBad: ap.query("GSI1", ({ email }) => ({
      pk: key("EMAIL", email),
      skBeginsWith: key("USER"),
      consistentRead: true,
    })),
    scanByLsi: ap.scan("LSI1", () => ({
      limit: 10,
      filterExpression: "attribute_exists(#n1)",
      filterExpressionAttributeNames: { "#n1": "email" },
      filterExpressionAttributeValues: {},
      consistentRead: true,
    })),
    scanByGsiBad: ap.scan("GSI1", () => ({
      limit: 10,
      filterExpression: "attribute_exists(#n1)",
      filterExpressionAttributeNames: { "#n1": "email" },
      filterExpressionAttributeValues: {},
      consistentRead: true,
    })),
    scanByGsi: ap.scan("GSI1", () => ({
      limit: 10,
      filterExpression: "attribute_exists(#n1)",
      filterExpressionAttributeNames: { "#n1": "email" },
      filterExpressionAttributeValues: {},
    })),
  }));

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
  name: string().optional(),
  status: enumType(["active", "disabled"] as const).default("active"),
})
  .inTable(AppTable)
  .keys(({ userId }) => ({
    pk: key("USER", userId),
    sk: key("PROFILE"),
  }))
  .index("GSI1", ({ email }) => ({
    gsi1pk: key("EMAIL", email),
    gsi1sk: key("USER"),
  }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }) => ({
      pk: key("USER", userId),
      sk: key("PROFILE"),
    })),
    bySkEq: ap.query(undefined, ({ userId }) => ({
      pk: key("USER", userId),
      skEq: key("PROFILE"),
    })),
    bySkBetween: ap.query(undefined, ({ userId }) => ({
      pk: key("USER", userId),
      skBetween: [key("PROFILE"), key("PROFILE", "z")] as const,
    })),
    withUserFilter: ap.query(undefined, ({ userId }) => ({
      pk: key("USER", userId),
      skBeginsWith: key("PROFILE"),
      filterExpression: "attribute_exists(#n1)",
      filterExpressionAttributeNames: { "#n1": "email" },
      filterExpressionAttributeValues: {},
    })),
    gsiBad: ap.query("GSI1", ({ email }) => ({
      pk: key("EMAIL", email),
      skBeginsWith: key("USER"),
      consistentRead: true,
    })),
    countUsers: ap.count(undefined, ({ userId }) => ({
      pk: key("USER", userId),
      skBeginsWith: key("PROFILE"),
    })),
    scanAll: ap.scan(undefined, () => ({
      limit: 10,
      filterExpression: "attribute_exists(#n1)",
      filterExpressionAttributeNames: { "#n1": "email" },
      filterExpressionAttributeValues: {},
    })),
  }));

describe("repository: batch APIs, query options, return modes, explain", () => {
  it("batchGet order and null misses", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await db.User.create({ userId: "usr_a" as never, email: "a@x.com" });
    await db.User.create({ userId: "usr_b" as never, email: "b@x.com" });
    const out = await db.User.batchGet([
      { userId: "usr_a" as never },
      { userId: "usr_missing" as never },
      { userId: "usr_b" as never },
    ]);
    expect(out[0]?.userId).toBe("usr_a");
    expect(out[1]).toBeNull();
    expect(out[2]?.userId).toBe("usr_b");
  });

  it("batchWrite puts and deletes", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await db.User.batchWrite({
      puts: [
        { userId: "usr_w1" as never, email: "w1@x.com" },
        { userId: "usr_w2" as never, email: "w2@x.com" },
      ],
    });
    expect((await db.User.get({ userId: "usr_w1" as never }))?.email).toBe("w1@x.com");
    await db.User.batchWrite({ deletes: [{ userId: "usr_w1" as never }, { userId: "usr_w2" as never }] });
    expect(await db.User.get({ userId: "usr_w1" as never })).toBeNull();
  });

  it("create return none and delete return old", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    const c = await db.User.create({ userId: "usr_r" as never, email: "r@x.com" }, { return: "none" });
    expect(c).toBeUndefined();
    await db.User.create({ userId: "usr_r2" as never, email: "r2@x.com" });
    const old = await db.User.delete({ userId: "usr_r2" as never }, { return: "old" });
    expect(old).toMatchObject({ email: "r2@x.com" });
  });

  it("update().go({ return: 'none' })", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await db.User.create({ userId: "usr_u" as never, email: "u@x.com" });
    const v = await db.User.update({ userId: "usr_u" as never }).set({ name: "N" }).go({ return: "none" });
    expect(v).toBeUndefined();
  });

  it("skEq and skBetween query", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await db.User.create({ userId: "usr_sk" as never, email: "sk@x.com" });
    const page = await db.User.find.bySkEq({ userId: "usr_sk" as never });
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    const page2 = await db.User.find.bySkBetween({ userId: "usr_sk" as never });
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
  });

  it("ap.count returns number", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await db.User.create({ userId: "usr_c1" as never, email: "c1@x.com" });
    await db.User.create({ userId: "usr_c2" as never, email: "c2@x.com" });
    const n = await db.User.find.countUsers({ userId: "usr_c1" as never });
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("explain warns on user filterExpression", () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    const ex = db.User.explain.find.withUserFilter({ userId: "usr_x" as never });
    expect(ex.warnings.length).toBeGreaterThan(0);
  });

  it("scan is explicit and explain warnings are stronger", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await db.User.create({ userId: "usr_scan_1" as never, email: "scan@x.com" });
    const page = await db.User.find.scanAll({});
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    const ex = db.User.explain.find.scanAll({});
    expect(ex.operation).toBe("Scan");
    expect(ex.warnings).toContain("Scan applies FilterExpression after items are read.");
  });

  it("GSI + ConsistentRead throws ValidationError", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await expect(db.User.find.gsiBad({ email: "z@x.com" })).rejects.toThrow(ValidationError);
  });

  it("LSI + ConsistentRead is allowed; GSI still rejected", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(LsiTable, { adapter, entities: { LsiUser } });
    await db.LsiUser.create({ userId: "usr_lsi_1" as never, email: "lsi@x.com", status: "active" });
    const page = await db.LsiUser.find.byStatusLsi({ userId: "usr_lsi_1" as never, status: "active" });
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    const scanLsi = await db.LsiUser.find.scanByLsi({});
    expect(scanLsi.items.length).toBeGreaterThanOrEqual(1);
    const scanGsi = await db.LsiUser.find.scanByGsi({});
    expect(scanGsi.items.length).toBeGreaterThanOrEqual(1);
    await expect(db.LsiUser.find.byEmailGsiBad({ email: "lsi@x.com" })).rejects.toThrow(ValidationError);
    await expect(db.LsiUser.find.scanByGsiBad({})).rejects.toThrow(ValidationError);
  });

  it("capacity metadata is opt-in and additive", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    await db.User.create({ userId: "usr_cap_1" as never, email: "cap1@x.com" });

    const page = (await db.User.find.bySkEq({
      userId: "usr_cap_1" as never,
      returnConsumedCapacity: "TOTAL",
    })) as {
      items: readonly Record<string, unknown>[];
      consumedCapacity?: { capacityUnits?: number };
    };
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.consumedCapacity?.capacityUnits).toBeDefined();

    const counted = (await db.User.find.countUsers({
      userId: "usr_cap_1" as never,
      returnConsumedCapacity: "TOTAL",
    })) as { count: number; consumedCapacity?: { capacityUnits?: number } };
    expect(typeof counted.count).toBe("number");
    expect(counted.consumedCapacity?.capacityUnits).toBeDefined();
  });

  it("defineTable validates LSI constraints", () => {
    expect(() =>
      defineTable({
        name: "bad_lsi",
        partitionKey: "pk",
        sortKey: "sk",
        localIndexes: {
          BAD: {
            partitionKey: "other_pk",
            sortKey: "lsi",
          },
        },
      }),
    ).toThrow();
  });

  it("explain.batchGet chunks at 100", () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    const keys = Array.from({ length: 101 }, (_, i) => ({ userId: `usr_${i}` as never }));
    const chunks = db.User.explain.batchGet(keys);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.keys?.length).toBe(100);
    expect(chunks[1]?.keys?.length).toBe(1);
  });
});
