import type { CompiledOperation } from "./types.js";
import type { DynamoAdapter } from "./adapter.js";
import type { EntityRuntime } from "./entity-runtime.js";
import { buildPrimaryKeyMap, storedToLogicalPublic } from "./entity-runtime.js";
import { ConditionFailedError, ValidationError } from "./errors.js";
import { isConditionalCheckFailed } from "./aws-error.js";
import { emptyCompiled } from "./explain-helpers.js";
import type { FieldRef } from "./fields.js";
import type { FieldMeta } from "./types.js";

export interface ConditionExpr {
  readonly __brand: "ConditionExpr";
}

type CondNode =
  | { k: "eq"; path: string; val: unknown }
  | { k: "ne"; path: string; val: unknown }
  | { k: "exists"; path: string }
  | { k: "notExists"; path: string }
  | { k: "contains"; path: string; val: unknown }
  | { k: "beginsWith"; path: string; val: unknown }
  | { k: "attributeType"; path: string; val: string }
  | { k: "and"; ch: CondNode[] }
  | { k: "or"; ch: CondNode[] };

function markCond(n: CondNode): ConditionExpr {
  return n as unknown as ConditionExpr;
}

function nextName(counter: { i: number }, existing: Set<string>): string {
  let n = `#n${counter.i++}`;
  while (existing.has(n)) n = `#n${counter.i++}`;
  existing.add(n);
  return n;
}

function nextVal(counter: { i: number }, existing: Set<string>): string {
  let v = `:v${counter.i++}`;
  while (existing.has(v)) v = `:v${counter.i++}`;
  existing.add(v);
  return v;
}

function compileCond(
  node: CondNode,
  nameCounter: { i: number },
  valCounter: { i: number },
  pathToName: Map<string, string>,
  names: Record<string, string>,
  values: Record<string, unknown>,
): string {
  const ensureName = (segment: string): string => {
    let n = pathToName.get(segment);
    if (!n) {
      n = nextName(nameCounter, new Set(Object.keys(names)));
      pathToName.set(segment, n);
      names[n] = segment;
    }
    return n;
  };
  const parsePath = (path: string): Array<string | number> => {
    const out: Array<string | number> = [];
    const parts = path.split(".");
    for (const part of parts) {
      const m = part.match(/^([^[\]]+)(.*)$/);
      if (!m) continue;
      out.push(m[1]!);
      let rest = m[2] ?? "";
      while (rest.length > 0) {
        const idx = rest.match(/^\[(\d+)\](.*)$/);
        if (!idx) break;
        out.push(Number(idx[1]));
        rest = idx[2] ?? "";
      }
    }
    return out;
  };
  const ensurePathExpr = (path: string): string => {
    const toks = parsePath(path);
    let expr = "";
    for (const t of toks) {
      if (typeof t === "number") {
        expr += `[${t}]`;
      } else {
        const n = ensureName(t);
        expr = expr.length === 0 ? n : `${expr}.${n}`;
      }
    }
    return expr;
  };
  switch (node.k) {
    case "eq": {
      const n = ensurePathExpr(node.path);
      const v = nextVal(valCounter, new Set(Object.keys(values)));
      values[v] = node.val;
      return `${n} = ${v}`;
    }
    case "ne": {
      const n = ensurePathExpr(node.path);
      const v = nextVal(valCounter, new Set(Object.keys(values)));
      values[v] = node.val;
      return `${n} <> ${v}`;
    }
    case "exists": {
      const n = ensurePathExpr(node.path);
      return `attribute_exists(${n})`;
    }
    case "notExists": {
      const n = ensurePathExpr(node.path);
      return `attribute_not_exists(${n})`;
    }
    case "contains": {
      const n = ensurePathExpr(node.path);
      const v = nextVal(valCounter, new Set(Object.keys(values)));
      values[v] = node.val;
      return `contains(${n}, ${v})`;
    }
    case "beginsWith": {
      const n = ensurePathExpr(node.path);
      const v = nextVal(valCounter, new Set(Object.keys(values)));
      values[v] = node.val;
      return `begins_with(${n}, ${v})`;
    }
    case "attributeType": {
      const n = ensurePathExpr(node.path);
      const v = nextVal(valCounter, new Set(Object.keys(values)));
      values[v] = node.val;
      return `attribute_type(${n}, ${v})`;
    }
    case "and":
      return `(${node.ch.map((c) => compileCond(c, nameCounter, valCounter, pathToName, names, values)).join(" AND ")})`;
    case "or":
      return `(${node.ch.map((c) => compileCond(c, nameCounter, valCounter, pathToName, names, values)).join(" OR ")})`;
    default:
      return "";
  }
}

