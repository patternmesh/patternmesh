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
  name: "rel_app",
  partitionKey: "pk",
  sortKey: "sk",
  indexes: {
    GSI1: { partitionKey: "gsi1pk", sortKey: "gsi1sk", type: "GSI" },
  },
});

type OrgKeyInput = { orgId: string };
type UserKeyInput = { userId: string };
type MembershipKeyInput = { orgId: string; userId: string };
type FolderKeyInput = { folderId: string };
type FolderParentInput = { parentId?: string | null };
type FolderParentPageInput = { parentId?: string | null; cursor?: string; limit?: number };
type MembershipItem = { orgId: string; userId: string; role: "owner" | "admin" | "member" };

function asRelation<T>(value: unknown): T {
  return value as T;
}

const Org = entity("Org", {
  orgId: id("org").required(),
  name: string().required(),
})
  .inTable(AppTable)
  .keys(({ orgId }: OrgKeyInput) => ({ pk: key("ORG", orgId), sk: key("ROOT") }))
  .identity(["orgId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ orgId }: OrgKeyInput) => ({ pk: key("ORG", orgId), sk: key("ROOT") })),
  }));

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
})
  .inTable(AppTable)
  .keys(({ userId }: UserKeyInput) => ({ pk: key("USER", userId), sk: key("ROOT") }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }: UserKeyInput) => ({ pk: key("USER", userId), sk: key("ROOT") })),
  }));

const Membership = entity("Membership", {
  orgId: id("org").required(),
  userId: id("usr").required(),
  role: enumType(["owner", "admin", "member"] as const).required(),
})
  .inTable(AppTable)
  .keys(({ orgId, userId }: MembershipKeyInput) => ({
    pk: key("ORG", orgId),
    sk: key("MEMBER", userId),
  }))
  .index("GSI1", ({ userId }: UserKeyInput) => ({
    gsi1pk: key("USER", userId),
    gsi1sk: key("ORG"),
  }))
  .identity(["orgId", "userId"])
  .accessPatterns((ap) => ({
    byOrg: ap.query(undefined, ({ orgId }: OrgKeyInput) => ({
      pk: key("ORG", orgId),
      skBeginsWith: key("MEMBER"),
    })),
    byOrgAdmins: ap.query(undefined, ({ orgId }: OrgKeyInput) => ({
      pk: key("ORG", orgId),
      skBeginsWith: key("MEMBER"),
      filterExpression: "#r = :admin",
      filterExpressionAttributeNames: { "#r": "role" },
      filterExpressionAttributeValues: { ":admin": "admin" },
    })),
    byUser: ap.query("GSI1", ({ userId }: UserKeyInput) => ({
      pk: key("USER", userId),
      skBeginsWith: key("ORG"),
    })),
  }));

const Folder = entity("Folder", {
  folderId: id("fld").required(),
  parentId: id("fld").optional(),
  name: string().required(),
})
  .inTable(AppTable)
  .keys(({ folderId }: FolderKeyInput) => ({ pk: key("FOLDER", folderId), sk: key("ROOT") }))
  .index("GSI1", ({ parentId }: FolderParentInput) => ({
    gsi1pk: key("PARENT", String(parentId ?? "ROOT")),
    gsi1sk: key("FOLDER"),
  }))
  .identity(["folderId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ folderId }: FolderKeyInput) => ({
      pk: key("FOLDER", folderId),
      sk: key("ROOT"),
    })),
    byParent: ap.query("GSI1", ({ parentId, cursor, limit }: FolderParentPageInput) => ({
      pk: key("PARENT", String(parentId ?? "ROOT")),
      skBeginsWith: key("FOLDER"),
      cursor,
      limit,
    })),
  }));

const OrgSummary = entity("OrgSummary", {
  orgId: id("org").required(),
  memberCount: string().required(),
})
  .inTable(AppTable)
  .keys(({ orgId }: OrgKeyInput) => ({ pk: key("ORG", orgId), sk: key("SUMMARY") }))
  .identity(["orgId"])
  .accessPatterns((ap) => ({
    byOrg: ap.get(({ orgId }: OrgKeyInput) => ({ pk: key("ORG", orgId), sk: key("SUMMARY") })),
  }));

