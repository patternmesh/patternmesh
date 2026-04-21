import type { AccessPatternDef, DynamoReadPlan, OpaqueCursor, TableDef } from "./types.js";
import { DISCRIMINATOR_ATTR } from "./entity-runtime.js";
import { decodeCursor } from "./cursor.js";
import { ValidationError } from "./errors.js";

type KeyParts = { pk: string; sk?: string };

const RESERVED_NAME = "#__e";
const RESERVED_VALUE = ":__e";

function entityFilter(discriminatorValue: string): {
  filterExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
} {
  return {
    filterExpression: `${RESERVED_NAME} = ${RESERVED_VALUE}`,
    expressionAttributeNames: { [RESERVED_NAME]: DISCRIMINATOR_ATTR },
    expressionAttributeValues: { [RESERVED_VALUE]: discriminatorValue },
  };
}

function assertNoReservedFilterTokens(
  names: Record<string, string> | undefined,
  values: Record<string, unknown> | undefined,
): void {
  const issues: { path: string; message: string }[] = [];
  if (names && RESERVED_NAME in names) {
    issues.push({
      path: "filterExpressionAttributeNames",
      message: `Placeholder ${RESERVED_NAME} is reserved for the entity discriminator filter`,
    });
  }
  if (values && RESERVED_VALUE in values) {
    issues.push({
      path: "filterExpressionAttributeValues",
      message: `Placeholder ${RESERVED_VALUE} is reserved for the entity discriminator filter`,
    });
  }
  if (issues.length) throw new ValidationError(issues);
}

function mergeEntityFilter(
  discriminatorValue: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
  kce: string,
  extra?: { filterExpression?: string; extraNames?: Record<string, string>; extraValues?: Record<string, unknown> },
): {
  keyConditionExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
  filterExpression: string;
  userAuthorFilter: boolean;
} {
  const efBase = entityFilter(discriminatorValue);
  let filter = efBase.filterExpression;
  let allNames = { ...names, ...efBase.expressionAttributeNames };
  let allValues = { ...values, ...efBase.expressionAttributeValues };
  let userAuthorFilter = false;
  if (extra?.filterExpression) {
    assertNoReservedFilterTokens(extra.extraNames, extra.extraValues);
    userAuthorFilter = true;
    filter = `${extra.filterExpression} AND (${efBase.filterExpression})`;
    allNames = { ...allNames, ...(extra.extraNames ?? {}) };
    allValues = { ...allValues, ...(extra.extraValues ?? {}) };
  }
  return {
    keyConditionExpression: kce,
    expressionAttributeNames: allNames,
    expressionAttributeValues: allValues,
    filterExpression: filter,
    userAuthorFilter,
  };
}

function mergeEntityFilterForScan(
  discriminatorValue: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
  extra?: { filterExpression?: string; extraNames?: Record<string, string>; extraValues?: Record<string, unknown> },
): {
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
  filterExpression: string;
  userAuthorFilter: boolean;
} {
  const efBase = entityFilter(discriminatorValue);
  let filter = efBase.filterExpression;
  let allNames = { ...names, ...efBase.expressionAttributeNames };
  let allValues = { ...values, ...efBase.expressionAttributeValues };
  let userAuthorFilter = false;
  if (extra?.filterExpression) {
    assertNoReservedFilterTokens(extra.extraNames, extra.extraValues);
    userAuthorFilter = true;
    filter = `${extra.filterExpression} AND (${efBase.filterExpression})`;
    allNames = { ...allNames, ...(extra.extraNames ?? {}) };
    allValues = { ...allValues, ...(extra.extraValues ?? {}) };
  }
  return {
    expressionAttributeNames: allNames,
    expressionAttributeValues: allValues,
    filterExpression: filter,
    userAuthorFilter,
  };
}

type QueryExtras<I> = I & {
  skBeginsWith?: string;
  skEq?: string;
  skBetween?: readonly [string, string];
  limit?: number;
  scanIndexForward?: boolean;
  filterExpression?: string;
  filterExpressionAttributeNames?: Record<string, string>;
  filterExpressionAttributeValues?: Record<string, unknown>;
  cursor?: OpaqueCursor;
  consistentRead?: boolean;
  select?: "ALL_ATTRIBUTES" | "ALL_PROJECTED_ATTRIBUTES" | "COUNT";
  returnConsumedCapacity?: "INDEXES" | "TOTAL" | "NONE";
  projectionExpression?: string;
  expressionAttributeNames?: Record<string, string>;
};

