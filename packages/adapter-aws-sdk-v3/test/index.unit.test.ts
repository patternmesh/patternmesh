import { describe, expect, it, vi } from "vitest";
import { BatchWriteCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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

  it("forwards transact client request token and omits empty delete maps", async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    await adapter.transactWriteItems({
      clientRequestToken: "idem-token",
      items: [
        {
          kind: "Delete",
          tableName: "app",
          key: { pk: "A", sk: "B" },
          conditionExpression: "attribute_exists(#e)",
          expressionAttributeNames: { "#e": "email" },
          expressionAttributeValues: {},
        },
      ],
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]?.[0] as TransactWriteCommand;
    expect(cmd.input.ClientRequestToken).toBe("idem-token");
    expect(cmd.input.TransactItems?.[0]?.Delete?.ExpressionAttributeValues).toBeUndefined();
  });

  it("passes ReturnValuesOnConditionCheckFailure for updates", async () => {
    const send = vi.fn(async () => ({ Attributes: { pk: "A", sk: "B" } }));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    await adapter.updateItem({
      tableName: "app",
      key: { pk: "A", sk: "B" },
      updateExpression: "SET #n = :v",
      expressionAttributeNames: { "#n": "name" },
      expressionAttributeValues: { ":v": "Ada" },
      returnValues: "ALL_NEW",
      returnValuesOnConditionCheckFailure: "ALL_OLD",
    });

    const cmd = send.mock.calls[0]?.[0] as UpdateCommand;
    expect(cmd).toBeInstanceOf(UpdateCommand);
    expect(cmd.input.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
  });

  it("maps unprocessed batch write puts and deletes", async () => {
    const send = vi.fn(async () => ({
      UnprocessedItems: {
        app: [
          { PutRequest: { Item: { pk: "P", sk: "S" } } },
          { DeleteRequest: { Key: { pk: "D", sk: "K" } } },
        ],
      },
    }));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    const out = await adapter.batchWriteItem({
      puts: [
        {
          tableName: "app",
          item: { pk: "P", sk: "S" },
          conditionExpression: "attribute_not_exists(#pk)",
          expressionAttributeNames: { "#pk": "pk" },
          expressionAttributeValues: { ":pk": "P" },
        },
      ],
      deletes: [{ tableName: "app", key: { pk: "D", sk: "K" } }],
    });

    const cmd = send.mock.calls[0]?.[0] as BatchWriteCommand;
    expect(cmd).toBeInstanceOf(BatchWriteCommand);
    expect(cmd.input.RequestItems?.app?.[0]?.PutRequest?.ConditionExpression).toBe(
      "attribute_not_exists(#pk)",
    );
    expect(out.unprocessedPuts).toEqual([{ tableName: "app", item: { pk: "P", sk: "S" } }]);
    expect(out.unprocessedDeletes).toEqual([{ tableName: "app", key: { pk: "D", sk: "K" } }]);
  });
});
