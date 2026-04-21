import type {
  BatchGetItemInput,
  BatchGetItemOutput,
  BatchWriteItemInput,
  BatchWriteItemOutput,
  DeleteItemInput,
  DeleteItemOutput,
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
  TransactWriteItemInput,
  TransactWriteItemsInput,
  UpdateItemInput,
} from "../src/adapter.js";

function keysEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

function samePrimary(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return a.pk === b.pk && a.sk === b.sk;
}

function skMatches(
  it: Record<string, unknown>,
  input: QueryInput,
  skAttr: string,
  val: unknown,
  mode: "eq" | "begins" | "between",
  between?: readonly [unknown, unknown],
): boolean {
  const v = it[skAttr];
  if (mode === "eq") return String(v) === String(val);
  if (mode === "begins") return String(v ?? "").startsWith(String(val));
  if (mode === "between" && between) {
    const lo = String(between[0]);
    const hi = String(between[1]);
    const s = String(v ?? "");
    return s >= lo && s <= hi;
  }
  return false;
}

function resolveSkAttr(input: QueryInput): string | undefined {
  const firstCond = input.keyConditionExpression.split(" AND ")[0] ?? "";
  let pkAttr = (firstCond.split(" = ")[0] ?? "pk").trim();
  if (pkAttr.startsWith("#")) {
    pkAttr = input.expressionAttributeNames[pkAttr] ?? pkAttr;
  }
  const rest = input.keyConditionExpression.split(" AND ").slice(1);
  for (const clause of rest) {
    if (clause.includes("begins_with(")) {
      const m = clause.match(/begins_with\(([^,]+)/);
      const alias = m?.[1]?.trim();
      if (alias?.startsWith("#")) return input.expressionAttributeNames[alias];
    }
    if (clause.includes(" BETWEEN ")) {
      const m = clause.match(/^(\S+)\s+BETWEEN/);
      const alias = m?.[1]?.trim();
      if (alias?.startsWith("#")) return input.expressionAttributeNames[alias];
      return alias;
    }
    if (clause.includes(" = ") && !clause.includes("begins_with")) {
      const m = clause.match(/^(\S+)\s*=\s*:skeq$/);
      if (m) {
        const alias = m[1]?.trim();
        if (alias?.startsWith("#")) return input.expressionAttributeNames[alias];
        return alias;
      }
    }
  }
  return undefined;
}

function cloneAllTables(byTable: Map<string, Record<string, unknown>[]>): Map<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>();
  for (const [t, rows] of byTable) {
    out.set(t, rows.map((r) => ({ ...r })));
  }
  return out;
}

function applyMockUpdateFromTransact(
  hit: Record<string, unknown>,
  it: Extract<TransactWriteItemInput, { kind: "Update" }>,
): void {
  const ue = it.updateExpression.trim();
  const setIdx = ue.search(/\bSET\b/i);
  if (setIdx < 0) return;
  const setPart = ue.slice(setIdx + 3).trim();
  const beforeOther = setPart.split(/\b(REMOVE|ADD)\b/i)[0] ?? setPart;
  const parts = beforeOther.split(",").map((p) => p.trim());
  for (const part of parts) {
    const m = part.match(/^(\S+)\s*=\s*(\S+)$/);
    if (!m) continue;
    const nameAlias = m[1]!;
    const valAlias = m[2]!;
    const attrName = it.expressionAttributeNames[nameAlias];
    if (attrName != null && Object.prototype.hasOwnProperty.call(it.expressionAttributeValues, valAlias)) {
      hit[attrName] = it.expressionAttributeValues[valAlias];
    }
  }
}