type ScanExtras = {
  limit?: number;
  filterExpression?: string;
  filterExpressionAttributeNames?: Record<string, string>;
  filterExpressionAttributeValues?: Record<string, unknown>;
  cursor?: OpaqueCursor;
  consistentRead?: boolean;
  projectionExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  segment?: number;
  totalSegments?: number;
  returnConsumedCapacity?: "INDEXES" | "TOTAL" | "NONE";
};

function resolveIndexDef(
  table: TableDef,
  indexName: string | undefined,
): { partitionKey: string; sortKey?: string; indexType?: "GSI" | "LSI" } {
  if (indexName === undefined) {
    return { partitionKey: table.partitionKey, sortKey: table.sortKey };
  }
  const gsi = table.indexes?.[indexName];
  if (gsi) return { partitionKey: gsi.partitionKey, sortKey: gsi.sortKey, indexType: "GSI" };
  const lsi = table.localIndexes?.[indexName];
  if (lsi) return { partitionKey: lsi.partitionKey, sortKey: lsi.sortKey, indexType: "LSI" };
  throw new Error(`Unknown index "${String(indexName)}" on table`);
}

function buildSkKeyCondition(
  skAttr: string | undefined,
  built: QueryExtras<KeyParts>,
): { kceSuffix: string; names: Record<string, string>; values: Record<string, unknown> } {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const modes = [built.skBeginsWith !== undefined, built.skEq !== undefined, built.skBetween !== undefined].filter(
    Boolean,
  ).length;
  if (modes > 1) {
    throw new ValidationError([
      {
        path: "accessPattern",
        message: "Specify at most one of skBeginsWith, skEq, or skBetween for the sort key condition",
      },
    ]);
  }
  if (built.skBeginsWith !== undefined) {
    if (!skAttr) {
      throw new ValidationError([{ path: "skBeginsWith", message: "Table or index has no sort key" }]);
    }
    values[":skpre"] = built.skBeginsWith;
    return { kceSuffix: ` AND begins_with(${skAttr}, :skpre)`, names, values };
  }
  if (built.skEq !== undefined) {
    if (!skAttr) {
      throw new ValidationError([{ path: "skEq", message: "Table or index has no sort key" }]);
    }
    values[":skeq"] = built.skEq;
    return { kceSuffix: ` AND ${skAttr} = :skeq`, names, values };
  }
  if (built.skBetween !== undefined) {
    if (!skAttr) {
      throw new ValidationError([{ path: "skBetween", message: "Table or index has no sort key" }]);
    }
    const pair = built.skBetween;
    if (pair.length !== 2) {
      throw new ValidationError([{ path: "skBetween", message: "skBetween must be a tuple of two string bounds" }]);
    }
    values[":sklo"] = pair[0];
    values[":skhi"] = pair[1];
    return { kceSuffix: ` AND ${skAttr} BETWEEN :sklo AND :skhi`, names, values };
  }
  return { kceSuffix: "", names, values };
}

