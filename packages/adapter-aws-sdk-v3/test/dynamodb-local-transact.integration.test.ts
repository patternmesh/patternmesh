import { IdempotentParameterMismatchError, TransactionCanceledError } from "@patternmeshjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalHarness, hasLocal } from "./dynamodb-local.fixture.js";

describe.skipIf(!hasLocal)("DynamoDB Local transactions", () => {
  const harness = createLocalHarness("tx");

  beforeAll(async () => {
    await harness.setupTable();
  });

  afterAll(async () => {
    await harness.cleanupTable();
  });

  it("tx.write is atomic; tx.read returns labeled items", async () => {
    const db = harness.createDb();
    await db.tx.write(async (w) => {
      w.put(harness.User, {
        userId: "usr_tx_1" as never,
        email: "tx1@example.com",
        name: "Tx",
      });
    });
    const plans = db.explain.tx.write((w) => {
      w.put(harness.User, {
        userId: "usr_tx_2" as never,
        email: "tx2@example.com",
        name: "Second",
      });
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.operation).toBe("PutItem");
    await db.tx.write(async (w) => {
      w.put(harness.User, {
        userId: "usr_tx_2" as never,
        email: "tx2@example.com",
        name: "Second",
      });
    });

    const read = await db.tx.read(async (r) => {
      r.get("u1", harness.User, { userId: "usr_tx_1" as never });
      r.get("u2", harness.User, { userId: "usr_tx_2" as never });
    });
    expect(read.u1).toMatchObject({ email: "tx1@example.com" });
    expect(read.u2).toMatchObject({ email: "tx2@example.com" });
  });

  it("tx.write maps failed transaction to TransactionCanceledError with ordered reasons", async () => {
    const db = harness.createDb();
    await db.User.create({
      userId: "usr_tx_fail" as never,
      email: "txfail@example.com",
    });
    await expect(
      db.tx.write(async (w) => {
        w.update(harness.User, { userId: "usr_tx_fail" as never })
          .set({ name: "nope" })
          .if((f, o) => o.eq(f.status, "disabled"));
      }),
    ).rejects.toBeInstanceOf(TransactionCanceledError);
  });

  it("reuses ClientRequestToken with different parameters -> IdempotentParameterMismatchError", async () => {
    const db = harness.createDb();
    const token = `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await db.tx.write(
      async (w) => {
        w.put(harness.User, {
          userId: "usr_idem_a" as never,
          email: "idema@example.com",
        });
      },
      { clientRequestToken: token },
    );
    await expect(
      db.tx.write(
        async (w) => {
          w.put(harness.User, {
            userId: "usr_idem_b" as never,
            email: "idemb@example.com",
          });
        },
        { clientRequestToken: token },
      ),
    ).rejects.toBeInstanceOf(IdempotentParameterMismatchError);
  });
});
