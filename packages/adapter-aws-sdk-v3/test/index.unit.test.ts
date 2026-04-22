import { describe, expect, it, vi } from "vitest";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createAwsSdkV3Adapter } from "../src/index.js";

describe("aws-sdk-v3 adapter transact write serialization", () => {
  it("omits empty expression attribute maps in transact write items", async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    await adapter.transactWriteItems({
      items: [
        {
          kind: "ConditionCheck",
          tableName: "app",
          key: { pk: "A", sk: "B" },
          conditionExpression: "attribute_exists(#e)",
          expressionAttributeNames: { "#e": "email" },
          expressionAttributeValues: {},
        },
        {
          kind: "Update",
          tableName: "app",
          key: { pk: "A", sk: "B" },
          updateExpression: "SET #n = :n",
          expressionAttributeNames: { "#n": "name" },
          expressionAttributeValues: { ":n": "Ada" },
          conditionExpression: "attribute_exists(#e)",
        },
      ],
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]?.[0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    const input = (cmd as TransactWriteCommand).input;
    const cc = input.TransactItems?.[0]?.ConditionCheck;
    const upd = input.TransactItems?.[1]?.Update;
    expect(cc?.ExpressionAttributeNames).toEqual({ "#e": "email" });
    expect(cc?.ExpressionAttributeValues).toBeUndefined();
    expect(upd?.ExpressionAttributeValues).toEqual({ ":n": "Ada" });
  });

  it("rejects empty batch writes", async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    await expect(adapter.batchWriteItem({ puts: [], deletes: [] })).rejects.toThrow(
      /requires at least one put or delete/i,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