/** In-memory mock assuming base-table keys `pk` and `sk` (matches typical defineTable examples). */
export function createMemoryAdapter(): DynamoAdapter & { allItems(table: string): Record<string, unknown>[] } {
  const byTable = new Map<string, Record<string, unknown>[]>();

  function list(table: string): Record<string, unknown>[] {
    if (!byTable.has(table)) byTable.set(table, []);
    const arr = byTable.get(table);
    if (!arr) throw new Error("mock internal");
    return arr;
  }

  return {
    allItems: (table) => [...list(table)],
    async getItem(input: GetItemInput): Promise<Record<string, unknown> | null> {
      const hit = list(input.tableName).find((it) => keysEqual(pickKey(it, input.key), input.key));
      return hit ? { ...hit } : null;
    },
    async putItem(input: PutItemInput): Promise<PutItemOutput> {
      const items = list(input.tableName);
      const idx = items.findIndex((it) => samePrimary(it, input.item));
      if (input.conditionExpression?.includes("attribute_not_exists") && idx >= 0) {
        throw { name: "ConditionalCheckFailedException" };
      }
      const old = idx >= 0 ? { ...items[idx] } : undefined;
      if (idx >= 0) items.splice(idx, 1);
      items.push({ ...input.item });
      const attrs = input.returnValues === "ALL_OLD" && old ? old : undefined;
      return { attributes: attrs };
    },
    async deleteItem(input: DeleteItemInput): Promise<DeleteItemOutput> {
      const items = list(input.tableName);
      const i = items.findIndex((it) => keysEqual(pickKey(it, input.key), input.key));
      let old: Record<string, unknown> | undefined;
      if (i >= 0) {
        old = { ...items[i] };
        items.splice(i, 1);
      }
      const attrs = input.returnValues === "ALL_OLD" && old ? old : undefined;
      return { attributes: attrs };
    },
    async query(input: QueryInput): Promise<QueryOutput> {
      const items = list(input.tableName);
      const pkVal = input.expressionAttributeValues[":pk"];
      const firstCond = input.keyConditionExpression.split(" AND ")[0] ?? "";
      let pkAttr = (firstCond.split(" = ")[0] ?? "pk").trim();
      if (pkAttr.startsWith("#")) {
        pkAttr = input.expressionAttributeNames[pkAttr] ?? pkAttr;
      }
      let filtered = items.filter((it) => String(it[pkAttr]) === String(pkVal));
      if (input.filterExpression?.includes(":__e")) {
        const want = input.expressionAttributeValues[":__e"];
        filtered = filtered.filter((it) => String(it.entity) === String(want));
      }
      const skAttr = resolveSkAttr(input);
      if (skAttr && input.expressionAttributeValues[":skpre"] !== undefined) {
        const pre = String(input.expressionAttributeValues[":skpre"]);
        filtered = filtered.filter((it) => skMatches(it, input, skAttr, pre, "begins"));
      }
      if (skAttr && input.expressionAttributeValues[":skeq"] !== undefined) {
        filtered = filtered.filter((it) => skMatches(it, input, skAttr, input.expressionAttributeValues[":skeq"], "eq"));
      }
      if (skAttr && input.expressionAttributeValues[":sklo"] !== undefined) {
        filtered = filtered.filter((it) =>
          skMatches(it, input, skAttr, null, "between", [
            input.expressionAttributeValues[":sklo"],
            input.expressionAttributeValues[":skhi"],
          ]),
        );
      }
      const lim = input.limit ?? filtered.length;
      const page = filtered.slice(0, lim);
      if (input.select === "COUNT") {
        return { items: [], count: page.length, lastEvaluatedKey: undefined, consumedCapacity: { capacityUnits: page.length } };
      }
      return { items: page.map((x) => ({ ...x })), consumedCapacity: { capacityUnits: page.length } };
    },
    async scan(input: ScanInput): Promise<ScanOutput> {
      let filtered = list(input.tableName);
      if (input.indexName && input.indexName.startsWith("GSI")) {
        filtered = filtered.filter((it) => it.gsi1pk !== undefined);
      }
      if (input.filterExpression?.includes(":__e")) {
        const want = input.expressionAttributeValues[":__e"];
        filtered = filtered.filter((it) => String(it.entity) === String(want));
      }
      const lim = input.limit ?? filtered.length;
      const page = filtered.slice(0, lim).map((x) => ({ ...x }));
      return { items: page, consumedCapacity: { capacityUnits: page.length } };
    },
    async updateItem(input: UpdateItemInput): Promise<Record<string, unknown> | null> {
      const items = list(input.tableName);
      const hit = items.find((it) => keysEqual(pickKey(it, input.key), input.key));
      if (!hit) return null;
      if (input.returnValues === "ALL_NEW") return { ...hit };
      return null;
    },
    async batchGetItem(input: BatchGetItemInput): Promise<BatchGetItemOutput> {
      const items: Record<string, unknown>[] = [];
      for (const key of input.keys) {
        const hit = list(input.tableName).find((it) => keysEqual(pickKey(it, key), key));
        if (hit) items.push({ ...hit });
      }
      return { items };
    },
    async batchWriteItem(input: BatchWriteItemInput): Promise<BatchWriteItemOutput> {
      for (const p of input.puts) {
        const arr = list(p.tableName);
        const idx = arr.findIndex((it) => samePrimary(it, p.item));
        if (idx >= 0) arr.splice(idx, 1);
        arr.push({ ...p.item });
      }
      for (const d of input.deletes) {
        const arr = list(d.tableName);
        const i = arr.findIndex((it) => keysEqual(pickKey(it, d.key), d.key));
        if (i >= 0) arr.splice(i, 1);
      }
      return {};
    },

    async transactGetItems(input: TransactGetItemsInput): Promise<TransactGetItemsOutput> {
      const responses: (Record<string, unknown> | null)[] = [];
      for (const slot of input.items) {
        const hit = list(slot.tableName).find((it) => keysEqual(pickKey(it, slot.key), slot.key));
        responses.push(hit ? { ...hit } : null);
      }
      return { responses };
    },

    async transactWriteItems(input: TransactWriteItemsInput): Promise<void> {
      const snap = cloneAllTables(byTable);
      try {
        for (const it of input.items) {
          if (it.kind === "Put") {
            const arr = list(it.tableName);
            const idx = arr.findIndex((row) => samePrimary(row, it.item));
            if (idx >= 0) arr.splice(idx, 1);
            arr.push({ ...it.item });
            continue;
          }
          if (it.kind === "Delete") {
            const arr = list(it.tableName);
            const i = arr.findIndex((row) => keysEqual(pickKey(row, it.key), it.key));
            if (i >= 0) arr.splice(i, 1);
            continue;
          }
          if (it.kind === "Update") {
            const arr = list(it.tableName);
            const hit = arr.find((row) => keysEqual(pickKey(row, it.key), it.key));
            if (hit) applyMockUpdateFromTransact(hit, it);
            continue;
          }
          // ConditionCheck: memory mock does not evaluate expressions (use DynamoDB Local for real checks).
        }
      } catch (e) {
        byTable.clear();
        for (const [t, rows] of snap) byTable.set(t, rows);
        throw e;
      }
    },
  };
}

function pickKey(item: Record<string, unknown>, key: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(key)) out[k] = item[k];
  return out;
}
