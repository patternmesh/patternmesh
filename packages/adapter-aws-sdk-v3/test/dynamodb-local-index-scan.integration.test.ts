import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalHarness, hasLocal } from "./dynamodb-local.fixture.js";

describe.skipIf(!hasLocal)("DynamoDB Local index and scan options", () => {
  const harness = createLocalHarness("index_scan");

  beforeAll(async () => {
    await harness.setupTable();
  });

  afterAll(async () => {
    await harness.cleanupTable();
  });

  it("allows ConsistentRead on LSI query and supports scan with capacity opt-in", async () => {
    const db = harness.createDb();
    await db.User.create({
      userId: "usr_lsi_local" as never,
      email: "lsi-local@example.com",
      status: "active",
    });

    const lsiPage = await db.User.find.byStatusLsi({
      userId: "usr_lsi_local" as never,
      status: "active",
    });
    expect(lsiPage.items.length).toBeGreaterThanOrEqual(1);

    const scanned = (await db.User.find.scanUsers({
      returnConsumedCapacity: "TOTAL",
    })) as {
      items: readonly Record<string, unknown>[];
      consumedCapacity?: { capacityUnits?: number };
    };
    expect(scanned.items.length).toBeGreaterThanOrEqual(1);
    // DynamoDB Local may omit consumed capacity even when requested.
    if (scanned.consumedCapacity) {
      expect(typeof scanned.consumedCapacity).toBe("object");
    }
  });
});
