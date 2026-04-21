import type { PutItemOutput, QuerySelectMode, ReturnConsumedCapacityMode } from "./types.js";
export interface ConsumedCapacity {
  readonly tableName?: string;
  readonly capacityUnits?: number;
  readonly table?: { readonly capacityUnits?: number };
  readonly localSecondaryIndexes?: Record<string, { readonly capacityUnits?: number }>;
  readonly globalSecondaryIndexes?: Record<string, { readonly capacityUnits?: number }>;
}

export interface GetItemInput {
  readonly tableName: string;
  readonly key: Record<string, unknown>;
  readonly consistentRead?: boolean;
  readonly projectionExpression?: string;
  readonly expressionAttributeNames?: Record<string, string>;
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface PutItemInput {
  readonly tableName: string;
  readonly item: Record<string, unknown>;
  readonly conditionExpression?: string;
  readonly expressionAttributeNames?: Record<string, string>;
  readonly expressionAttributeValues?: Record<string, unknown>;
  /** PutItem only supports `NONE` and `ALL_OLD` on DynamoDB; omit for `NONE`. */
  readonly returnValues?: "NONE" | "ALL_OLD";
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface DeleteItemInput {
  readonly tableName: string;
  readonly key: Record<string, unknown>;
  readonly conditionExpression?: string;
  readonly expressionAttributeNames?: Record<string, string>;
  readonly expressionAttributeValues?: Record<string, unknown>;
  readonly returnValues?: "NONE" | "ALL_OLD";
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface DeleteItemOutput {
  readonly attributes?: Record<string, unknown>;
  readonly consumedCapacity?: ConsumedCapacity;
}

export interface QueryInput {
  readonly tableName: string;
  readonly indexName?: string;
  readonly keyConditionExpression: string;
  readonly expressionAttributeNames: Record<string, string>;
  readonly expressionAttributeValues: Record<string, unknown>;
  readonly limit?: number;
  readonly scanIndexForward?: boolean;
  readonly exclusiveStartKey?: Record<string, unknown>;
  readonly filterExpression?: string;
  readonly projectionExpression?: string;
  readonly consistentRead?: boolean;
  readonly select?: QuerySelectMode;
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface QueryOutput {
  readonly items: readonly Record<string, unknown>[];
  readonly lastEvaluatedKey?: Record<string, unknown>;
  /** Present when `Select` was `COUNT`. */
  readonly count?: number;
  readonly consumedCapacity?: ConsumedCapacity;
}

export interface ScanInput {
  readonly tableName: string;
  readonly indexName?: string;
  readonly segment?: number;
  readonly totalSegments?: number;
  readonly limit?: number;
  readonly exclusiveStartKey?: Record<string, unknown>;
  readonly filterExpression?: string;
  readonly projectionExpression?: string;
  readonly expressionAttributeNames: Record<string, string>;
  readonly expressionAttributeValues: Record<string, unknown>;
  readonly consistentRead?: boolean;
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface ScanOutput {
  readonly items: readonly Record<string, unknown>[];
  readonly lastEvaluatedKey?: Record<string, unknown>;
  readonly consumedCapacity?: ConsumedCapacity;
}

export interface UpdateItemInput {
  readonly tableName: string;
  readonly key: Record<string, unknown>;
  readonly updateExpression: string;
  readonly expressionAttributeNames: Record<string, string>;
  readonly expressionAttributeValues: Record<string, unknown>;
  readonly conditionExpression?: string;
  readonly returnValues?: "ALL_NEW" | "NONE" | "ALL_OLD" | "UPDATED_OLD" | "UPDATED_NEW";
  readonly returnValuesOnConditionCheckFailure?: "ALL_OLD" | "NONE";
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

/** Single-table batch get (one `RequestItems` entry). */
export interface BatchGetItemInput {
  readonly tableName: string;
  readonly keys: readonly Record<string, unknown>[];
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface BatchGetItemOutput {
  readonly items: readonly Record<string, unknown>[];
  readonly unprocessedKeys?: readonly Record<string, unknown>[];
  readonly consumedCapacity?: readonly ConsumedCapacity[];
}

export interface BatchWritePut {
  readonly tableName: string;
  readonly item: Record<string, unknown>;
  readonly conditionExpression?: string;
  readonly expressionAttributeNames?: Record<string, string>;
  readonly expressionAttributeValues?: Record<string, unknown>;
}

export interface BatchWriteDelete {
  readonly tableName: string;
  readonly key: Record<string, unknown>;
}

export interface BatchWriteItemInput {
  readonly puts: readonly BatchWritePut[];
  readonly deletes: readonly BatchWriteDelete[];
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface BatchWriteItemOutput {
  readonly unprocessedPuts?: readonly BatchWritePut[];
  readonly unprocessedDeletes?: readonly BatchWriteDelete[];
  readonly consumedCapacity?: readonly ConsumedCapacity[];
}

/** One slot for TransactGetItems (single-table framework still passes tableName per slot). */
export interface TransactGetSlot {
  readonly tableName: string;
  readonly key: Record<string, unknown>;
  readonly consistentRead?: boolean;
  readonly projectionExpression?: string;
  readonly expressionAttributeNames?: Record<string, string>;
}

export interface TransactGetItemsInput {
  readonly items: readonly TransactGetSlot[];
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface TransactGetItemsOutput {
  /** Same order as `input.items`; `null` when the key had no item. */
  readonly responses: readonly (Record<string, unknown> | null)[];
  readonly consumedCapacity?: readonly ConsumedCapacity[];
}

export type TransactWriteItemInput =
  | {
      readonly kind: "Put";
      readonly tableName: string;
      readonly item: Record<string, unknown>;
      readonly conditionExpression?: string;
      readonly expressionAttributeNames?: Record<string, string>;
      readonly expressionAttributeValues?: Record<string, unknown>;
    }
  | {
      readonly kind: "Update";
      readonly tableName: string;
      readonly key: Record<string, unknown>;
      readonly updateExpression: string;
      readonly expressionAttributeNames: Record<string, string>;
      readonly expressionAttributeValues: Record<string, unknown>;
      readonly conditionExpression?: string;
    }
  | {
      readonly kind: "Delete";
      readonly tableName: string;
      readonly key: Record<string, unknown>;
      readonly conditionExpression?: string;
      readonly expressionAttributeNames?: Record<string, string>;
      readonly expressionAttributeValues?: Record<string, unknown>;
    }
  | {
      readonly kind: "ConditionCheck";
      readonly tableName: string;
      readonly key: Record<string, unknown>;
      readonly conditionExpression: string;
      readonly expressionAttributeNames: Record<string, string>;
      readonly expressionAttributeValues: Record<string, unknown>;
    };

export interface TransactWriteItemsInput {
  readonly items: readonly TransactWriteItemInput[];
  /** TransactWriteItems only; idempotent retry window is 10 minutes per AWS. */
  readonly clientRequestToken?: string;
  readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
}

export interface DynamoAdapter {
  getItem(input: GetItemInput): Promise<Record<string, unknown> | null>;
  putItem(input: PutItemInput): Promise<PutItemOutput>;
  deleteItem(input: DeleteItemInput): Promise<DeleteItemOutput>;
  query(input: QueryInput): Promise<QueryOutput>;
  scan(input: ScanInput): Promise<ScanOutput>;
  updateItem(input: UpdateItemInput): Promise<Record<string, unknown> | null>;
  batchGetItem(input: BatchGetItemInput): Promise<BatchGetItemOutput>;
  batchWriteItem(input: BatchWriteItemInput): Promise<BatchWriteItemOutput>;
  transactGetItems(input: TransactGetItemsInput): Promise<TransactGetItemsOutput>;
  transactWriteItems(input: TransactWriteItemsInput): Promise<void>;
}

export { type PutItemOutput } from "./types.js";
