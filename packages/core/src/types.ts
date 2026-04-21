export interface IndexDef {
  partitionKey: string;
  sortKey?: string;
  /** Defaults to "GSI" for backward compatibility. */
  type?: "GSI";
}

export interface LocalIndexDef {
  /** LSI must share partition key with base table. */
  partitionKey: string;
  sortKey: string;
  projectionType?: "ALL" | "KEYS_ONLY" | "INCLUDE";
  nonKeyAttributes?: readonly string[];
  type?: "LSI";
}

export interface TableDef {
  readonly name: string;
  readonly partitionKey: string;
  readonly sortKey?: string;
  readonly indexes?: Readonly<Record<string, IndexDef>>;
  readonly localIndexes?: Readonly<Record<string, LocalIndexDef>>;
}

export type AccessPatternKind = "get" | "query" | "unique" | "count" | "scan";

export type QuerySelectMode = "ALL_ATTRIBUTES" | "ALL_PROJECTED_ATTRIBUTES" | "COUNT";
export type ReturnConsumedCapacityMode = "INDEXES" | "TOTAL" | "NONE";

export type DynamoReadPlan =
  | {
      readonly type: "GetItem";
      readonly key: Record<string, unknown>;
      readonly consistentRead?: boolean;
      readonly projectionExpression?: string;
      readonly expressionAttributeNames?: Record<string, string>;
    }
  | {
      readonly type: "Query";
      readonly indexName?: string;
      readonly indexType?: "GSI" | "LSI";
      readonly keyConditionExpression: string;
      readonly expressionAttributeNames: Record<string, string>;
      readonly expressionAttributeValues: Record<string, unknown>;
      readonly limit?: number;
      readonly scanIndexForward?: boolean;
      readonly filterExpression?: string;
      readonly projectionExpression?: string;
      readonly exclusiveStartKey?: Record<string, unknown>;
      /** Base table only; invalid with `indexName` — validated in repository. */
      readonly consistentRead?: boolean;
      readonly select?: QuerySelectMode;
      /** True when the access pattern supplied a user `filterExpression` (low-level Dynamo path). */
      readonly userAuthorFilter?: boolean;
      readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
    }
  | {
      readonly type: "Scan";
      readonly indexName?: string;
      readonly indexType?: "GSI" | "LSI";
      readonly segment?: number;
      readonly totalSegments?: number;
      readonly limit?: number;
      readonly exclusiveStartKey?: Record<string, unknown>;
      readonly filterExpression?: string;
      readonly projectionExpression?: string;
      readonly expressionAttributeNames: Record<string, string>;
      readonly expressionAttributeValues: Record<string, unknown>;
      readonly consistentRead?: boolean;
      readonly userAuthorFilter?: boolean;
      readonly returnConsumedCapacity?: ReturnConsumedCapacityMode;
    };

export interface AccessPatternDef<Input = unknown> {
  readonly name: string;
  readonly kind: AccessPatternKind;
  readonly indexName?: string;
  readonly buildRequest: (input: Input) => DynamoReadPlan;
}

export type FieldScalarKind =
  | "string"
  | "number"
  | "boolean"
  | "datetime"
  | "enum"
  | "id"
  | "json"
  | "ttl"
  | "object"
  | "record"
  | "list"
  | "stringSet"
  | "numberSet";

export interface FieldMeta {
  readonly attrName: string;
  readonly kind: FieldScalarKind;
  readonly required: boolean;
  readonly isIdentity: boolean;
  readonly immutable: boolean;
  readonly hasDefault: boolean;
  readonly defaultFactory?: () => unknown;
  readonly isVersion: boolean;
  readonly isDerived: boolean;
  readonly isInternalLogical: boolean;
  readonly allowAdd: boolean;
  readonly allowRemove: boolean;
  readonly enumValues?: readonly string[];
  readonly idPrefix?: string;
}

export interface CompiledOperation {
  readonly entity: string;
  readonly operation:
    | "GetItem"
    | "PutItem"
    | "DeleteItem"
    | "Query"
    | "UpdateItem"
    | "BatchGetItem"
    | "BatchWriteItem"
    | "ConditionCheck"
    | "Scan";
  readonly tableName: string;
  readonly indexName?: string;
  readonly key?: Record<string, unknown>;
  readonly keyConditionExpression?: string;
  readonly filterExpression?: string;
  readonly projectionExpression?: string;
  readonly updateExpression?: string;
  readonly conditionExpression?: string;
  readonly expressionAttributeNames: Record<string, string>;
  readonly expressionAttributeValues: Record<string, unknown>;
  readonly projectedLogicalFields?: readonly string[];
  readonly warnings: readonly string[];
  readonly consistentRead?: boolean;
  readonly select?: QuerySelectMode;
  /** For explain.batchGet / explain.batchWrite only */
  readonly batchKeys?: readonly Record<string, unknown>[];
  readonly batchPutItems?: readonly Record<string, unknown>[];
  readonly batchDeleteKeys?: readonly Record<string, unknown>[];
}

/** One chunk of a batch operation for `explain.batchGet` / `explain.batchWrite`. */
export interface BatchChunkPlan {
  readonly operation: "BatchGetItem" | "BatchWriteItem";
  readonly tableName: string;
  readonly keys?: readonly Record<string, unknown>[];
  readonly putItems?: readonly Record<string, unknown>[];
  readonly deleteKeys?: readonly Record<string, unknown>[];
}

export type OpaqueCursor = string & { readonly __cursorBrand: unique symbol };

export interface Page<T> {
  readonly items: readonly T[];
  readonly cursor?: OpaqueCursor;
}

export interface PutItemOutput {
  readonly attributes?: Record<string, unknown>;
}
