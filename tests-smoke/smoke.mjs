import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
}

function packPackage(packageDir, outDir) {
  const before = new Set(readdirSync(outDir));
  run("pnpm", ["pack", "--pack-destination", outDir], packageDir);
  const created = readdirSync(outDir).filter((name) => name.endsWith(".tgz") && !before.has(name));
  return path.join(outDir, created[0]);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "patternmesh-smoke-"));
const tarballsDir = path.join(tempRoot, "tarballs");
const appDir = path.join(tempRoot, "app");

mkdirSync(tarballsDir, { recursive: true });
mkdirSync(appDir, { recursive: true });

const coreTgz = packPackage(path.join(repoRoot, "packages/core"), tarballsDir);
const adapterTgz = packPackage(path.join(repoRoot, "packages/adapter-aws-sdk-v3"), tarballsDir);
const streamsTgz = packPackage(path.join(repoRoot, "packages/streams"), tarballsDir);

writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    {
      name: "patternmesh-smoke-app",
      private: true,
      type: "module",
      pnpm: {
        overrides: {
          "@patternmeshjs/core": coreTgz,
        },
      },
    },
    null,
    2,
  ),
);

run(
  "pnpm",
  ["add", coreTgz, adapterTgz, streamsTgz, "@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"],
  appDir,
);

writeFileSync(
  path.join(appDir, "index.mjs"),
  `
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createAwsSdkV3Adapter } from "@patternmeshjs/aws-sdk-v3";
import { connect, defineTable, entity, enumType, id, key, number, string } from "@patternmeshjs/core";
import { decodeStreamRecord } from "@patternmeshjs/streams";

const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
  indexes: {
    GSI1: { partitionKey: "gsi1pk", sortKey: "gsi1sk", type: "GSI" },
  },
});

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
  name: string().required(),
  status: enumType(["active", "suspended"]).required(),
  version: number().version().required().default(0),
})
  .inTable(AppTable)
  .keys(({ userId }) => ({ pk: key("USER", userId), sk: key("ROOT") }))
  .index("GSI1", ({ email }) => ({ gsi1pk: key("EMAIL", email), gsi1sk: key("USER") }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }) => ({ pk: key("USER", userId), sk: key("ROOT") })),
  }));

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const adapter = createAwsSdkV3Adapter(doc);
const db = connect(AppTable, { adapter, entities: { User } });

if (typeof db.User.create !== "function" || typeof db.User.put !== "function") {
  throw new Error("repository surface missing create/put");
}

const decoded = decodeStreamRecord(
  {
    eventName: "MODIFY",
    dynamodb: {
      StreamViewType: "NEW_AND_OLD_IMAGES",
      NewImage: { entity: { S: "User" }, userId: { S: "usr_1" } },
      OldImage: { entity: { S: "User" }, userId: { S: "usr_1" } }
    }
  },
  { decoders: { User: (item) => item } }
);

if (decoded.entityName !== "User") {
  throw new Error("stream decode failed");
}

console.log("smoke ok");
`,
);

try {
  run("node", ["index.mjs"], appDir);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
