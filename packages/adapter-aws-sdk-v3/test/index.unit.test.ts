import { describe, expect, it, vi } from "vitest";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
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

  it("normalizes query and scan missing Items to empty arrays", async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    const q = await adapter.query({
      tableName: "app",
      keyConditionExpression: "#pk = :pk",
      expressionAttributeNames: { "#pk": "pk" },
      expressionAttributeValues: { ":pk": "A" },
    });
    const s = await adapter.scan({ tableName: "app" });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(ScanCommand);
    expect(q.items).toEqual([]);
    expect(s.items).toEqual([]);
  });

  it("returns null when update has no Attributes", async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    const out = await adapter.updateItem({
      tableName: "app",
      key: { pk: "A", sk: "B" },
      updateExpression: "SET #n = :n",
      expressionAttributeNames: { "#n": "name" },
      expressionAttributeValues: { ":n": "Ada" },
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(UpdateCommand);
    expect(out).toBeNull();
  });

  it("normalizes batchGet missing Responses and UnprocessedKeys", async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    const out = await adapter.batchGetItem({
      tableName: "app",
      keys: [{ pk: "A", sk: "B" }],
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(BatchGetCommand);
    expect(out.items).toEqual([]);
    expect(out.unprocessedKeys).toBeUndefined();
  });

  it("maps transactGet responses positionally with hit/miss", async () => {
    const send = vi.fn(async () => ({
      Responses: [{ Item: { pk: "A", sk: "1" } }, {}],
    }));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    const out = await adapter.transactGetItems({
      items: [
        { tableName: "app", key: { pk: "A", sk: "1" } },
        { tableName: "app", key: { pk: "A", sk: "2" } },
      ],
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(TransactGetCommand);
    expect(out.responses).toEqual([{ pk: "A", sk: "1" }, null]);
  });

  it("omits ReturnValues when not provided for put/delete", async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
    const adapter = createAwsSdkV3Adapter(docClient);

    await adapter.putItem({ tableName: "app", item: { pk: "A", sk: "B" } });
    await adapter.deleteItem({ tableName: "app", key: { pk: "A", sk: "B" } });

    const putCmd = send.mock.calls[0]?.[0] as PutCommand;
    const delCmd = send.mock.calls[1]?.[0] as DeleteCommand;
    expect(putCmd).toBeInstanceOf(PutCommand);
    expect(delCmd).toBeInstanceOf(DeleteCommand);
    expect(putCmd.input.ReturnValues).toBeUndefined();
    expect(delCmd.input.ReturnValues).toBeUndefined();
  });
});