export function compileConditionExpression(expr: ConditionExpr): {
  readonly conditionExpression: string;
  readonly expressionAttributeNames: Record<string, string>;
  readonly expressionAttributeValues: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const nameCounter = { i: 0 };
  const valCounter = { i: 0 };
  const pathToName = new Map<string, string>();
  const conditionExpression = compileCond(expr as unknown as CondNode, nameCounter, valCounter, pathToName, names, values);
  return { conditionExpression, expressionAttributeNames: names, expressionAttributeValues: values };
}

export const conditionOpsImpl = {
  eq<T>(left: FieldRef<T>, right: T): ConditionExpr {
    return markCond({ k: "eq", path: left.path, val: right });
  },
  ne<T>(left: FieldRef<T>, right: T): ConditionExpr {
    return markCond({ k: "ne", path: left.path, val: right });
  },
  exists(left: FieldRef<unknown>): ConditionExpr {
    return markCond({ k: "exists", path: left.path });
  },
  notExists(left: FieldRef<unknown>): ConditionExpr {
    return markCond({ k: "notExists", path: left.path });
  },
  contains<T>(left: FieldRef<T>, value: unknown): ConditionExpr {
    return markCond({ k: "contains", path: left.path, val: value });
  },
  beginsWith(left: FieldRef<unknown>, value: string): ConditionExpr {
    return markCond({ k: "beginsWith", path: left.path, val: value });
  },
  attributeType(left: FieldRef<unknown>, type: string): ConditionExpr {
    return markCond({ k: "attributeType", path: left.path, val: type });
  },
  and(...exprs: ConditionExpr[]): ConditionExpr {
    return markCond({ k: "and", ch: exprs as unknown as CondNode[] });
  },
  or(...exprs: ConditionExpr[]): ConditionExpr {
    return markCond({ k: "or", ch: exprs as unknown as CondNode[] });
  },
};

export function createConditionShape(fieldMeta: Record<string, FieldMeta>): Record<string, FieldRef<unknown>> {
  const shape: Record<string, FieldRef<unknown>> = {};
  for (const k of Object.keys(fieldMeta)) {
    const meta = fieldMeta[k];
    if (meta) shape[k] = { __brand: "FieldRef", path: meta.attrName };
  }
  return shape;
}

export function createUpdateBuilder(
  runtime: EntityRuntime,
  adapter: DynamoAdapter,
  primaryLogical: Record<string, unknown>,
  conditionShape: Record<string, FieldRef<unknown>>,
): UpdateBuilderInstance {
  return new UpdateBuilderInstance(runtime, adapter, primaryLogical, conditionShape);
}

export class UpdateBuilderInstance {
  private setOps: Record<string, unknown> = {};
  private addOps: Record<string, number> = {};
  private removeAttrs: string[] = [];
  private setPathOps: Array<{ path: string; value: unknown }> = [];
  private removePathAttrs: string[] = [];
  private listAppendOps: Array<{ path: string; values: readonly unknown[] }> = [];
  private listPrependOps: Array<{ path: string; values: readonly unknown[] }> = [];
  private setAddOps: Array<{ path: string; members: Set<unknown> }> = [];
  private setDeleteOps: Array<{ path: string; members: Set<unknown> }> = [];
  private userCond?: CondNode;

