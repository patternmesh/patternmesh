import { describe, expect, it } from "vitest";
import { connect, defineTable, entity, id, key, string, ttl } from "../src/index.js";
import { ValidationError } from "../src/errors.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
});

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
  expiresAt: ttl().optional(),
  deletedAt: ttl().optional(),
  status: string().optional(),
})
  .inTable(AppTable)
  .keys(({ userId }) => ({
    pk: key("USER", userId),
    sk: key("PROFILE"),
  }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }) => ({ pk: key("USER", userId), sk: key("PROFILE") })),
  }));

const UserArchive = entity("UserArchive", {
  archiveId: id("arc").required(),
  userId: id("usr").required(),
  email: string().required(),
})
  .inTable(AppTable)
  .keys(({ archiveId }) => ({
    pk: key("ARCHIVE", archiveId),
    sk: key("USER"),
  }))
  .identity(["archiveId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ archiveId }) => ({ pk: key("ARCHIVE", archiveId), sk: key("USER") })),
  }));

describe("v0.8 ttl + lifecycle", () => {
  it("validates ttl as non-negative epoch seconds", async () => {
    const db = connect(AppTable, { adapter: createMemoryAdapter(), entities: { User } });
    await expect(
      db.User.create({
        userId: "usr_1" as never,
        email: "a@example.com",
        expiresAt: -1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("supports lifecycle soft-delete template", async () => {
    const db = connect(AppTable, { adapter: createMemoryAdapter(), entities: { User } });
    await db.User.create({ userId: "usr_2" as never, email: "b@example.com" });
    await db.lifecycle?.softDelete({
      entity: User,
      key: { userId: "usr_2" as never },
      deletedAtEpochSeconds: 1735689600,
      tombstone: { status: "deleted" },
    });
    const row = await db.User.get({ userId: "usr_2" as never });
    expect(row).toMatchObject({ deletedAt: 1735689600, status: "deleted" });
  });

  it("supports archive recipe with source delete", async () => {
    const db = connect(AppTable, { adapter: createMemoryAdapter(), entities: { User, UserArchive } });
    await db.User.create({ userId: "usr_3" as never, email: "c@example.com" });
    await db.lifecycle?.archive({
      sourceEntity: User,
      sourceKey: { userId: "usr_3" as never },
      archiveEntity: UserArchive,
      archiveItem: { archiveId: "arc_1" as never, userId: "usr_3" as never, email: "c@example.com" },
      sourceDisposition: "delete",
    });
    expect(await db.User.get({ userId: "usr_3" as never })).toBeNull();
    expect(await db.UserArchive.get({ archiveId: "arc_1" as never })).toMatchObject({ userId: "usr_3" });
  });
});
