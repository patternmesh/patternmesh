import { connect } from "@patternmeshjs/core";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAwsSdkV3Adapter } from "../src/index.js";
import { createLocalHarness, hasLocal } from "./dynamodb-local.fixture.js";

describe.skipIf(!hasLocal)("DynamoDB Local bundles and orchestration", () => {
  const harness = createLocalHarness("orchestration");

  beforeAll(async () => {
    await harness.setupTable();
  });

  afterAll(async () => {
    await harness.cleanupTable();
  });

  it("supports declared read bundles and write recipes", async () => {
    const doc = DynamoDBDocumentClient.from(harness.rawClient);
    const db = connect(harness.AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User: harness.User, UserSummary: harness.UserSummary },
      readBundles: (b) =>
        b.bundle("userHydrate", (s) =>
          s
            .rootGet("user", "User", (i) => ({ userId: i.userId }))
            .rootPattern("emailLookup", "User", "byEmail", (i) => ({ email: i.email })),
        ),
      writeRecipes: (w) =>
        w.recipe("createUserSummary", (s) =>
          s
            .put("user", "User", (i) => ({ userId: i.userId, email: i.email }))
            .put("summary", "UserSummary", (i) => ({
              userId: i.userId,
              note: i.note ?? "created",
            })),
        ),
    });

    await db.recipes?.run("createUserSummary", {
      userId: "usr_bundle_local" as never,
      email: "bundle@example.com",
      note: "ok",
    });
    const read = await db.read?.run("userHydrate", {
      userId: "usr_bundle_local" as never,
      email: "bundle@example.com",
    });
    expect(read?.user).toMatchObject({ email: "bundle@example.com" });
    expect(read?.emailLookup).toMatchObject({ userId: "usr_bundle_local" });

    const labels = await db.orchestrate?.counterSummary({
      primary: async (o) => {
        o.conditionCheck("exists", harness.User, { userId: "usr_bundle_local" as never }, (f, op) =>
          op.exists(f.email),
        );
      },
      summary: async (o) => {
        o.put("summary", harness.UserSummary, {
          userId: "usr_bundle_local" as never,
          note: "updated",
        });
      },
    });
    expect(labels?.summary.summary.operation).toBe("Put");
  });
});