  constructor(
    private readonly runtime: EntityRuntime,
    private readonly adapter: DynamoAdapter,
    private readonly primaryLogical: Record<string, unknown>,
    private readonly conditionShape: Record<string, FieldRef<unknown>>,
  ) {}

  private assertKnownPathRoot(path: string, context: string): void {
    const root = path.split(".")[0]?.split("[")[0];
    if (!root || !this.runtime.fieldMeta[root]) {
      throw new ValidationError([{ path, message: `Unknown field in ${context}()` }]);
    }
  }

  set(values: Record<string, unknown>): this {
    for (const k of Object.keys(values)) {
      if (!this.runtime.fieldMeta[k]) {
        throw new ValidationError([{ path: k, message: "Unknown field in set()" }]);
      }
    }
    Object.assign(this.setOps, values);
    return this;
  }

  add(values: Record<string, number>): this {
    for (const k of Object.keys(values)) {
      if (!this.runtime.fieldMeta[k]) {
        throw new ValidationError([{ path: k, message: "Unknown field in add()" }]);
      }
    }
    Object.assign(this.addOps, values);
    return this;
  }

  remove(fields: readonly string[]): this {
    for (const k of fields) {
      if (!this.runtime.fieldMeta[k]) {
        throw new ValidationError([{ path: String(k), message: "Unknown field in remove()" }]);
      }
    }
    this.removeAttrs.push(...fields);
    return this;
  }

  setPath(path: string | FieldRef<unknown>, value: unknown): this {
    const p = typeof path === "string" ? path : path.path;
    this.assertKnownPathRoot(p, "setPath");
    this.setPathOps.push({ path: p, value });
    return this;
  }

  removePath(paths: readonly (string | FieldRef<unknown>)[]): this {
    for (const p of paths) {
      const path = typeof p === "string" ? p : p.path;
      this.assertKnownPathRoot(path, "removePath");
      this.removePathAttrs.push(path);
    }
    return this;
  }

  listAppend(path: string | FieldRef<unknown>, values: readonly unknown[]): this {
    const p = typeof path === "string" ? path : path.path;
    this.assertKnownPathRoot(p, "listAppend");
    this.listAppendOps.push({ path: p, values });
    return this;
  }

  listPrepend(path: string | FieldRef<unknown>, values: readonly unknown[]): this {
    const p = typeof path === "string" ? path : path.path;
    this.assertKnownPathRoot(p, "listPrepend");
    this.listPrependOps.push({ path: p, values });
    return this;
  }

  setAdd(path: string | FieldRef<unknown>, members: Set<unknown>): this {
    if (members.size === 0) throw new ValidationError([{ path: typeof path === "string" ? path : path.path, message: "Empty set is not allowed" }]);
    const p = typeof path === "string" ? path : path.path;
    this.assertKnownPathRoot(p, "setAdd");
    this.setAddOps.push({ path: p, members });
    return this;
  }

  setDelete(path: string | FieldRef<unknown>, members: Set<unknown>): this {
    if (members.size === 0) throw new ValidationError([{ path: typeof path === "string" ? path : path.path, message: "Empty set is not allowed" }]);
    const p = typeof path === "string" ? path : path.path;
    this.assertKnownPathRoot(p, "setDelete");
    this.setDeleteOps.push({ path: p, members });
    return this;
  }

  if(fn: (fields: Record<string, FieldRef<unknown>>, op: typeof conditionOpsImpl) => ConditionExpr): this {
    this.userCond = fn(this.conditionShape, conditionOpsImpl) as unknown as CondNode;
    return this;
  }

  explain(): CompiledOperation {
    const { updateExpression, expressionAttributeNames, expressionAttributeValues, conditionExpression } =
      this.compileExpressions();
    const key = buildPrimaryKeyMap(this.runtime, this.primaryLogical);
    return {
      ...emptyCompiled(this.runtime.entityName, "UpdateItem", this.runtime.table.name),
      key,
      updateExpression,
      conditionExpression,
      expressionAttributeNames,
      expressionAttributeValues,
      warnings: [],
    };
  }

