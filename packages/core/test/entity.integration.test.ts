import { describe, expect, it } from "vitest";
import {
  connect,
  defineTable,
  entity,
  enumType,
  id,
  key,
  string,
} from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
  indexes: {
    GSI1: { partitionKey: "gsi1pk", sortKey: "gsi1sk" },
  },
});

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
    byEmail: ap.unique("GSI1", ({ email }) => ({
      pk: key("EMAIL", email),
      sk: key("USER"),
    })),
  }));

describe("connect + repository", () => {
  it("create, get, delete round-trip with logical item shape", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, {
      adapter,
      entities: { User },
    });

    await db.User.create({
      userId: "usr_1" as never,
      email: "a@example.com",
      name: "Ada",
    });

    const row = await db.User.get({ userId: "usr_1" as never });
    expect(row).toMatchObject({
      userId: "usr_1",
      email: "a@example.com",
      name: "Ada",
      status: "active",
    });
    expect(row).not.toHaveProperty("pk");
    expect(row).not.toHaveProperty("entity");

    const rows = adapter.allItems("app");
    const stored = rows[0];
    expect(stored).toBeDefined();
    expect(stored?.pk).toBe("USER#usr_1");
    expect(stored?.entity).toBe("User");

    await db.User.delete({ userId: "usr_1" as never });
    expect(await db.User.get({ userId: "usr_1" as never })).toBeNull();
  });

  it("find.byId and find.byEmail (unique)", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });

    await db.User.create({
      userId: "usr_2" as never,
      email: "b@example.com",
    });

    const byId = await db.User.find.byId({ userId: "usr_2" as never });
    expect(byId).toMatchObject({ email: "b@example.com" });

    const byEmail = await db.User.find.byEmail({ email: "b@example.com" });
    expect(byEmail).toMatchObject({ userId: "usr_2" });
  });

  it("explain.create returns PutItem shape", () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { User } });
    const op = db.User.explain.create({
      userId: "usr_3" as never,
      email: "c@example.com",
    });
    expect(op.operation).toBe("PutItem");
    expect(op.tableName).toBe("app");
    expect(op.key).toEqual({ pk: "USER#usr_3", sk: "PROFILE" });
  });
});
