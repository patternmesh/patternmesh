import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  BatchGetItemInput,
  BatchGetItemOutput,
  BatchWriteItemInput,
  BatchWriteItemOutput,
  DeleteItemInput,
  DynamoAdapter,
  GetItemInput,
  PutItemInput,
  PutItemOutput,
  QueryInput,
  QueryOutput,
  ScanInput,
  ScanOutput,
  TransactGetItemsInput,
  TransactGetItemsOutput,
  TransactWriteItemsInput,
  UpdateItemInput,
} from "@patternmeshjs/core";

function nonEmptyRecord<T extends Record<string, unknown> | undefined>(value: T): T | undefined {
  if (!value) return undefined;
  return Object.keys(value).length > 0 ? value : undefined;
}

export function createAwsSdkV3Adapter(docClient: DynamoDBDocumentClient): DynamoAdapter {
  return {
    async getItem(input: GetItemInput): Promise<Record<string, unknown> | null> {
      const out = await docClient.send(
        new GetCommand({
          TableName: input.tableName,
          Key: input.key,
          ConsistentRead: input.consistentRead,
          ProjectionExpression: input.projectionExpression,
          ExpressionAttributeNames: input.expressionAttributeNames,
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      return (out.Item as Record<string, unknown>) ?? null;
    },

    async putItem(input: PutItemInput): Promise<PutItemOutput> {
      const out = await docClient.send(
        new PutCommand({
          TableName: input.tableName,
          Item: input.item,
          ConditionExpression: input.conditionExpression,
          ExpressionAttributeNames: input.expressionAttributeNames,
          ExpressionAttributeValues: input.expressionAttributeValues,
          ...(input.returnValues != null ? { ReturnValues: input.returnValues } : {}),
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      return { attributes: out.Attributes as Record<string, unknown> | undefined };
    },

    async deleteItem(input: DeleteItemInput) {
      const out = await docClient.send(
        new DeleteCommand({
          TableName: input.tableName,
          Key: input.key,
          ConditionExpression: input.conditionExpression,
          ExpressionAttributeNames: input.expressionAttributeNames,
          ExpressionAttributeValues: input.expressionAttributeValues,
          ...(input.returnValues != null ? { ReturnValues: input.returnValues } : {}),
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      return {
        attributes: out.Attributes as Record<string, unknown> | undefined,
        consumedCapacity: out.ConsumedCapacity as
          | import("@patternmeshjs/core").ConsumedCapacity
          | undefined,
      };
    },

    async query(input: QueryInput): Promise<QueryOutput> {
      const out = await docClient.send(
        new QueryCommand({
          TableName: input.tableName,
          IndexName: input.indexName,
          KeyConditionExpression: input.keyConditionExpression,
          ExpressionAttributeNames: input.expressionAttributeNames,
          ExpressionAttributeValues: input.expressionAttributeValues,
          Limit: input.limit,
          ScanIndexForward: input.scanIndexForward,
          ExclusiveStartKey: input.exclusiveStartKey,
          FilterExpression: input.filterExpression,
          ProjectionExpression: input.projectionExpression,
          ConsistentRead: input.consistentRead,
          Select: input.select,
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      return {
        items: (out.Items ?? []) as Record<string, unknown>[],
        lastEvaluatedKey: out.LastEvaluatedKey as Record<string, unknown> | undefined,
        count: out.Count,
        consumedCapacity: out.ConsumedCapacity as
          | import("@patternmeshjs/core").ConsumedCapacity
          | undefined,
      };
    },

    async scan(input: ScanInput): Promise<ScanOutput> {
      const out = await docClient.send(
        new ScanCommand({
          TableName: input.tableName,
          IndexName: input.indexName,
          Segment: input.segment,
          TotalSegments: input.totalSegments,
          Limit: input.limit,
          ExclusiveStartKey: input.exclusiveStartKey,
          FilterExpression: input.filterExpression,
          ProjectionExpression: input.projectionExpression,
          ExpressionAttributeNames: input.expressionAttributeNames,
          ExpressionAttributeValues: input.expressionAttributeValues,
          ConsistentRead: input.consistentRead,
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      return {
        items: (out.Items ?? []) as Record<string, unknown>[],
        lastEvaluatedKey: out.LastEvaluatedKey as Record<string, unknown> | undefined,
        consumedCapacity: out.ConsumedCapacity as
          | import("@patternmeshjs/core").ConsumedCapacity
          | undefined,
      };
    },

    async updateItem(input: UpdateItemInput): Promise<Record<string, unknown> | null> {
      const out = await docClient.send(
        new UpdateCommand({
          TableName: input.tableName,
          Key: input.key,
          UpdateExpression: input.updateExpression,
          ExpressionAttributeNames: input.expressionAttributeNames,
          ExpressionAttributeValues: input.expressionAttributeValues,
          ConditionExpression: input.conditionExpression,
          ReturnValues: input.returnValues,
          ...(input.returnValuesOnConditionCheckFailure != null
            ? { ReturnValuesOnConditionCheckFailure: input.returnValuesOnConditionCheckFailure }
            : {}),
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      return (out.Attributes as Record<string, unknown>) ?? null;
    },

    async batchGetItem(input: BatchGetItemInput): Promise<BatchGetItemOutput> {
      const out = await docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [input.tableName]: {
              Keys: [...input.keys] as Record<string, unknown>[],
            },
          },
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      const items = (out.Responses?.[input.tableName] ?? []) as Record<string, unknown>[];
      const unprocessed = out.UnprocessedKeys?.[input.tableName]?.Keys as
        | Record<string, unknown>[]
        | undefined;
      return {
        items,
        unprocessedKeys: unprocessed,
        consumedCapacity: out.ConsumedCapacity as
          | import("@patternmeshjs/core").ConsumedCapacity[]
          | undefined,
      };
    },

    async batchWriteItem(input: BatchWriteItemInput): Promise<BatchWriteItemOutput> {
      const tableName = input.puts[0]?.tableName ?? input.deletes[0]?.tableName;
      if (!tableName) {
        throw new Error("batchWriteItem requires at least one put or delete request");
      }
      const requests: Record<string, unknown>[] = [];
      for (const p of input.puts) {
        requests.push({
          PutRequest: {
            Item: p.item,
            ...(p.conditionExpression != null
              ? {
                  ConditionExpression: p.conditionExpression,
                  ExpressionAttributeNames: p.expressionAttributeNames,
                  ExpressionAttributeValues: p.expressionAttributeValues,
                }
              : {}),
          },
        });
      }
      for (const d of input.deletes) {
        requests.push({
          DeleteRequest: {
            Key: d.key,
          },
        });
      }
      const out = await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: requests,
          },
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      const rawUn = out.UnprocessedItems?.[tableName] as
        | {
            PutRequest?: { Item?: Record<string, unknown> };
            DeleteRequest?: { Key?: Record<string, unknown> };
          }[]
        | undefined;
      const unprocessedPuts: import("@patternmeshjs/core").BatchWritePut[] = [];
      const unprocessedDeletes: import("@patternmeshjs/core").BatchWriteDelete[] = [];
      for (const u of rawUn ?? []) {
        if (u.PutRequest?.Item) {
          unprocessedPuts.push({ tableName, item: u.PutRequest.Item });
        }
        if (u.DeleteRequest?.Key) {
          unprocessedDeletes.push({ tableName, key: u.DeleteRequest.Key });
        }
      }
      return {
        unprocessedPuts,
        unprocessedDeletes,
        consumedCapacity: out.ConsumedCapacity as
          | import("@patternmeshjs/core").ConsumedCapacity[]
          | undefined,
      };
    },

    async transactGetItems(input: TransactGetItemsInput): Promise<TransactGetItemsOutput> {
      const out = await docClient.send(
        new TransactGetCommand({
          TransactItems: input.items.map((it) => ({
            Get: {
              TableName: it.tableName,
              Key: it.key,
              ConsistentRead: it.consistentRead,
              ProjectionExpression: it.projectionExpression,
              ExpressionAttributeNames: it.expressionAttributeNames,
            },
          })),
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
      type ItemResp = { Item?: Record<string, unknown> };
      const raw = out as { Responses?: readonly ItemResp[] };
      const responses = (raw.Responses ?? []).map((r) => r.Item ?? null);
      return {
        responses,
        consumedCapacity: (
          out as { ConsumedCapacity?: import("@patternmeshjs/core").ConsumedCapacity[] }
        ).ConsumedCapacity,
      };
    },

    async transactWriteItems(input: TransactWriteItemsInput): Promise<void> {
      const TransactItems = input.items.map((it) => {
        if (it.kind === "Put") {
          return {
            Put: {
              TableName: it.tableName,
              Item: it.item,
              ConditionExpression: it.conditionExpression,
              ExpressionAttributeNames: nonEmptyRecord(it.expressionAttributeNames),
              ExpressionAttributeValues: nonEmptyRecord(it.expressionAttributeValues),
            },
          };
        }
        if (it.kind === "Update") {
          return {
            Update: {
              TableName: it.tableName,
              Key: it.key,
              UpdateExpression: it.updateExpression,
              ExpressionAttributeNames: nonEmptyRecord(it.expressionAttributeNames),
              ExpressionAttributeValues: nonEmptyRecord(it.expressionAttributeValues),
              ConditionExpression: it.conditionExpression,
            },
          };
        }
        if (it.kind === "Delete") {
          return {
            Delete: {
              TableName: it.tableName,
              Key: it.key,
              ConditionExpression: it.conditionExpression,
              ExpressionAttributeNames: nonEmptyRecord(it.expressionAttributeNames),
              ExpressionAttributeValues: nonEmptyRecord(it.expressionAttributeValues),
            },
          };
        }
        return {
          ConditionCheck: {
            TableName: it.tableName,
            Key: it.key,
            ConditionExpression: it.conditionExpression,
            ExpressionAttributeNames: nonEmptyRecord(it.expressionAttributeNames),
            ExpressionAttributeValues: nonEmptyRecord(it.expressionAttributeValues),
          },
        };
      });
      await docClient.send(
        new TransactWriteCommand({
          TransactItems,
          ClientRequestToken: input.clientRequestToken,
          ReturnConsumedCapacity: input.returnConsumedCapacity,
        }),
      );
    },
  };
}

export type { DynamoAdapter } from "@patternmeshjs/core";
