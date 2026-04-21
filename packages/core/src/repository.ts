import type { DynamoAdapter } from "./adapter.js";
import type { BatchWriteDelete, BatchWritePut } from "./adapter.js";
import type { AccessPatternDef, BatchChunkPlan, CompiledOperation, Page } from "./types.js";
import { encodeCursor } from "./cursor.js";
import {
  BatchGetExhaustedError,
  BatchWriteExhaustedError,
  ConditionFailedError,
  ItemAlreadyExistsError,
  NotUniqueError,
  QueryLimitError,
  ValidationError,
} from "./errors.js";
import { isConditionalCheckFailed } from "./aws-error.js";
import { validateAndApplyDefaults } from "./validation.js";
import { buildPrimaryKeyMap, logicalToStored, storedToLogicalPublic, DISCRIMINATOR_ATTR } from "./entity-runtime.js";
import type { EntityRuntime } from "./entity-runtime.js";
import { explainDeleteItem, explainGetItem, emptyCompiled } from "./explain-helpers.js";
import { createUpdateBuilder, createConditionShape } from "./update.js";
import { BATCH_GET_MAX_KEYS, BATCH_WRITE_MAX_OPS, chunkArray, sleep } from "./batch.js";

const DEFAULT_BATCH_ATTEMPTS = 6;
const DEFAULT_COUNT_MAX_PAGES = 1000;

function mapStoredToItem(runtime: EntityRuntime, stored: Record<string, unknown>): Record<string, unknown> {
  return storedToLogicalPublic(stored, runtime.table, new Set(Object.keys(runtime.schema)));
}

function stableKeyJson(key: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(key).sort()) sorted[k] = key[k];
  return JSON.stringify(sorted);
}

export type CreateReturnMode = "item" | "none" | "old";
export type DeleteReturnMode = "none" | "old";

/**
 * Per-entity repository: CRUD, named `find.*` access patterns, `batchGet` / `batchWrite`,
 * and `explain.*` (including chunked `explain.batchGet` / `explain.batchWrite` plans only).
 *
 * Batch contracts: {@link BATCH_GET_MAX_KEYS}, {@link BATCH_WRITE_MAX_OPS}; ordered `batchGet` with `null` misses;
 * `batchWrite` resolves to `void` or throws {@link BatchWriteExhaustedError}. GSI + `consistentRead` is rejected with
 * {@link ValidationError} at the repository layer before DynamoDB.
 */
