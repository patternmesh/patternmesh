import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalHarness, hasLocal } from "./dynamodb-local.fixture.js";

describe.skipIf(!hasLocal)("DynamoDB Local complex attributes", () => {
  const harness = createLocalHarness("complex");

  beforeAll(async () => {
    await harness.setupTable();
  });

  afterAll(async () => {
    await harness.cleanupTable();
  });

  it("supports map/list/set attributes with nested update operations", async () => {
    const db = harness.createDb();
    await db.User.create({
      userId: "usr_complex_local" as never,
      email: "complex@example.com",
      settings: { theme: "dark", locale: "en-US" } as never,
      tags: ["a"] as never,
      labels: new Set(["alpha"]) as never,
      scoreSet: new Set([1]) as never,
    });
    await db.User.update({ userId: "usr_complex_local" as never })
      .setPath("settings.theme", "light")
      .listAppend("tags", ["b"])
      .setAdd("labels", new Set(["beta"]))
      .if((f, o) => o.exists(f.email))
      .go();
    const row = await db.User.get({ userId: "usr_complex_local" as never });
    expect(row).toMatchObject({
      settings: { theme: "light", locale: "en-US" },
    });
  });
});
