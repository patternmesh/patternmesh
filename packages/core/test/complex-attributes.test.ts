import { describe, expect, it } from "vitest";
import {
  connect,
  defineTable,
  entity,
  id,
  key,
  list,
  number,
  numberSet,
  object,
  pathRef,
  record,
  string,
  stringSet,
  ValidationError,
} from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const T = defineTable({ name: "complex", partitionKey: "pk", sortKey: "sk" });
type ProfileKeyInput = { profileId: string };

const Profile = entity("Profile", {
  profileId: id("pro").required(),
  settings: object({
    theme: string().required(),
    locale: string().optional(),
  }).required(),
  tags: list(string()).optional(),
  attrs: record(string()).optional(),
  labels: stringSet().optional(),
  scores: numberSet().optional(),
  version: number().version().required().default(0),
})
  .inTable(T)
  .keys(({ profileId }: ProfileKeyInput) => ({ pk: key("PROFILE", profileId), sk: key("ROOT") }))
  .identity(["profileId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ profileId }: ProfileKeyInput) => ({
      pk: key("PROFILE", profileId),
      sk: key("ROOT"),
    })),
  }));

describe("complex attributes", () => {
  it("validates object/list/record/set fields on create", async () => {
    const db = connect(T, { adapter: createMemoryAdapter(), entities: { Profile } });
    await db.Profile.create({
      profileId: "pro_1" as never,
      settings: { theme: "dark", locale: "en-US" } as never,
      tags: ["a", "b"] as never,
      attrs: { k1: "v1" } as never,
      labels: new Set(["alpha", "beta"]) as never,
      scores: new Set([1, 2]) as never,
    });
    const row = await db.Profile.get({ profileId: "pro_1" as never });
    expect(row).toMatchObject({
      settings: { theme: "dark", locale: "en-US" },
    });
  });

  it("rejects empty sets", async () => {
    const db = connect(T, { adapter: createMemoryAdapter(), entities: { Profile } });
    await expect(
      db.Profile.create({
        profileId: "pro_2" as never,
        settings: { theme: "dark" } as never,
        labels: new Set() as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("compiles nested update/list/set operations and nested conditions", () => {
    const db = connect(T, { adapter: createMemoryAdapter(), entities: { Profile } });
    const op = db.Profile.update({ profileId: "pro_3" as never })
      .setPath("settings.theme", "light")
      .listAppend("tags", ["c"])
      .listPrepend("tags", ["z"])
      .setAdd("labels", new Set(["gamma"]))
      .setDelete("labels", new Set(["alpha"]))
      .removePath(["settings.locale"])
      .if((f, o) =>
        o.and(
          o.contains(pathRef(f.tags!, 0), "z"),
          o.beginsWith(pathRef(f.settings!, "theme"), "li"),
        ),
      )
      .explain();
    expect(op.updateExpression).toContain("list_append");
    expect(op.updateExpression).toContain("DELETE");
    expect(op.conditionExpression).toContain("contains(");
    expect(op.conditionExpression).toContain("begins_with(");
  });
});