  /** Compile this update for TransactWriteItems (no Dynamo round-trip). */
  compileForTransact(): {
    readonly tableName: string;
    readonly key: Record<string, unknown>;
    readonly updateExpression: string;
    readonly expressionAttributeNames: Record<string, string>;
    readonly expressionAttributeValues: Record<string, unknown>;
    readonly conditionExpression?: string;
  } {
    const { updateExpression, expressionAttributeNames, expressionAttributeValues, conditionExpression } =
      this.compileExpressions();
    const key = buildPrimaryKeyMap(this.runtime, this.primaryLogical);
    return {
      tableName: this.runtime.table.name,
      key,
      updateExpression,
      expressionAttributeNames,
      expressionAttributeValues,
      conditionExpression,
    };
  }

  async go(options?: {
    return?: "new" | "old" | "none" | "updatedNew" | "updatedOld";
    returnValuesOnConditionCheckFailure?: "old" | "none";
  }): Promise<Record<string, unknown> | undefined> {
    const { updateExpression, expressionAttributeNames, expressionAttributeValues, conditionExpression } =
      this.compileExpressions();
    const key = buildPrimaryKeyMap(this.runtime, this.primaryLogical);
    const ret = options?.return ?? "new";
    const rv =
      ret === "new"
        ? "ALL_NEW"
        : ret === "old"
          ? "ALL_OLD"
          : ret === "none"
            ? "NONE"
            : ret === "updatedNew"
              ? "UPDATED_NEW"
              : "UPDATED_OLD";
    const rvFail =
      options?.returnValuesOnConditionCheckFailure === "old"
        ? "ALL_OLD"
        : options?.returnValuesOnConditionCheckFailure === "none"
          ? "NONE"
          : undefined;
    try {
      const out = await this.adapter.updateItem({
        tableName: this.runtime.table.name,
        key,
        updateExpression,
        expressionAttributeNames,
        expressionAttributeValues,
        conditionExpression,
        returnValues: rv,
        ...(rvFail != null ? { returnValuesOnConditionCheckFailure: rvFail } : {}),
      });
      if (ret === "none") return undefined;
      if (!out) {
        throw new Error("UpdateItem returned no attributes for the requested return mode");
      }
      return storedToLogicalPublic(out, this.runtime.table, new Set(Object.keys(this.runtime.schema)));
    } catch (e) {
      if (isConditionalCheckFailed(e)) throw new ConditionFailedError("Conditional check failed", e);
      throw e;
    }
  }