export function createRepository(runtime: EntityRuntime, adapter: DynamoAdapter) {
  const tableName = runtime.table.name;

  async function put(
    input: Record<string, unknown>,
    options?: { return?: CreateReturnMode },
  ): Promise<Record<string, unknown> | undefined> {
    const mode = options?.return ?? "item";
    const prepared = validateAndApplyDefaults(input, runtime.schema, runtime.fieldMeta);
    const item = logicalToStored(prepared, runtime);
    try {
      const out = await adapter.putItem({
        tableName,
        item,
        ...(mode === "old" ? { returnValues: "ALL_OLD" as const } : mode === "none" ? { returnValues: "NONE" as const } : {}),
      });
      if (mode === "none") return undefined;
      if (mode === "old") {
        if (!out.attributes) return undefined;
        return mapStoredToItem(runtime, out.attributes);
      }
      const attrs = out.attributes ?? item;
      return mapStoredToItem(runtime, attrs);
    } catch (e) {
      if (isConditionalCheckFailed(e)) throw new ConditionFailedError("Conditional check failed on create", e);
      throw e;
    }
  }

  async function create(
    input: Record<string, unknown>,
    options?: { return?: CreateReturnMode },
  ): Promise<Record<string, unknown> | undefined> {
    const mode = options?.return ?? "item";
    const prepared = validateAndApplyDefaults(input, runtime.schema, runtime.fieldMeta);
    const item = logicalToStored(prepared, runtime);
    try {
      const out = await adapter.putItem({
        tableName,
        item,
        conditionExpression: "attribute_not_exists(#pk)",
        expressionAttributeNames: { "#pk": runtime.table.partitionKey },
        ...(mode === "old" ? { returnValues: "ALL_OLD" as const } : mode === "none" ? { returnValues: "NONE" as const } : {}),
      });
      if (mode === "none") return undefined;
      if (mode === "old") {
        if (!out.attributes) return undefined;
        return mapStoredToItem(runtime, out.attributes);
      }
      const attrs = out.attributes ?? item;
      return mapStoredToItem(runtime, attrs);
    } catch (e) {
      if (isConditionalCheckFailed(e)) {
        throw new ItemAlreadyExistsError(`Item already exists for entity "${runtime.entityName}"`, runtime.entityName, e);
      }
      throw e;
    }
  }

  async function get(input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const key = buildPrimaryKeyMap(runtime, input);
    const raw = await adapter.getItem({ tableName, key });
    if (!raw) return null;
    if (raw[DISCRIMINATOR_ATTR] !== runtime.discriminatorValue) return null;
    return mapStoredToItem(runtime, raw);
  }

  async function del(
    input: Record<string, unknown>,
    options?: { return?: DeleteReturnMode },
  ): Promise<Record<string, unknown> | undefined> {
    const key = buildPrimaryKeyMap(runtime, input);
    const mode = options?.return ?? "none";
    try {
      const out = await adapter.deleteItem({
        tableName,
        key,
        ...(mode === "old" ? { returnValues: "ALL_OLD" as const } : {}),
      });
      if (mode === "old" && out.attributes) {
        return mapStoredToItem(runtime, out.attributes);
      }
      return undefined;
    } catch (e) {
      if (isConditionalCheckFailed(e)) throw new ConditionFailedError("Conditional check failed on delete", e);
      throw e;
    }
  }

  function assertQueryConsistentRead(plan: import("./types.js").DynamoReadPlan): void {
    if (plan.type !== "Query" && plan.type !== "Scan") return;
    if (plan.consistentRead && plan.indexType === "GSI") {
      throw new ValidationError([
        {
          path: "consistentRead",
          message: "ConsistentRead is valid for base table and LSI, but not for GSI",
        },
      ]);
    }
  }

  async function runCountQuery(
    plan: Extract<import("./types.js").DynamoReadPlan, { type: "Query" }>,
  ): Promise<number | { count: number; consumedCapacity?: { capacityUnits?: number } }> {
    let total = 0;
    let totalCapacity = 0;
    let exclusiveStartKey = plan.exclusiveStartKey;
    let pageCount = 0;
    while (true) {
      pageCount += 1;
      if (pageCount > DEFAULT_COUNT_MAX_PAGES) {
        throw new QueryLimitError(`Count query exceeded maxPages (${DEFAULT_COUNT_MAX_PAGES})`);
      }
      const out = await adapter.query({
        tableName,
        indexName: plan.indexName,
        keyConditionExpression: plan.keyConditionExpression,
        expressionAttributeNames: plan.expressionAttributeNames,
        expressionAttributeValues: plan.expressionAttributeValues,
        limit: plan.limit,
        scanIndexForward: plan.scanIndexForward,
        exclusiveStartKey,
        filterExpression: plan.filterExpression,
        projectionExpression: plan.projectionExpression,
        consistentRead: plan.consistentRead,
        select: "COUNT",
        returnConsumedCapacity: plan.returnConsumedCapacity,
      });
      total += out.count ?? 0;
      totalCapacity += out.consumedCapacity?.capacityUnits ?? 0;
      exclusiveStartKey = out.lastEvaluatedKey;
      if (!exclusiveStartKey) break;
    }
    if (plan.returnConsumedCapacity) return { count: total, consumedCapacity: { capacityUnits: totalCapacity } };
    return total;
  }

  async function runPattern(pattern: AccessPatternDef, input: Record<string, unknown>): Promise<unknown> {
    const plan = pattern.buildRequest(input);
    if (plan.type === "GetItem") {
      const raw = await adapter.getItem({
        tableName,
        key: plan.key,
        consistentRead: plan.consistentRead,
        projectionExpression: plan.projectionExpression,
        expressionAttributeNames: plan.expressionAttributeNames,
      });
      if (!raw) return null;
      if (raw[DISCRIMINATOR_ATTR] !== runtime.discriminatorValue) return null;
      return mapStoredToItem(runtime, raw);
    }
    if (plan.type === "Query") {
      assertQueryConsistentRead(plan);
      if (plan.select === "COUNT" && pattern.kind !== "count") {
        throw new ValidationError([
          {
            path: "select",
            message: 'Use ap.count(...) for COUNT; do not pass select: "COUNT" to ap.query',
          },
        ]);
      }
      if (pattern.kind === "count") {
        return runCountQuery(plan);
      }
      const out = await adapter.query({
        tableName,
        indexName: plan.indexName,
        keyConditionExpression: plan.keyConditionExpression,
        expressionAttributeNames: plan.expressionAttributeNames,
        expressionAttributeValues: plan.expressionAttributeValues,
        limit: plan.limit,
        scanIndexForward: plan.scanIndexForward,
        exclusiveStartKey: plan.exclusiveStartKey,
        filterExpression: plan.filterExpression,
        projectionExpression: plan.projectionExpression,
        consistentRead: plan.consistentRead,
        select: plan.select,
        returnConsumedCapacity: plan.returnConsumedCapacity,
      });
      const items = out.items
        .filter((it) => it[DISCRIMINATOR_ATTR] === runtime.discriminatorValue)
        .map((it) => mapStoredToItem(runtime, it));
      if (pattern.kind === "unique") {
        if (items.length === 0) return null;
        if (items.length > 1) throw new NotUniqueError(pattern.name);
        if (plan.returnConsumedCapacity) {
          return { item: items[0] ?? null, consumedCapacity: out.consumedCapacity };
        }
        return items[0] ?? null;
      }
      const cursor = out.lastEvaluatedKey ? encodeCursor(out.lastEvaluatedKey) : undefined;
      if (plan.returnConsumedCapacity) {
        return { items, cursor, consumedCapacity: out.consumedCapacity };
      }
      return { items, cursor } satisfies Page<Record<string, unknown>>;
    }
    if (plan.type === "Scan") {
      assertQueryConsistentRead(plan);
      const out = await adapter.scan({
        tableName,
        indexName: plan.indexName,
        segment: plan.segment,
        totalSegments: plan.totalSegments,
        limit: plan.limit,
        exclusiveStartKey: plan.exclusiveStartKey,
        filterExpression: plan.filterExpression,
        projectionExpression: plan.projectionExpression,
        expressionAttributeNames: plan.expressionAttributeNames,
        expressionAttributeValues: plan.expressionAttributeValues,
        consistentRead: plan.consistentRead,
        returnConsumedCapacity: plan.returnConsumedCapacity,
      });
      const items = out.items
        .filter((it) => it[DISCRIMINATOR_ATTR] === runtime.discriminatorValue)
        .map((it) => mapStoredToItem(runtime, it));
      const cursor = out.lastEvaluatedKey ? encodeCursor(out.lastEvaluatedKey) : undefined;
      if (plan.returnConsumedCapacity) {
        return { items, cursor, consumedCapacity: out.consumedCapacity };
      }
      return { items, cursor } satisfies Page<Record<string, unknown>>;
    }
    throw new Error(`Unsupported plan type`);
  }

  function queryWarnings(plan: import("./types.js").DynamoReadPlan): string[] {
    if (plan.type !== "Query" && plan.type !== "Scan") return [];
    const w: string[] = [];
    if (plan.type === "Query" && plan.userAuthorFilter) {
      w.push(
        "Non-key FilterExpression may consume read capacity on items that do not match the filter (low-level Dynamo path).",
      );
    }
    if (plan.type === "Scan") {
      w.push("Scan applies FilterExpression after items are read.");
      w.push("FilterExpression does not reduce read cost for scanned items.");
      if (plan.segment !== undefined || plan.totalSegments !== undefined) {
        w.push("Parallel scan can increase throughput consumption.");
      }
    }
    return w;
  }

  function explainPattern(pattern: AccessPatternDef, input: Record<string, unknown>): CompiledOperation {
    const plan = pattern.buildRequest(input);
    if (plan.type === "GetItem") {
      return {
        ...emptyCompiled(runtime.entityName, "GetItem", tableName),
        key: plan.key,
        consistentRead: plan.consistentRead,
        projectionExpression: plan.projectionExpression,
        expressionAttributeNames: plan.expressionAttributeNames ?? {},
        expressionAttributeValues: {},
        warnings: [],
      };
    }
    if (plan.type === "Query") {
      return {
        ...emptyCompiled(runtime.entityName, "Query", tableName),
        indexName: plan.indexName,
        keyConditionExpression: plan.keyConditionExpression,
        filterExpression: plan.filterExpression,
        projectionExpression: plan.projectionExpression,
        expressionAttributeNames: plan.expressionAttributeNames,
        expressionAttributeValues: plan.expressionAttributeValues,
        consistentRead: plan.consistentRead,
        select: plan.select,
        warnings: queryWarnings(plan),
      };
    }
    if (plan.type === "Scan") {
      return {
        ...emptyCompiled(runtime.entityName, "Scan", tableName),
        indexName: plan.indexName,
        filterExpression: plan.filterExpression,
        projectionExpression: plan.projectionExpression,
        expressionAttributeNames: plan.expressionAttributeNames,
        expressionAttributeValues: plan.expressionAttributeValues,
        consistentRead: plan.consistentRead,
        warnings: queryWarnings(plan),
      };
    }
    return emptyCompiled(runtime.entityName, "Query", tableName);
  }

  const find: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {};
  const explainFind: Record<string, (input: Record<string, unknown>) => CompiledOperation> = {};
  for (const p of runtime.accessPatterns) {
    find[p.name] = (input: Record<string, unknown>) => runPattern(p, input);
    explainFind[p.name] = (input: Record<string, unknown>) => explainPattern(p, input);
  }

  function explainCreate(input: Record<string, unknown>): CompiledOperation {
    const prepared = validateAndApplyDefaults({ ...input }, runtime.schema, runtime.fieldMeta);
    void logicalToStored(prepared, runtime);
    return {
      ...emptyCompiled(runtime.entityName, "PutItem", tableName),
      key: buildPrimaryKeyMap(runtime, prepared),
      expressionAttributeNames: {},
      expressionAttributeValues: {},
      warnings: [],
    };
  }

  async function batchGet(keys: readonly Record<string, unknown>[]): Promise<(Record<string, unknown> | null)[]> {
    if (keys.length === 0) return [];
    const preparedKeys = keys.map((k) => buildPrimaryKeyMap(runtime, k));
    const slots: (Record<string, unknown> | null)[] = new Array(keys.length).fill(null);
    const keyToIndexes = new Map<string, number[]>();

    preparedKeys.forEach((key, index) => {
      const fingerprint = stableKeyJson(key);
      const existing = keyToIndexes.get(fingerprint);
      if (existing) {
        existing.push(index);
      } else {
        keyToIndexes.set(fingerprint, [index]);
      }
    });

    const fillFromItems = (items: readonly Record<string, unknown>[]) => {
      for (const raw of items) {
        if (raw[DISCRIMINATOR_ATTR] !== runtime.discriminatorValue) continue;
        const itemKey: Record<string, unknown> = {};
        itemKey[runtime.table.partitionKey] = raw[runtime.table.partitionKey]!;
        if (runtime.table.sortKey) {
          itemKey[runtime.table.sortKey] = raw[runtime.table.sortKey]!;
        }
        const matchIndexes = keyToIndexes.get(stableKeyJson(itemKey));
        if (!matchIndexes) continue;
        const mapped = mapStoredToItem(runtime, raw);
        for (const idx of matchIndexes) {
          slots[idx] = mapped;
        }
      }
    };

    const chunks = chunkArray(preparedKeys.map((k, i) => ({ k, i })), BATCH_GET_MAX_KEYS);
    for (const metaChunk of chunks) {
      let pending = metaChunk;
      for (let attempt = 0; attempt < DEFAULT_BATCH_ATTEMPTS; attempt++) {
        const keyObjs = pending.map((x) => x.k);
        const { items, unprocessedKeys } = await adapter.batchGetItem({ tableName, keys: keyObjs });
        fillFromItems(items);
        if (!unprocessedKeys?.length) {
          pending = [];
          break;
        }
        const unprocSet = new Set(unprocessedKeys.map((uk) => stableKeyJson(uk)));
        pending = pending.filter((x) => unprocSet.has(stableKeyJson(x.k)));
        if (pending.length === 0) break;
        await sleep(Math.min(500, 50 * 2 ** attempt));
      }
      if (pending.length > 0) throw new BatchGetExhaustedError();
    }
    return slots;
  }

  type BatchOp =
    | { readonly kind: "put"; readonly item: Record<string, unknown> }
    | { readonly kind: "delete"; readonly key: Record<string, unknown> };

  async function batchWrite(req: { puts?: readonly Record<string, unknown>[]; deletes?: readonly Record<string, unknown>[] }): Promise<void> {
    const ops: BatchOp[] = [];
    for (const p of req.puts ?? []) {
      const prepared = validateAndApplyDefaults({ ...p }, runtime.schema, runtime.fieldMeta);
      ops.push({ kind: "put", item: logicalToStored(prepared, runtime) });
    }
    for (const d of req.deletes ?? []) {
      ops.push({ kind: "delete", key: buildPrimaryKeyMap(runtime, d) });
    }
    if (ops.length === 0) return;

    const chunks = chunkArray(ops, BATCH_WRITE_MAX_OPS);
    for (const chunk of chunks) {
      let pending: BatchOp[] = [...chunk];
      for (let attempt = 0; attempt < DEFAULT_BATCH_ATTEMPTS; attempt++) {
        const puts: BatchWritePut[] = pending
          .filter((o): o is Extract<BatchOp, { kind: "put" }> => o.kind === "put")
          .map((o) => ({ tableName, item: o.item }));
        const deletes: BatchWriteDelete[] = pending
          .filter((o): o is Extract<BatchOp, { kind: "delete" }> => o.kind === "delete")
          .map((o) => ({ tableName, key: o.key }));
        const out = await adapter.batchWriteItem({ puts, deletes });
        const next: BatchOp[] = [];
        for (const u of out.unprocessedPuts ?? []) {
          next.push({ kind: "put", item: u.item });
        }
        for (const u of out.unprocessedDeletes ?? []) {
          next.push({ kind: "delete", key: u.key });
        }
        pending = next;
        if (pending.length === 0) break;
        await sleep(Math.min(500, 50 * 2 ** attempt));
      }
      if (pending.length > 0) throw new BatchWriteExhaustedError();
    }
  }

  function explainBatchGet(keys: readonly Record<string, unknown>[]): BatchChunkPlan[] {
    const prepared = keys.map((k) => buildPrimaryKeyMap(runtime, k));
    return chunkArray(prepared, BATCH_GET_MAX_KEYS).map((chunk) => ({
      operation: "BatchGetItem" as const,
      tableName,
      keys: chunk,
    }));
  }

  function explainBatchWrite(req: { puts?: readonly Record<string, unknown>[]; deletes?: readonly Record<string, unknown>[] }): BatchChunkPlan[] {
    const ops: BatchOp[] = [];
    for (const p of req.puts ?? []) {
      const prepared = validateAndApplyDefaults({ ...p }, runtime.schema, runtime.fieldMeta);
      ops.push({ kind: "put", item: logicalToStored(prepared, runtime) });
    }
    for (const d of req.deletes ?? []) {
      ops.push({ kind: "delete", key: buildPrimaryKeyMap(runtime, d) });
    }
    return chunkArray(ops, BATCH_WRITE_MAX_OPS).map((chunk) => {
      const putItems = chunk.filter((o): o is Extract<BatchOp, { kind: "put" }> => o.kind === "put").map((o) => o.item);
      const deleteKeys = chunk
        .filter((o): o is Extract<BatchOp, { kind: "delete" }> => o.kind === "delete")
        .map((o) => o.key);
      return {
        operation: "BatchWriteItem" as const,
        tableName,
        putItems,
        deleteKeys,
      };
    });
  }

  return {
    put,
    create,
    get,
    delete: del,
    find,
    batchGet,
    batchWrite,
    explain: {
      put: explainCreate,
      create: explainCreate,
      get: (input: Record<string, unknown>) => explainGetItem(runtime, input),
      delete: (input: Record<string, unknown>) => explainDeleteItem(runtime, input),
      find: explainFind,
      batchGet: explainBatchGet,
      batchWrite: explainBatchWrite,
    },
    update(input: Record<string, unknown>) {
      return createUpdateBuilder(runtime, adapter, input, createConditionShape(runtime.fieldMeta));
    },
  };
}

export type RepositoryApi = ReturnType<typeof createRepository>;