export function createAccessPatternFactory(table: TableDef, discriminatorValue: string) {
  function queryPattern<I>(
    indexName: string | undefined,
    fn: (input: I) => QueryExtras<KeyParts>,
    accessKind: "query" | "unique",
  ): AccessPatternDef<I> {
    const idx = resolveIndexDef(table, indexName);
    return {
      name: "",
      kind: accessKind,
      indexName,
      buildRequest(input: I): DynamoReadPlan {
        const built = fn(input);
        const fromInput = (input as Record<string, unknown>) ?? {};
        const builtFinal = {
          ...built,
          limit: built.limit ?? (typeof fromInput.limit === "number" ? fromInput.limit : undefined),
          scanIndexForward:
            built.scanIndexForward ?? (typeof fromInput.scanIndexForward === "boolean" ? fromInput.scanIndexForward : undefined),
          consistentRead:
            built.consistentRead ?? (typeof fromInput.consistentRead === "boolean" ? fromInput.consistentRead : undefined),
          select: built.select ?? (typeof fromInput.select === "string" ? (fromInput.select as QueryExtras<KeyParts>["select"]) : undefined),
          projectionExpression:
            built.projectionExpression ??
            (typeof fromInput.projectionExpression === "string" ? fromInput.projectionExpression : undefined),
          expressionAttributeNames:
            built.expressionAttributeNames ??
            (typeof fromInput.expressionAttributeNames === "object"
              ? (fromInput.expressionAttributeNames as Record<string, string>)
              : undefined),
          returnConsumedCapacity:
            built.returnConsumedCapacity ??
            (typeof fromInput.returnConsumedCapacity === "string"
              ? (fromInput.returnConsumedCapacity as QueryExtras<KeyParts>["returnConsumedCapacity"])
              : undefined),
          cursor: built.cursor ?? (typeof fromInput.cursor === "string" ? (fromInput.cursor as OpaqueCursor) : undefined),
        };
        const pkAttr = idx.partitionKey;
        const skAttr = idx.sortKey;
        let kce = `${pkAttr} = :pk`;
        const names: Record<string, string> = { ...(builtFinal.expressionAttributeNames ?? {}) };
        const values: Record<string, unknown> = { ":pk": builtFinal.pk };

        const skPart = buildSkKeyCondition(skAttr, builtFinal as QueryExtras<KeyParts>);
        kce += skPart.kceSuffix;
        Object.assign(names, skPart.names);
        Object.assign(values, skPart.values);

        if (builtFinal.filterExpression) {
          if (!builtFinal.filterExpressionAttributeNames || !builtFinal.filterExpressionAttributeValues) {
            throw new ValidationError([
              {
                path: "filterExpression",
                message:
                  "When filterExpression is set, provide filterExpressionAttributeNames and filterExpressionAttributeValues (low-level Dynamo path; a typed filter builder may come later)",
              },
            ]);
          }
        }

        const merged = mergeEntityFilter(
          discriminatorValue,
          names,
          values,
          kce,
          builtFinal.filterExpression
            ? {
                filterExpression: builtFinal.filterExpression,
                extraNames: builtFinal.filterExpressionAttributeNames,
                extraValues: builtFinal.filterExpressionAttributeValues,
              }
            : undefined,
        );

        const projNames = builtFinal.projectionExpression ? builtFinal.expressionAttributeNames ?? {} : {};
        const projExpr = builtFinal.projectionExpression;
        const mergedNamesForProjection =
          Object.keys(projNames).length > 0 ? { ...merged.expressionAttributeNames, ...projNames } : merged.expressionAttributeNames;

        return {
          type: "Query",
          indexName,
          indexType: idx.indexType,
          keyConditionExpression: merged.keyConditionExpression,
          expressionAttributeNames: mergedNamesForProjection,
          expressionAttributeValues: merged.expressionAttributeValues,
          limit: builtFinal.limit,
          scanIndexForward: builtFinal.scanIndexForward,
          filterExpression: merged.filterExpression,
          projectionExpression: projExpr,
          exclusiveStartKey: builtFinal.cursor ? decodeCursor(builtFinal.cursor) : undefined,
          consistentRead: builtFinal.consistentRead,
          select: builtFinal.select,
          userAuthorFilter: merged.userAuthorFilter,
          returnConsumedCapacity: builtFinal.returnConsumedCapacity,
        };
      },
    };
  }

  return {
    get<I>(fn: (input: I) => KeyParts & { consistentRead?: boolean; projectionExpression?: string; expressionAttributeNames?: Record<string, string> }): AccessPatternDef<I> {
      return {
        name: "",
        kind: "get",
        buildRequest(input: I): DynamoReadPlan {
          const built = fn(input);
          const key: Record<string, unknown> = { [table.partitionKey]: built.pk };
          if (table.sortKey && built.sk !== undefined) key[table.sortKey] = built.sk;
          return {
            type: "GetItem",
            key,
            consistentRead: built.consistentRead,
            projectionExpression: built.projectionExpression,
            expressionAttributeNames: built.expressionAttributeNames,
          };
        },
      };
    },

    query: <I>(indexName: string | undefined, fn: (input: I) => QueryExtras<KeyParts>) => queryPattern(indexName, fn, "query"),

    unique: <I>(indexName: string, fn: (input: I) => { pk: string; sk?: string }) => {
      return {
        name: "",
        kind: "unique",
        indexName,
        buildRequest(input: I): DynamoReadPlan {
          const inner = queryPattern(
            indexName,
            (inp: I) => ({
              ...fn(inp),
              limit: 2,
            }),
            "unique",
          );
          return inner.buildRequest(input);
        },
      };
    },

    count: <I>(indexName: string | undefined, fn: (input: I) => QueryExtras<KeyParts>) => {
      const inner = queryPattern(indexName, fn, "query");
      return {
        name: "",
        kind: "count",
        indexName,
        buildRequest(input: I): DynamoReadPlan {
          const plan = inner.buildRequest(input);
          if (plan.type !== "Query") throw new Error("count: internal error");
          return { ...plan, select: "COUNT" as const };
        },
      };
    },

    scan: <I>(indexName: string | undefined, fn: (input: I) => ScanExtras) => {
      const idx = resolveIndexDef(table, indexName);
      return {
        name: "",
        kind: "scan",
        indexName,
        buildRequest(input: I): DynamoReadPlan {
          const built = fn(input);
          const fromInput = (input as Record<string, unknown>) ?? {};
          const builtFinal = {
            ...built,
            limit: built.limit ?? (typeof fromInput.limit === "number" ? fromInput.limit : undefined),
            consistentRead:
              built.consistentRead ?? (typeof fromInput.consistentRead === "boolean" ? fromInput.consistentRead : undefined),
            projectionExpression:
              built.projectionExpression ??
              (typeof fromInput.projectionExpression === "string" ? fromInput.projectionExpression : undefined),
            expressionAttributeNames:
              built.expressionAttributeNames ??
              (typeof fromInput.expressionAttributeNames === "object"
                ? (fromInput.expressionAttributeNames as Record<string, string>)
                : undefined),
            returnConsumedCapacity:
              built.returnConsumedCapacity ??
              (typeof fromInput.returnConsumedCapacity === "string"
                ? (fromInput.returnConsumedCapacity as ScanExtras["returnConsumedCapacity"])
                : undefined),
            segment: built.segment ?? (typeof fromInput.segment === "number" ? fromInput.segment : undefined),
            totalSegments:
              built.totalSegments ?? (typeof fromInput.totalSegments === "number" ? fromInput.totalSegments : undefined),
            cursor: built.cursor ?? (typeof fromInput.cursor === "string" ? (fromInput.cursor as OpaqueCursor) : undefined),
          };
          if (builtFinal.filterExpression) {
            if (!builtFinal.filterExpressionAttributeNames || !builtFinal.filterExpressionAttributeValues) {
              throw new ValidationError([
                {
                  path: "filterExpression",
                  message:
                    "When filterExpression is set, provide filterExpressionAttributeNames and filterExpressionAttributeValues (low-level Dynamo path; a typed filter builder may come later)",
                },
              ]);
            }
          }
          const merged = mergeEntityFilterForScan(
            discriminatorValue,
            builtFinal.expressionAttributeNames ?? {},
            {},
            builtFinal.filterExpression
              ? {
                  filterExpression: builtFinal.filterExpression,
                  extraNames: builtFinal.filterExpressionAttributeNames,
                  extraValues: builtFinal.filterExpressionAttributeValues,
                }
              : undefined,
          );
          return {
            type: "Scan",
            indexName,
            indexType: idx.indexType,
            segment: builtFinal.segment,
            totalSegments: builtFinal.totalSegments,
            limit: builtFinal.limit,
            filterExpression: merged.filterExpression,
            projectionExpression: builtFinal.projectionExpression,
            expressionAttributeNames: merged.expressionAttributeNames,
            expressionAttributeValues: merged.expressionAttributeValues,
            exclusiveStartKey: builtFinal.cursor ? decodeCursor(builtFinal.cursor) : undefined,
            consistentRead: builtFinal.consistentRead,
            userAuthorFilter: merged.userAuthorFilter,
            returnConsumedCapacity: builtFinal.returnConsumedCapacity,
          };
        },
      };
    },
  };
}