  private compileExpressions(): {
    updateExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, unknown>;
    conditionExpression?: string;
  } {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const nameCounter = { i: 0 };
    const valCounter = { i: 0 };
    const pathToName = new Map<string, string>();

    const ensureAttrName = (segment: string): string => {
      let n = pathToName.get(segment);
      if (!n) {
        n = `#u${nameCounter.i++}`;
        while (names[n]) n = `#u${nameCounter.i++}`;
        pathToName.set(segment, n);
        names[n] = segment;
      }
      return n;
    };
    const parsePath = (path: string): Array<string | number> => {
      const out: Array<string | number> = [];
      const parts = path.split(".");
      for (const part of parts) {
        const m = part.match(/^([^[\]]+)(.*)$/);
        if (!m) continue;
        out.push(m[1]!);
        let rest = m[2] ?? "";
        while (rest.length > 0) {
          const idx = rest.match(/^\[(\d+)\](.*)$/);
          if (!idx) break;
          out.push(Number(idx[1]));
          rest = idx[2] ?? "";
        }
      }
      return out;
    };
    const ensurePathExpr = (path: string): string => {
      const toks = parsePath(path);
      let expr = "";
      for (const t of toks) {
        if (typeof t === "number") {
          expr += `[${t}]`;
        } else {
          const n = ensureAttrName(t);
          expr = expr.length === 0 ? n : `${expr}.${n}`;
        }
      }
      return expr;
    };
    const nextValLocal = (): string => {
      let v = `:u${valCounter.i++}`;
      while (values[v]) v = `:u${valCounter.i++}`;
      return v;
    };

    const setParts: string[] = [];
    for (const [k, v] of Object.entries(this.setOps)) {
      const meta = this.runtime.fieldMeta[k];
      if (!meta) throw new ValidationError([{ path: k, message: "Unknown field in set()" }]);
      if (meta.isIdentity) throw new Error(`Cannot SET identity field: ${k}`);
      if (meta.immutable) throw new Error(`Cannot SET immutable field: ${k}`); // FieldMeta uses `immutable`
      if (meta.isVersion) throw new Error(`Cannot SET version field (use add()): ${k}`);
      const n = ensurePathExpr(meta.attrName);
      const val = nextValLocal();
      values[val] = v;
      setParts.push(`${n} = ${val}`);
    }

    for (const { path, value } of this.setPathOps) {
      const n = ensurePathExpr(path);
      const val = nextValLocal();
      values[val] = value;
      setParts.push(`${n} = ${val}`);
    }

    for (const { path, values: appendVals } of this.listAppendOps) {
      const n = ensurePathExpr(path);
      const val = nextValLocal();
      values[val] = appendVals;
      setParts.push(`${n} = list_append(${n}, ${val})`);
    }

    for (const { path, values: prependVals } of this.listPrependOps) {
      const n = ensurePathExpr(path);
      const val = nextValLocal();
      values[val] = prependVals;
      setParts.push(`${n} = list_append(${val}, ${n})`);
    }

    const addParts: string[] = [];
    for (const [k, v] of Object.entries(this.addOps)) {
      const meta = this.runtime.fieldMeta[k];
      if (!meta || !meta.allowAdd) throw new Error(`Field not eligible for ADD: ${k}`);
      const n = ensurePathExpr(meta.attrName);
      const val = nextValLocal();
      values[val] = v;
      addParts.push(`${n} ${val}`);
    }

    for (const { path, members } of this.setAddOps) {
      const n = ensurePathExpr(path);
      const val = nextValLocal();
      values[val] = members;
      addParts.push(`${n} ${val}`);
    }

    const removeParts = this.removeAttrs.map((k) => {
      const meta = this.runtime.fieldMeta[k];
      if (!meta) throw new Error(`Unknown field in remove(): ${k}`);
      if (!meta.allowRemove) throw new Error(`Field not removable: ${k}`);
      const n = ensurePathExpr(meta.attrName);
      return n;
    });
    for (const p of this.removePathAttrs) {
      removeParts.push(ensurePathExpr(p));
    }

    const deleteParts: string[] = [];
    for (const { path, members } of this.setDeleteOps) {
      const n = ensurePathExpr(path);
      const val = nextValLocal();
      values[val] = members;
      deleteParts.push(`${n} ${val}`);
    }

    const clauses: string[] = [];
    if (setParts.length) clauses.push(`SET ${setParts.join(", ")}`);
    if (removeParts.length) clauses.push(`REMOVE ${removeParts.join(", ")}`);
    if (addParts.length) clauses.push(`ADD ${addParts.join(", ")}`);
    if (deleteParts.length) clauses.push(`DELETE ${deleteParts.join(", ")}`);
    if (!clauses.length) throw new Error("Update has no SET, ADD, or REMOVE");

    let conditionExpression: string | undefined;
    if (this.userCond) {
      const pathToNameCond = new Map<string, string>();
      const nc = { i: 0 };
      const vc = { i: 0 };
      conditionExpression = compileCond(this.userCond, nc, vc, pathToNameCond, names, values);
    }

    return {
      updateExpression: clauses.join(" "),
      expressionAttributeNames: names,
      expressionAttributeValues: values,
      conditionExpression,
    };
  }
}
