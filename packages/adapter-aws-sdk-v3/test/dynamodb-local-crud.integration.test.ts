import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "@patternmeshjs/core";
import { createLocalHarness, hasLocal } from "./dynamodb-local.fixture.js";

describe.skipIf(!hasLocal)("DynamoDB Local CRUD/query/batch", () => {
  const harness = createLocalHarness("crud");

  beforeAll(async () => {
    await harness.setupTable();
  });

  afterAll(async () => {
    await harness.cleanupTable();
  });

  it("create, get, delete with logical item shape", async () => {
    const db = harness.createDb();
    await db.User.create({
      userId: "usr_local_1" as never,
      email: "local1@example.com",
      name: "Local",
    });

    const row = await db.User.get({ userId: "usr_local_1" as never });
    expect(row).toMatchObject({
      userId: "usr_local_1",
      email: "local1@example.com",
      name: "Local",
      status: "active",
    });
    expect(row).not.toHaveProperty("pk");
    expect(row).not.toHaveProperty("entity");

    await db.User.delete({ userId: "usr_local_1" as never });
    expect(await db.User.get({ userId: "usr_local_1" as never })).toBeNull();
  });

  it("find.byId, find.byEmail, and update().set().go()", async () => {
    const db = harness.createDb();
    await db.User.create({
      userId: "usr_local_2" as never,
      email: "local2@example.com",
    });

    const byId = await db.User.find.byId({ userId: "usr_local_2" as never });
    expect(byId).toMatchObject({ email: "local2@example.com" });

    const byEmail = await db.User.find.byEmail({ email: "local2@example.com" });
    expect(byEmail).toMatchObject({ userId: "usr_local_2" });

    const updated = await db.User.update({ userId: "usr_local_2" as never })
      .set({ name: "Renamed" })
      .go();
    expect(updated).toMatchObject({ name: "Renamed", email: "local2@example.com" });
  });

  it("ap.count via find", async () => {
    const db = harness.createDb();
    await db.User.create({
      userId: "usr_local_count" as never,
      email: "count@example.com",
    });
    const n = await db.User.find.countByEmail({ email: "count@example.com" });
    expect(n).toBe(1);
  });

  it("batchGet preserves order; batchWrite puts and deletes", async () => {
    const db = harness.createDb();
    await db.User.batchWrite({
      puts: [
        { userId: "usr_bg_1" as never, email: "bg1@example.com" },
        { userId: "usr_bg_2" as never, email: "bg2@example.com" },
      ],
    });
    const rows = await db.User.batchGet([
      { userId: "usr_bg_1" as never },
      { userId: "usr_missing" as never },
      { userId: "usr_bg_2" as never },
    ]);
    expect(rows[0]?.email).toBe("bg1@example.com");
    expect(rows[1]).toBeNull();
    expect(rows[2]?.email).toBe("bg2@example.com");
    await db.User.batchWrite({
      deletes: [{ userId: "usr_bg_1" as never }, { userId: "usr_bg_2" as never }],
    });
  });

  it("rejects ConsistentRead on GSI query", async () => {
    const db = harness.createDb();
    await expect(db.User.find.gsiConsistentRead({ email: "any@example.com" })).rejects.toThrow(
      ValidationError,
    );
  });
});
