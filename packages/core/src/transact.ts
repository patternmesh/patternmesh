import type {
  DynamoAdapter,
  TransactGetItemsInput,
  TransactGetSlot,
  TransactWriteItemInput,
} from "./adapter.js";
import type { TableDef } from "./types.js";
import type { CompiledOperation } from "./types.js";
import type { CompiledEntity } from "./entity.js";
import type { EntityRuntime } from "./entity-runtime.js";
import { DISCRIMINATOR_ATTR, buildPrimaryKeyMap, logicalToStored, storedToLogicalPublic } from "./entity-runtime.js";
import {
  IdempotentParameterMismatchError,
  TransactionCanceledError,
  type TransactionCancellationReason,
  ValidationError,
} from "./errors.js";
import {
  isIdempotentParameterMismatch,
  isTransactionCanceled,
  readTransactionCancellationReasons,
} from "./aws-error.js";
import { validateAndApplyDefaults } from "./validation.js";
import { emptyCompiled, explainGetItem } from "./explain-helpers.js";
import type { FieldRef } from "./fields.js";
import {
  compileConditionExpression,
  createConditionShape,
  createUpdateBuilder,
  type ConditionExpr,
  conditionOpsImpl,
} from "./update.js";

/** DynamoDB TransactGet / TransactWrite item limit (same account/Region request). */
export const TRANSACT_MAX_ITEMS = 100;

const noopAdapter: DynamoAdapter = {
  async getItem() {
    return null;
  },
  async putItem() {
    return {};
  },
  async deleteItem() {
    return {};
  },
  async query() {
    return { items: [] };
  },
  async scan() {
    return { items: [] };
  },
  async updateItem() {
    return null;
  },
  async batchGetItem() {
    return { items: [] };
  },
  async batchWriteItem() {
    return {};
  },
  async transactGetItems() {
    return { responses: [] };
  },
  async transactWriteItems() {},
};

function stableKeyJson(key: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(key).sort()) sorted[k] = key[k];
  return JSON.stringify(sorted);
}

function writeTargetFingerprint(tableName: string, key: Record<string, unknown>): string {
  return `${tableName}#${stableKeyJson(key)}`;
}

function assertEntityTable(ent: CompiledEntity, connectTable: TableDef): EntityRuntime {
  const r = ent.runtime;
  if (r.table.name !== connectTable.name) {
    throw new ValidationError([
      {
        path: "tx",
        message: `Entity "${r.entityName}" uses table "${r.table.name}" but connect() table is "${connectTable.name}" (single-table transactions only)`,
      },
    ]);
  }
  return r;
}

function mapAwsReasons(raw: ReturnType<typeof readTransactionCancellationReasons>): TransactionCancellationReason[] {
  return raw.map((r) => ({
    code: r.Code,
    message: r.Message,
    ...(r.Item !== undefined ? { item: r.Item as Record<string, unknown> } : {}),
  }));
}

type FinalizedWriteOp = {
  readonly adapterItem: TransactWriteItemInput;
  readonly explain: CompiledOperation;
};

export class TransactWriteBuilder {
  private readonly ops: Array<() => FinalizedWriteOp> = [];

  constructor(private readonly connectTable: TableDef) {}

  put(
    ent: CompiledEntity,
    input: Record<string, unknown>,
    options?: { if?: (fields: Record<string, FieldRef<unknown>>, op: typeof conditionOpsImpl) => ConditionExpr },
  ): void {
    const runtime = assertEntityTable(ent, this.connectTable);
    const prepared = validateAndApplyDefaults({ ...input }, runtime.schema, runtime.fieldMeta);
    const item = logicalToStored(prepared, runtime);
    const key = buildPrimaryKeyMap(runtime, prepared);
    let conditionExpression: string | undefined;
    let expressionAttributeNames: Record<string, string> | undefined;
    let expressionAttributeValues: Record<string, unknown> | undefined;
    if (options?.if) {
      const shape = createConditionShape(runtime.fieldMeta);
      const c = compileConditionExpression(options.if(shape, conditionOpsImpl));
      conditionExpression = c.conditionExpression;
      expressionAttributeNames = c.expressionAttributeNames;
      expressionAttributeValues = c.expressionAttributeValues;
    }
    this.ops.push(() => {
      const adapterItem: TransactWriteItemInput = {
        kind: "Put",
        tableName: runtime.table.name,
        item,
        conditionExpression,
        expressionAttributeNames,
        expressionAttributeValues,
      };
      const explain: CompiledOperation = {
        ...emptyCompiled(runtime.entityName, "PutItem", runtime.table.name),
        key,
        conditionExpression,
        expressionAttributeNames: expressionAttributeNames ?? {},
        expressionAttributeValues: expressionAttributeValues ?? {},
        warnings: [],
      };
      return { adapterItem, explain };
    });
  }