describe("relations DSL and namespaces", () => {
  it("creates hasMany and hasManyThrough helpers", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, {
      adapter,
      entities: { Org, User, Membership, Folder },
      relations: (r) =>
        r
          .hasMany("Org", "members", {
            target: "Membership",
            listPattern: "byOrg",
            mapCreate: ({ orgId, userId, role }) => ({ orgId, userId, role }),
          })
          .hasMany("Org", "admins", {
            target: "Membership",
            listPattern: "byOrgAdmins",
          })
          .hasManyThrough("User", "orgs", {
            through: "Membership",
            target: "Org",
            listPattern: "byUser",
            mapTargetKey: (m: MembershipItem) => ({ orgId: m.orgId as never }),
            mapAdd: ({ orgId, userId, role }) => ({ orgId, userId, role }),
          })
          .belongsTo("Membership", "org", {
            target: "Org",
            mapGet: ({ orgId }) => ({ orgId }),
          })
          .hasMany("Folder", "children", {
            target: "Folder",
            listPattern: "byParent",
          })
          .belongsTo("Folder", "parent", {
            target: "Folder",
            mapGet: ({ parentId }) => ({ folderId: parentId }),
          }),
    });

    await db.Org.create({ orgId: "org_1" as never, name: "Acme" });
    await db.User.create({ userId: "usr_1" as never, email: "u1@example.com" });

    await asRelation<{ members: { add: (input: Record<string, unknown>) => Promise<unknown> } }>(
      db.Org,
    ).members.add({
      orgId: "org_1" as never,
      userId: "usr_1" as never,
      role: "admin",
    });
    const orgMembers = await asRelation<{
      members: { list: (input: Record<string, unknown>) => Promise<{ items: unknown[] }> };
    }>(db.Org).members.list({ orgId: "org_1" as never });
    expect(orgMembers.items.length).toBe(1);
    const userOrgs = await asRelation<{
      orgs: {
        listTargets: (input: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
      };
    }>(db.User).orgs.listTargets({ userId: "usr_1" as never });
    expect(userOrgs[0]).toMatchObject({ orgId: "org_1", name: "Acme" });
    const admins = await asRelation<{
      admins: { list: (input: Record<string, unknown>) => Promise<{ items: unknown[] }> };
    }>(db.Org).admins.list({ orgId: "org_1" as never });
    expect(admins.items.length).toBe(1);

    const m = (await db.Membership.find.byOrg({ orgId: "org_1" as never })) as { items: unknown[] };
    const parent = await (
      db.Membership as unknown as {
        org: { get: (input: Record<string, unknown>) => Promise<unknown> };
      }
    ).org.get(m.items[0]! as Record<string, unknown>);
    expect(parent).toMatchObject({ orgId: "org_1" });

    await db.Folder.create({ folderId: "fld_root" as never, name: "root" });
    await db.Folder.create({
      folderId: "fld_child_1" as never,
      parentId: "fld_root" as never,
      name: "c1",
    });
    await db.Folder.create({
      folderId: "fld_child_2" as never,
      parentId: "fld_root" as never,
      name: "c2",
    });
    const childrenPage1 = await (
      db.Folder as unknown as {
        children: {
          list: (input: Record<string, unknown>) => Promise<{ items: unknown[]; cursor?: string }>;
        };
      }
    ).children.list({ parentId: "fld_root" as never, limit: 1 });
    expect(childrenPage1.items.length).toBe(1);
    const childrenPage2 = await (
      db.Folder as unknown as {
        children: { list: (input: Record<string, unknown>) => Promise<{ items: unknown[] }> };
      }
    ).children.list({ parentId: "fld_root" as never, cursor: childrenPage1.cursor });
    expect(childrenPage2.items.length).toBeGreaterThanOrEqual(1);
    const parentFolder = await (
      db.Folder as unknown as {
        parent: { get: (input: Record<string, unknown>) => Promise<unknown> };
      }
    ).parent.get({ parentId: "fld_root" as never });
    expect(parentFolder).toMatchObject({ folderId: "fld_root" });
  });

  it("supports labeled batchGet orchestration", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { Org, User, Membership, Folder } });
    await db.Org.create({ orgId: "org_2" as never, name: "Beta" });
    await db.User.create({ userId: "usr_2" as never, email: "u2@example.com" });
    const bag = await db.batchGet?.({
      org: { entity: "Org", key: { orgId: "org_2" as never } },
      user: { entity: "User", key: { userId: "usr_2" as never } },
    });
    expect(bag?.org).toMatchObject({ orgId: "org_2" });
    expect(bag?.user).toMatchObject({ userId: "usr_2" });
  });

  it("supports labeled tx orchestration write bundle", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, { adapter, entities: { Org, User, Membership, Folder } });
    const labels = await db.orchestrate?.write(async (o) => {
      o.put("createOrg", Org, { orgId: "org_3" as never, name: "Gamma" });
      o.put("createUser", User, { userId: "usr_3" as never, email: "u3@example.com" });
      o.put("join", Membership, {
        orgId: "org_3" as never,
        userId: "usr_3" as never,
        role: "owner",
      });
    });
    expect(labels?.createOrg?.operation).toBe("Put");
    expect(await db.Org.get({ orgId: "org_3" as never })).toMatchObject({ name: "Gamma" });
  });

  it("supports explicit fan-out orchestration for materialized views", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, {
      adapter,
      entities: { Org, User, Membership, Folder, OrgSummary },
    });
    const labels = await db.orchestrate?.fanOut(
      {
        primary: async (o) => {
          o.put("createOrg", Org, { orgId: "org_4" as never, name: "Delta" });
          o.put("joinOwner", Membership, {
            orgId: "org_4" as never,
            userId: "usr_4" as never,
            role: "owner",
          });
        },
        fanOut: async (o) => {
          o.put("summaryUpsert", OrgSummary, { orgId: "org_4" as never, memberCount: "1" });
        },
      },
      { clientRequestToken: "fanout-org-4" },
    );
    expect(labels?.primary.createOrg?.operation).toBe("Put");
    expect(labels?.fanOut.summaryUpsert?.operation).toBe("Put");
    expect(await db.OrgSummary.get({ orgId: "org_4" as never })).toMatchObject({
      memberCount: "1",
    });
  });

  it("supports declared read bundles with deterministic labels", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, {
      adapter,
      entities: { Org, User, Membership, Folder },
      relations: (r) =>
        r.hasMany("Org", "members", {
          target: "Membership",
          listPattern: "byOrg",
          mapCreate: ({ orgId, userId, role }) => ({ orgId, userId, role }),
        }),
      readBundles: (b) =>
        b.bundle(
          "orgProfile",
          (steps) =>
            steps
              .rootGet("org", "Org", (input) => ({ orgId: input.orgId }))
              .relation("members", "Org", "members", "list", (input) => ({ orgId: input.orgId })),
          { maxDepth: 1 },
        ),
    });
    await db.Org.create({ orgId: "org_6" as never, name: "Six" });
    await db.Membership.create({
      orgId: "org_6" as never,
      userId: "usr_6" as never,
      role: "member",
    });
    const out = await db.read?.run("orgProfile", { orgId: "org_6" as never });
    expect(out?.org).toMatchObject({ orgId: "org_6" });
    expect(Array.isArray(out?.members)).toBe(true);
    const explained = db.read?.explain("orgProfile", { orgId: "org_6" as never });
    expect(explained?.steps.length).toBe(2);
  });

  it("enforces read bundle safety rails and duplicate labels", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, {
      adapter,
      entities: { Org, User, Membership, Folder },
      readBundles: (b) =>
        b.bundle(
          "tooDeep",
          (steps) => steps.rootGet("org", "Org", (input) => ({ orgId: input.orgId })),
          { maxDepth: 2 },
        ),
    });
    await expect(db.read?.run("tooDeep", { orgId: "org_1" as never })).rejects.toThrow(
      ValidationError,
    );
    expect(() =>
      connect(AppTable, {
        adapter,
        entities: { Org, User, Membership, Folder },
        readBundles: (b) =>
          b.bundle("dup", (steps) =>
            steps
              .rootGet("same", "Org", (input) => ({ orgId: input.orgId }))
              .rootPattern("same", "Membership", "byOrg", (input) => ({ orgId: input.orgId })),
          ),
      }),
    ).toThrow(ValidationError);
  });

  it("supports declared write recipes and explain", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, {
      adapter,
      entities: { Org, User, Membership, Folder, OrgSummary },
      writeRecipes: (w) =>
        w.recipe("createOrgWithSummary", (s) =>
          s
            .put("createOrg", "Org", (input) => ({ orgId: input.orgId, name: input.name }))
            .put("summary", "OrgSummary", (input) => ({ orgId: input.orgId, memberCount: "0" })),
        ),
    });
    const labels = await db.recipes?.run("createOrgWithSummary", {
      orgId: "org_7" as never,
      name: "Seven",
    });
    expect(labels?.createOrg.operation).toBe("Put");
    expect(await db.Org.get({ orgId: "org_7" as never })).toMatchObject({ name: "Seven" });
    expect(db.recipes?.explain("createOrgWithSummary").steps.length).toBe(2);
  });

  it("supports counterSummary template and summary labels", async () => {
    const adapter = createMemoryAdapter();
    const db = connect(AppTable, {
      adapter,
      entities: { Org, User, Membership, Folder, OrgSummary },
    });
    const labels = await db.orchestrate?.counterSummary({
      primary: async (o) => {
        o.put("org", Org, { orgId: "org_8" as never, name: "Eight" });
      },
      summary: async (o) => {
        o.put("sum", OrgSummary, { orgId: "org_8" as never, memberCount: "1" });
      },
    });
    expect(labels?.primary.org.operation).toBe("Put");
    expect(labels?.summary.sum.operation).toBe("Put");
  });

  it("throws on relation alias collision", () => {
    const adapter = createMemoryAdapter();
    expect(() =>
      connect(AppTable, {
        adapter,
        entities: { Org, User, Membership, Folder },
        relations: (r) =>
          r
            .hasMany("Org", "members", { target: "Membership", listPattern: "byOrg" })
            .hasMany("Org", "members", { target: "Membership", listPattern: "byOrg" }),
      }),
    ).toThrow(ValidationError);
  });
});
