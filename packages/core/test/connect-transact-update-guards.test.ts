import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  ValidationError,
  connect,
  defineTable,
  entity,
  id,
  key,
  string,
} from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const Table = defineTable({ name: "guard_table", partitionKey: "pk", sortKey: "sk" });
const OtherTable = defineTable({ name: "guard_other", partitionKey: "pk", sortKey: "sk" });

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
  status: string().optional(),
})
  .inTable(Table)
  .keys(({ userId }) => ({ pk: key("USER", userId), sk: key("PROFILE") }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }) => ({ pk: key("USER", userId), sk: key("PROFILE") })),
    scanAll: ap.scan(undefined, () => ({ limit: 10 })),
  }));

const UserOtherTable = entity("UserOther", {
  userId: id("usr").required(),
  email: string().required(),
})
  .inTable(OtherTable)
  .keys(({ userId }) => ({ pk: key("USER", userId), sk: key("PROFILE") }))
  .identity(["userId"])
  .accessPatterns(() => ({}));

describe("connect/transact/update guardrails", () => {
  it("rejects non-compiled entities and table mismatches", () => {
    const adapter = createMemoryAdapter();
    expect(() =>
      connect(Table, {
        adapter,
        entities: { Broken: { runtime: {} } as never },
      }),
    ).toThrow(ConfigurationError);

    expect(() => connect(Table, { adapter, entities: { UserOtherTable } })).toThrow(
      /different table reference/,
    );
  });

  it("rejects unknown read bundle and unknown recipe", async () => {
    const db = connect(Table, { adapter: createMemoryAdapter(), entities: { User } });
    await expect(db.read.run("missing", {})).rejects.toThrow(ValidationError);
    await expect(db.recipes.run("missing", {})).rejects.toThrow(ValidationError);
  });

  it("enforces read bundle max depth and fanOut cap", async () => {
    const db = connect(Table, {
      adapter: createMemoryAdapter(),
      entities: { User },
      readBundles: (b) =>
        b.bundle("users", (x) => x.rootPattern("users", "User", "scanAll", () => ({})), {
          maxDepth: 2,
        }),
    });

    await expect(db.read.run("users", { userId: "usr_1" as never })).rejects.toThrow(
      /Only one-hop bundles/,
    );
    await db.User.create({ userId: "usr_1" as never, email: "u1@example.com" });
    await expect(
      db.read.run("users", { userId: "usr_1" as never }, { maxDepth: 1, fanOutCap: 0 }),
    ).rejects.toThrow(/exceeded cap 0/);
  });

  it("supports lifecycle archive mark disposition", async () => {
    const db = connect(Table, { adapter: createMemoryAdapter(), entities: { User } });
    await db.User.create({ userId: "usr_arc" as never, email: "arc@example.com" });

    const labels = await db.lifecycle.archive({
      sourceEntity: User,
      sourceKey: { userId: "usr_arc" as never },
      archiveEntity: User,
      archiveItem: { userId: "usr_arc_archive" as never, email: "arc+archive@example.com" },
      sourceDisposition: "mark",
      markFields: { status: "archived" },
    });

    expect(labels.archivePut?.operation).toBe("Put");
    expect(labels.archiveSourceMark?.operation).toBe("Update");
  });

  it("rejects no-op updates, unknown path roots, and empty set operations", async () => {
    const db = connect(Table, { adapter: createMemoryAdapter(), entities: { User } });
    await db.User.create({ userId: "usr_upd" as never, email: "upd@example.com" });

    await expect(db.User.update({ userId: "usr_upd" as never }).go()).rejects.toThrow(
      /Update has no SET, ADD, or REMOVE/,
    );
    expect(() => db.User.update({ userId: "usr_upd" as never }).setPath("missing.path", 1)).toThrow(
      ValidationError,
    );
    expect(() =>
      db.User.update({ userId: "usr_upd" as never }).setAdd("status", new Set()),
    ).toThrow(/Empty set is not allowed/);
  });
});