  update(ent: CompiledEntity, primaryLogical: Record<string, unknown>) {
    const runtime = assertEntityTable(ent, this.connectTable);
    const inst = createUpdateBuilder(runtime, noopAdapter, primaryLogical, createConditionShape(runtime.fieldMeta));
    this.ops.push(() => {
      const c = inst.compileForTransact();
      const adapterItem: TransactWriteItemInput = {
        kind: "Update",
        tableName: c.tableName,
        key: c.key,
        updateExpression: c.updateExpression,
        expressionAttributeNames: c.expressionAttributeNames,
        expressionAttributeValues: c.expressionAttributeValues,
        conditionExpression: c.conditionExpression,
      };
      return { adapterItem, explain: inst.explain() };
    });
    return inst;
  }

  delete(
    ent: CompiledEntity,
    keyLogical: Record<string, unknown>,
    options?: { if?: (fields: Record<string, FieldRef<unknown>>, op: typeof conditionOpsImpl) => ConditionExpr },
  ): void {
    const runtime = assertEntityTable(ent, this.connectTable);
    const key = buildPrimaryKeyMap(runtime, keyLogical);
    let conditionExpression: string | undefined;
    let expressionAttributeNames: Record<string, string> | undefined;
    let expressionAttributeValues: Record<string, unknown> | undefined;
    if (options?.if) {
      const shape = createConditionShape(runtime.fieldMeta);
      const c = compileConditionExpression(options.if(shape, conditionOpsImpl));
      conditionExpression = c.conditionExpression;
      expressionAttributeNames = c.expressionAttributeNames;
      expressionAttributeValues = c.expressionAttributeValues;
    }
    this.ops.push(() => {
      const adapterItem: TransactWriteItemInput = {
        kind: "Delete",
        tableName: runtime.table.name,
        key,
        conditionExpression,
        expressionAttributeNames,
        expressionAttributeValues,
      };
      const explain: CompiledOperation = {
        ...emptyCompiled(runtime.entityName, "DeleteItem", runtime.table.name),
        key,
        conditionExpression,
        expressionAttributeNames: expressionAttributeNames ?? {},
        expressionAttributeValues: expressionAttributeValues ?? {},
        warnings: [],
      };
      return { adapterItem, explain };
    });
  }

  conditionCheck(
    ent: CompiledEntity,
    keyLogical: Record<string, unknown>,
    ifFn: (fields: Record<string, FieldRef<unknown>>, op: typeof conditionOpsImpl) => ConditionExpr,
  ): void {
    const runtime = assertEntityTable(ent, this.connectTable);
    const key = buildPrimaryKeyMap(runtime, keyLogical);
    const shape = createConditionShape(runtime.fieldMeta);
    const c = compileConditionExpression(ifFn(shape, conditionOpsImpl));
    this.ops.push(() => {
      const adapterItem: TransactWriteItemInput = {
        kind: "ConditionCheck",
        tableName: runtime.table.name,
        key,
        conditionExpression: c.conditionExpression,
        expressionAttributeNames: c.expressionAttributeNames,
        expressionAttributeValues: c.expressionAttributeValues,
      };
      const explain: CompiledOperation = {
        ...emptyCompiled(runtime.entityName, "ConditionCheck", runtime.table.name),
        key,
        conditionExpression: c.conditionExpression,
        expressionAttributeNames: c.expressionAttributeNames,
        expressionAttributeValues: c.expressionAttributeValues,
        warnings: [],
      };
      return { adapterItem, explain };
    });
  }

  finalize(): { items: TransactWriteItemInput[]; explainPlans: CompiledOperation[] } {
    const finalized = this.ops.map((f) => f());
    const items = finalized.map((x) => x.adapterItem);
    const explainPlans = finalized.map((x) => x.explain);
    if (items.length === 0) {
      throw new ValidationError([{ path: "tx.write", message: "Transaction has no write participants" }]);
    }
    if (items.length > TRANSACT_MAX_ITEMS) {
      throw new ValidationError([
        {
          path: "tx.write",
          message: `TransactWriteItems supports at most ${TRANSACT_MAX_ITEMS} items; got ${items.length}`,
        },
      ]);
    }
    const targets = new Set<string>();
    for (const it of items) {
      const tableName = it.tableName;
      const key = it.kind === "Put" ? pickKeyFromItem(it.item, this.connectTable) : it.key;
      const fp = writeTargetFingerprint(tableName, key);
      if (targets.has(fp)) {
        throw new ValidationError([
          {
            path: "tx.write",
            message: "TransactWriteItems cannot target the same item more than once (duplicate key across Put/Update/Delete/ConditionCheck)",
          },
        ]);
      }
      targets.add(fp);
    }
    return { items, explainPlans };
  }
}

