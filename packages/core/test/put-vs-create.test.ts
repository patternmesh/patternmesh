import { describe, expect, it } from "vitest";
import {
  ItemAlreadyExistsError,
  connect,
  defineTable,
  entity,
  id,
  key,
  string,
} from "../src/index.js";
import { createMemoryAdapter } from "./mock-adapter.js";

const T = defineTable({ name: "put_create", partitionKey: "pk", sortKey: "sk" });

const User = entity("User", {
  userId: id("usr").required(),
  email: string().required(),
})
  .inTable(T)
  .keys(({ userId }: { userId: string }) => ({ pk: key("USER", userId), sk: key("ROOT") }))
  .identity(["userId"])
  .accessPatterns((ap) => ({
    byId: ap.get(({ userId }: { userId: string }) => ({ pk: key("USER", userId), sk: key("ROOT") })),
  }));

describe("repository put vs create", () => {
  it("create rejects collisions while put overwrites", async () => {
    const db = connect(T, { adapter: createMemoryAdapter(), entities: { User } });

    await db.User.create({ userId: "usr_1" as never, email: "first@example.com" });
    await expect(
      db.User.create({ userId: "usr_1" as never, email: "second@example.com" }),
    ).rejects.toBeInstanceOf(ItemAlreadyExistsError);

    await db.User.put({ userId: "usr_1" as never, email: "second@example.com" });

    await expect(db.User.get({ userId: "usr_1" as never })).resolves.toMatchObject({
      userId: "usr_1",
      email: "second@example.com",
    });
  });
});
