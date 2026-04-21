import type { IndexDef, LocalIndexDef, TableDef } from "./types.js";

export function defineTable<const T extends TableDef>(def: T): T {
  const lsiEntries = Object.entries(def.localIndexes ?? {});
  if (lsiEntries.length > 5) {
    throw new Error("defineTable: DynamoDB allows at most 5 local secondary indexes");
  }
  if (lsiEntries.length > 0 && !def.sortKey) {
    throw new Error("defineTable: localIndexes require a base-table sortKey");
  }
  for (const [name, idx] of lsiEntries) {
    if (idx.partitionKey !== def.partitionKey) {
      throw new Error(`defineTable: localIndexes.${name} must use the same partitionKey as the base table`);
    }
    if (!idx.sortKey) {
      throw new Error(`defineTable: localIndexes.${name}.sortKey is required`);
    }
    if (idx.projectionType === "INCLUDE" && (!idx.nonKeyAttributes || idx.nonKeyAttributes.length === 0)) {
      throw new Error(`defineTable: localIndexes.${name}.nonKeyAttributes is required when projectionType is INCLUDE`);
    }
    if (idx.projectionType !== "INCLUDE" && idx.nonKeyAttributes && idx.nonKeyAttributes.length > 0) {
      throw new Error(`defineTable: localIndexes.${name}.nonKeyAttributes is only valid with projectionType INCLUDE`);
    }
  }
  return def;
}

export type { IndexDef, LocalIndexDef, TableDef };
