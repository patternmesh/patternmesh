import type { AccessPatternDef, FieldMeta, TableDef } from "./types.js";
import type { SchemaRecord } from "./fields.js";

export const DISCRIMINATOR_ATTR = "entity" as const;

export interface EntityRuntime {
  readonly entityName: string;
  readonly discriminatorValue: string;
  readonly table: TableDef;
  readonly schema: SchemaRecord;
  readonly fieldMeta: Record<string, FieldMeta>;
  readonly identityKeys: readonly string[];
  readonly buildTableKeys: (logical: Record<string, unknown>) => { pk: string; sk?: string };
  readonly gsiProjections: ReadonlyArray<{
    indexName: string;
    fn: (logical: Record<string, unknown>) => Record<string, string>;
  }>;
  readonly accessPatterns: ReadonlyArray<AccessPatternDef>;
}

export function listInternalAttrNames(table: TableDef): Set<string> {
  const s = new Set<string>([table.partitionKey, DISCRIMINATOR_ATTR]);
  if (table.sortKey) s.add(table.sortKey);
  if (table.indexes) {
    for (const idx of Object.values(table.indexes)) {
      s.add(idx.partitionKey);
      if (idx.sortKey) s.add(idx.sortKey);
    }
  }
  return s;
}

export function storedToLogicalPublic(
  stored: Record<string, unknown>,
  table: TableDef,
  logicalKeys: Set<string>,
): Record<string, unknown> {
  const internal = listInternalAttrNames(table);
  const out: Record<string, unknown> = {};
  for (const k of logicalKeys) {
    if (internal.has(k)) continue;
    if (k === DISCRIMINATOR_ATTR) continue;
    if (Object.prototype.hasOwnProperty.call(stored, k)) {
      out[k] = stored[k];
    }
  }
  return out;
}

export function logicalToStored(
  logical: Record<string, unknown>,
  runtime: EntityRuntime,
): Record<string, unknown> {
  const { pk, sk } = runtime.buildTableKeys(logical);
  const item: Record<string, unknown> = {
    ...logical,
  };
  item[runtime.table.partitionKey] = pk;
  item[DISCRIMINATOR_ATTR] = runtime.discriminatorValue;
  if (runtime.table.sortKey && sk !== undefined) {
    item[runtime.table.sortKey] = sk;
  }
  for (const { fn } of runtime.gsiProjections) {
    const proj = fn(logical);
    Object.assign(item, proj);
  }
  return item;
}

export function buildPrimaryKeyMap(
  runtime: EntityRuntime,
  logical: Record<string, unknown>,
): Record<string, unknown> {
  const { pk, sk } = runtime.buildTableKeys(logical);
  const key: Record<string, unknown> = { [runtime.table.partitionKey]: pk };
  if (runtime.table.sortKey && sk !== undefined) {
    key[runtime.table.sortKey] = sk;
  }
  return key;
}
