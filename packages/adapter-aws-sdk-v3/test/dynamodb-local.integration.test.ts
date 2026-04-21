import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  IdempotentParameterMismatchError,
  TransactionCanceledError,
  connect,
  defineTable,
  entity,
  enumType,
  id,
  key,
  list,
  numberSet,
  object,
  string,
  stringSet,
  ValidationError,
} from "@patternmesh/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAwsSdkV3Adapter } from "../src/index.js";

const endpoint = process.env.DYNAMODB_ENDPOINT?.trim();
const hasLocal = Boolean(endpoint);

async function waitUntilTableActive(client: DynamoDBClient, tableName: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const out = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (out.Table?.TableStatus === "ACTIVE") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Table ${tableName} did not become ACTIVE in time`);
}

describe.skipIf(!hasLocal)("DynamoDB Local (AWS SDK v3 adapter)", () => {
  const rawClient = new DynamoDBClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
    },
  });

  const tableName = `dynamodb_it_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const AppTable = defineTable({
    name: tableName,
    partitionKey: "pk",
    sortKey: "sk",
    localIndexes: {
      LSI1: { partitionKey: "pk", sortKey: "lsi1sk", projectionType: "ALL", type: "LSI" },
    },
    indexes: {
      GSI1: { partitionKey: "gsi1pk", sortKey: "gsi1sk", type: "GSI" },
    },
  });

  const User = entity("User", {
    userId: id("usr").required(),
    email: string().required(),
    name: string().optional(),
    status: enumType(["active", "disabled"] as const).default("active"),
    settings: object({
      theme: string().required(),
      locale: string().optional(),
    }).optional(),
    tags: list(string()).optional(),
    labels: stringSet().optional(),
    scoreSet: numberSet().optional(),
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
    .index("LSI1", ({ status }) => ({
      lsi1sk: key("STATUS", status),
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
      countByEmail: ap.count("GSI1", ({ email }) => ({
        pk: key("EMAIL", email),
        skEq: key("USER"),
      })),
      gsiConsistentRead: ap.query("GSI1", ({ email }) => ({
        pk: key("EMAIL", email),
        skBeginsWith: key("USER"),
        consistentRead: true,
      })),
      byStatusLsi: ap.query("LSI1", ({ userId, status }) => ({
        pk: key("USER", userId),
        skBeginsWith: key("STATUS", status),
        consistentRead: true,
      })),
      scanUsers: ap.scan(undefined, () => ({
        limit: 25,
        filterExpression: "attribute_exists(#n1)",
        filterExpressionAttributeNames: { "#n1": "email" },
        filterExpressionAttributeValues: {},
      })),
    }));

  const UserSummary = entity("UserSummary", {
    userId: id("usr").required(),
    note: string().required(),
  })
    .inTable(AppTable)
    .keys(({ userId }) => ({
      pk: key("USER", userId),
      sk: key("SUMMARY"),
    }))
    .identity(["userId"])
    .accessPatterns((ap) => ({
      byId: ap.get(({ userId }) => ({
        pk: key("USER", userId),
        sk: key("SUMMARY"),
      })),
    }));

  beforeAll(async () => {
    await rawClient.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
          { AttributeName: "lsi1sk", AttributeType: "S" },
          { AttributeName: "gsi1pk", AttributeType: "S" },
          { AttributeName: "gsi1sk", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        LocalSecondaryIndexes: [
          {
            IndexName: "LSI1",
            KeySchema: [
              { AttributeName: "pk", KeyType: "HASH" },
              { AttributeName: "lsi1sk", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1",
            KeySchema: [
              { AttributeName: "gsi1pk", KeyType: "HASH" },
              { AttributeName: "gsi1sk", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    );
    await waitUntilTableActive(rawClient, tableName);
  });

  afterAll(async () => {
    try {
      await rawClient.send(new DeleteTableCommand({ TableName: tableName }));
    } catch {
      // best-effort cleanup
    }
    rawClient.destroy();
  });

  it("create, get, delete with logical item shape", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });

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
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });

    await db.User.create({
      userId: "usr_local_2" as never,
      email: "local2@example.com",
    });

    const byId = await db.User.find.byId({ userId: "usr_local_2" as never });
    expect(byId).toMatchObject({ email: "local2@example.com" });

    const byEmail = await db.User.find.byEmail({ email: "local2@example.com" });
    expect(byEmail).toMatchObject({ userId: "usr_local_2" });

    const updated = await db.User.update({ userId: "usr_local_2" as never }).set({ name: "Renamed" }).go();
    expect(updated).toMatchObject({ name: "Renamed", email: "local2@example.com" });

    const again = await db.User.get({ userId: "usr_local_2" as never });
    expect(again).toMatchObject({ name: "Renamed" });

    await db.User.delete({ userId: "usr_local_2" as never });
  });

  it("ap.count via find", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
    await db.User.create({
      userId: "usr_local_count" as never,
      email: "count@example.com",
    });
    const n = await db.User.find.countByEmail({ email: "count@example.com" });
    expect(n).toBe(1);
    await db.User.delete({ userId: "usr_local_count" as never });
  });

  it("batchGet preserves order; batchWrite puts and deletes", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
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
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
    await expect(
      db.User.find.gsiConsistentRead({ email: "any@example.com" }),
    ).rejects.toThrow(ValidationError);
  });

  it("allows ConsistentRead on LSI query and supports scan with capacity opt-in", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
    await db.User.create({
      userId: "usr_lsi_local" as never,
      email: "lsi-local@example.com",
      status: "active",
    });

    const lsiPage = await db.User.find.byStatusLsi({ userId: "usr_lsi_local" as never, status: "active" });
    expect(lsiPage.items.length).toBeGreaterThanOrEqual(1);

    const scanned = (await db.User.find.scanUsers({
      returnConsumedCapacity: "TOTAL",
    })) as { items: readonly Record<string, unknown>[]; consumedCapacity?: { capacityUnits?: number } };
    expect(scanned.items.length).toBeGreaterThanOrEqual(1);
    // DynamoDB Local may omit consumed capacity even when requested.
    if (scanned.consumedCapacity) {
      expect(typeof scanned.consumedCapacity).toBe("object");
    }

    await db.User.delete({ userId: "usr_lsi_local" as never });
  });

  it("tx.write is atomic; tx.read returns labeled items", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
    await db.tx.write(async (w) => {
      w.put(User, {
        userId: "usr_tx_1" as never,
        email: "tx1@example.com",
        name: "Tx",
      });
    });
    const plans = db.explain.tx.write((w) => {
      w.put(User, {
        userId: "usr_tx_2" as never,
        email: "tx2@example.com",
        name: "Second",
      });
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.operation).toBe("PutItem");
    await db.tx.write(async (w) => {
      w.put(User, {
        userId: "usr_tx_2" as never,
        email: "tx2@example.com",
        name: "Second",
      });
    });

    const read = await db.tx.read(async (r) => {
      r.get("u1", User, { userId: "usr_tx_1" as never });
      r.get("u2", User, { userId: "usr_tx_2" as never });
    });
    expect(read.u1).toMatchObject({ email: "tx1@example.com" });
    expect(read.u2).toMatchObject({ email: "tx2@example.com" });

    await db.User.batchWrite({
      deletes: [{ userId: "usr_tx_1" as never }, { userId: "usr_tx_2" as never }],
    });
  });

  it("tx.write maps failed transaction to TransactionCanceledError with ordered reasons", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
    await db.User.create({
      userId: "usr_tx_fail" as never,
      email: "txfail@example.com",
    });
    await expect(
      db.tx.write(async (w) => {
        w.update(User, { userId: "usr_tx_fail" as never })
          .set({ name: "nope" })
          .if((f, o) => o.eq(f.status, "disabled"));
      }),
    ).rejects.toBeInstanceOf(TransactionCanceledError);

    await db.User.delete({ userId: "usr_tx_fail" as never });
  });

  it("reuses ClientRequestToken with different parameters → IdempotentParameterMismatchError", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
    const token = `idem-${Date.now()}`;
    await db.tx.write(
      async (w) => {
        w.put(User, {
          userId: "usr_idem_a" as never,
          email: "idema@example.com",
        });
      },
      { clientRequestToken: token },
    );
    await expect(
      db.tx.write(
        async (w) => {
          w.put(User, {
            userId: "usr_idem_b" as never,
            email: "idemb@example.com",
          });
        },
        { clientRequestToken: token },
      ),
    ).rejects.toBeInstanceOf(IdempotentParameterMismatchError);

    await db.User.batchWrite({
      deletes: [{ userId: "usr_idem_a" as never }],
    });
  });

  it("supports declared read bundles and write recipes", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User, UserSummary },
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
            .put("summary", "UserSummary", (i) => ({ userId: i.userId, note: i.note ?? "created" })),
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
        o.conditionCheck("exists", User, { userId: "usr_bundle_local" as never }, (f, op) => op.exists(f.email));
      },
      summary: async (o) => {
        o.put("summary", UserSummary, { userId: "usr_bundle_local" as never, note: "updated" });
      },
    });
    expect(labels?.summary.summary.operation).toBe("Put");
    await db.User.batchWrite({ deletes: [{ userId: "usr_bundle_local" as never }] });
    await db.UserSummary.batchWrite({ deletes: [{ userId: "usr_bundle_local" as never }] });
  });

  it("supports map/list/set attributes with nested update operations", async () => {
    const doc = DynamoDBDocumentClient.from(rawClient);
    const db = connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User },
    });
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
    await db.User.delete({ userId: "usr_complex_local" as never });
  });
});
