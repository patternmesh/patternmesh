import type { CompiledOperation } from "./types.js";
import type { EntityRuntime } from "./entity-runtime.js";
import { buildPrimaryKeyMap } from "./entity-runtime.js";

export function emptyCompiled(
  entity: string,
  operation: CompiledOperation["operation"],
  tableName: string,
): CompiledOperation {
  return {
    entity,
    operation,
    tableName,
    expressionAttributeNames: {},
    expressionAttributeValues: {},
    warnings: [],
  };
}

export function explainGetItem(
  runtime: EntityRuntime,
  logical: Record<string, unknown>,
): CompiledOperation {
  const key = buildPrimaryKeyMap(runtime, logical);
  return {
    ...emptyCompiled(runtime.entityName, "GetItem", runtime.table.name),
    key,
  };
}

export function explainDeleteItem(
  runtime: EntityRuntime,
  logical: Record<string, unknown>,
): CompiledOperation {
  const key = buildPrimaryKeyMap(runtime, logical);
  return {
    ...emptyCompiled(runtime.entityName, "DeleteItem", runtime.table.name),
    key,
  };
}