function pickKeyFromItem(item: Record<string, unknown>, table: TableDef): Record<string, unknown> {
  const key: Record<string, unknown> = { [table.partitionKey]: item[table.partitionKey] };
  if (table.sortKey) {
    key[table.sortKey] = item[table.sortKey];
  }
  return key;
}

export class TransactReadBuilder {
  private readonly slots: {
    readonly label: string;
    readonly runtime: EntityRuntime;
    readonly keyLogical: Record<string, unknown>;
    readonly key: Record<string, unknown>;
    readonly consistentRead?: boolean;
  }[] = [];
  private readonly labels = new Set<string>();

  constructor(private readonly connectTable: TableDef) {}

  /** Number of registered `get` slots (for bounds / explain without building a service request). */
  getSlotCount(): number {
    return this.slots.length;
  }

  get(
    label: string,
    ent: CompiledEntity,
    keyLogical: Record<string, unknown>,
    options?: { consistentRead?: boolean },
  ): void {
    if (this.labels.has(label)) {
      throw new ValidationError([{ path: `tx.read.get(${label})`, message: "Duplicate label in transact read" }]);
    }
    this.labels.add(label);
    const runtime = assertEntityTable(ent, this.connectTable);
    const key = buildPrimaryKeyMap(runtime, keyLogical);
    this.slots.push({ label, runtime, keyLogical, key, consistentRead: options?.consistentRead });
  }

  buildGetInput(): TransactGetItemsInput {
    const items: TransactGetSlot[] = this.slots.map((s) => ({
      tableName: s.runtime.table.name,
      key: s.key,
      consistentRead: s.consistentRead,
    }));
    if (items.length === 0) {
      throw new ValidationError([{ path: "tx.read", message: "Transaction has no read participants" }]);
    }
    if (items.length > TRANSACT_MAX_ITEMS) {
      throw new ValidationError([
        {
          path: "tx.read",
          message: `TransactGetItems supports at most ${TRANSACT_MAX_ITEMS} items; got ${items.length}`,
        },
      ]);
    }
    return { items };
  }

  explainPlans(): CompiledOperation[] {
    return this.slots.map((s) => explainGetItem(s.runtime, s.keyLogical));
  }

  assertReadExplainBounds(): void {
    if (this.slots.length > TRANSACT_MAX_ITEMS) {
      throw new ValidationError([
        {
          path: "tx.read",
          message: `TransactGetItems supports at most ${TRANSACT_MAX_ITEMS} items; got ${this.slots.length}`,
        },
      ]);
    }
  }

  mapResponses(
    responses: readonly (Record<string, unknown> | null)[],
  ): Record<string, Record<string, unknown> | null> {
    const out: Record<string, Record<string, unknown> | null> = {};
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const raw = responses[i] ?? null;
      if (!raw) {
        out[slot.label] = null;
        continue;
      }
      if (raw[DISCRIMINATOR_ATTR] !== slot.runtime.discriminatorValue) {
        out[slot.label] = null;
        continue;
      }
      out[slot.label] = storedToLogicalPublic(raw, slot.runtime.table, new Set(Object.keys(slot.runtime.schema)));
    }
    return out;
  }
}

function handleTransactError(e: unknown): never {
  if (isTransactionCanceled(e)) {
    const reasons = mapAwsReasons(readTransactionCancellationReasons(e));
    throw new TransactionCanceledError(reasons, undefined, e);
  }
  if (isIdempotentParameterMismatch(e)) {
    throw new IdempotentParameterMismatchError(undefined, e);
  }
  throw e;
}

export function createTransactServices(connectTable: TableDef, adapter: DynamoAdapter) {
  return {
    tx: {
      write: async (fn: (w: TransactWriteBuilder) => void | Promise<void>, options?: { clientRequestToken?: string }) => {
        const b = new TransactWriteBuilder(connectTable);
        await fn(b);
        const { items } = b.finalize();
        try {
          await adapter.transactWriteItems({ items, clientRequestToken: options?.clientRequestToken });
        } catch (e) {
          handleTransactError(e);
        }
      },
      read: async (fn: (r: TransactReadBuilder) => void | Promise<void>) => {
        const b = new TransactReadBuilder(connectTable);
        await fn(b);
        const input = b.buildGetInput();
        try {
          const out = await adapter.transactGetItems(input);
          return b.mapResponses(out.responses);
        } catch (e) {
          handleTransactError(e);
        }
      },
    },
    explain: {
      write: (fn: (w: TransactWriteBuilder) => void): readonly CompiledOperation[] => {
        const b = new TransactWriteBuilder(connectTable);
        fn(b);
        return b.finalize().explainPlans;
      },
      read: (fn: (r: TransactReadBuilder) => void): readonly CompiledOperation[] => {
        const b = new TransactReadBuilder(connectTable);
        fn(b);
        if (b.getSlotCount() === 0) return [];
        b.assertReadExplainBounds();
        return b.explainPlans();
      },
    },
  };
}
