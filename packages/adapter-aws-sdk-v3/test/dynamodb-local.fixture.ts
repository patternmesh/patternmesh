import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
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
} from "@patternmeshjs/core";
import { createAwsSdkV3Adapter } from "../src/index.js";

export const endpoint = process.env.DYNAMODB_ENDPOINT?.trim();
export const hasLocal = Boolean(endpoint);

function testRunId(): string {
  return (
    process.env.GITHUB_RUN_ID ?? process.env.VITEST_POOL_ID ?? process.env.CI_JOB_ID ?? "local"
  );
}

export function integrationTableName(suite: string): string {
  return `dynamodb_it_${suite}_${testRunId()}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

async function waitUntilTableActive(client: DynamoDBClient, tableName: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const out = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (out.Table?.TableStatus === "ACTIVE") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Table ${tableName} did not become ACTIVE in time`);
}

export function createLocalHarness(suite: string) {
  const tableName = integrationTableName(suite);
  const rawClient = new DynamoDBClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
    },
  });

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

  async function setupTable(): Promise<void> {
    try {
      await rawClient.send(new DeleteTableCommand({ TableName: tableName }));
    } catch {
      // ignore if table does not already exist
    }
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
  }

  async function cleanupTable(): Promise<void> {
    try {
      await rawClient.send(new DeleteTableCommand({ TableName: tableName }));
    } catch {
      // best-effort cleanup
    }
    rawClient.destroy();
  }

  function createDb() {
    const doc = DynamoDBDocumentClient.from(rawClient);
    return connect(AppTable, {
      adapter: createAwsSdkV3Adapter(doc),
      entities: { User, UserSummary },
    });
  }

  return {
    tableName,
    rawClient,
    AppTable,
    User,
    UserSummary,
    setupTable,
    cleanupTable,
    createDb,
  };
}
