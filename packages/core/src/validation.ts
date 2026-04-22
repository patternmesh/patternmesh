import { ValidationError } from "./errors.js";
import type { FieldMeta } from "./types.js";
import type { FieldDef, SchemaRecord } from "./fields.js";

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isJsonSerializable(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
    return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function validateByFieldDef(
  def: FieldDef,
  value: unknown,
  path: string,
  issues: { path: string; message: string }[],
): void {
  if (def._kind === "enum" && def.enumValues && !def.enumValues.includes(String(value))) {
    issues.push({ path, message: `Must be one of: ${def.enumValues.join(", ")}` });
    return;
  }
  if (def._kind === "number" && typeof value !== "number") {
    issues.push({ path, message: "Expected number" });
    return;
  }
  if (def._kind === "string" && typeof value !== "string") {
    issues.push({ path, message: "Expected string" });
    return;
  }
  if (def._kind === "boolean" && typeof value !== "boolean") {
    issues.push({ path, message: "Expected boolean" });
    return;
  }
  if (def._kind === "datetime" && typeof value !== "string") {
    issues.push({ path, message: "Expected string (ISO datetime)" });
    return;
  }
  if (
    def._kind === "datetime" &&
    (typeof value !== "string" || !ISO_DATETIME_RE.test(value) || Number.isNaN(Date.parse(value)))
  ) {
    issues.push({ path, message: "Expected ISO-8601 datetime string" });
    return;
  }
  if (def._kind === "id" && typeof value !== "string") {
    issues.push({ path, message: "Expected string id" });
    return;
  }
  if (def._kind === "json") {
    if (!isJsonSerializable(value)) {
      issues.push({ path, message: "Expected JSON-serializable value" });
    }
    return;
  }
  if (def._kind === "ttl") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      issues.push({ path, message: "Expected TTL epoch seconds as a non-negative integer number" });
    }
    return;
  }
  if (def._kind === "object") {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      value instanceof Set
    ) {
      issues.push({ path, message: "Expected object" });
      return;
    }
    const shape = def.objectShape ?? {};
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (!shape[k]) issues.push({ path: `${path}.${k}`, message: "Unknown object key" });
    }
    for (const k of Object.keys(shape)) {
      const child = shape[k]!;
      const childVal = obj[k];
      if (childVal === undefined) {
        if (child._required)
          issues.push({ path: `${path}.${k}`, message: "Required field missing" });
        continue;
      }
      validateByFieldDef(child, childVal, `${path}.${k}`, issues);
    }
    return;
  }
  if (def._kind === "record") {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      value instanceof Set
    ) {
      issues.push({ path, message: "Expected record object" });
      return;
    }
    const vDef = def.recordValueField;
    if (!vDef) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      validateByFieldDef(vDef, v, `${path}.${k}`, issues);
    }
    return;
  }
  if (def._kind === "list") {
    if (!Array.isArray(value)) {
      issues.push({ path, message: "Expected list (array)" });
      return;
    }
    const itemDef = def.listItemField;
    if (!itemDef) return;
    value.forEach((it, i) => validateByFieldDef(itemDef, it, `${path}[${i}]`, issues));
    return;
  }
  if (def._kind === "stringSet") {
    if (!(value instanceof Set)) {
      issues.push({ path, message: "Expected Set<string>" });
      return;
    }
    if (value.size === 0) {
      issues.push({ path, message: "Empty set is not allowed" });
      return;
    }
    for (const v of value) {
      if (typeof v !== "string") issues.push({ path, message: "Expected Set<string>" });
    }
    return;
  }
  if (def._kind === "numberSet") {
    if (!(value instanceof Set)) {
      issues.push({ path, message: "Expected Set<number>" });
      return;
    }
    if (value.size === 0) {
      issues.push({ path, message: "Empty set is not allowed" });
      return;
    }
    for (const v of value) {
      if (typeof v !== "number") issues.push({ path, message: "Expected Set<number>" });
    }
  }
}

export function assertStrictKeys(
  input: Record<string, unknown>,
  allowed: Set<string>,
  context: string,
): void {
  const issues: { path: string; message: string }[] = [];
  for (const k of Object.keys(input)) {
    if (!allowed.has(k)) {
      issues.push({ path: k, message: `Unknown key in ${context}` });
    }
  }
  if (issues.length) throw new ValidationError(issues);
}

export function validateAndApplyDefaults(
  input: Record<string, unknown>,
  schema: SchemaRecord,
  fieldMeta: Record<string, FieldMeta>,
): Record<string, unknown> {
  assertStrictKeys(input, new Set(Object.keys(schema)), "create input");
  const out: Record<string, unknown> = { ...input };
  const issues: { path: string; message: string }[] = [];

  for (const key of Object.keys(schema)) {
    const meta = fieldMeta[key];
    if (!meta) {
      issues.push({ path: key, message: "Internal: missing field metadata" });
      continue;
    }
    const v = out[key];

    if (v === undefined) {
      if (meta.hasDefault && meta.defaultFactory) {
        out[key] = meta.defaultFactory();
      } else if (meta.required) {
        issues.push({ path: key, message: "Required field missing" });
      }
      continue;
    }

    const def = schema[key];
    if (def) validateByFieldDef(def, v, key, issues);
  }

  if (issues.length) throw new ValidationError(issues);
  return out;
}
