import type { Brand } from "./brand.js";
import type { FieldScalarKind } from "./types.js";

export interface FieldDef {
  readonly _kind: FieldScalarKind;
  readonly _required: boolean;
  readonly _hasDefault: boolean;
  readonly isImmutable: boolean;
  readonly isVersion: boolean;
  readonly defaultFactory?: () => unknown;
  readonly enumValues?: readonly string[];
  readonly idPrefix?: string;
  readonly objectShape?: SchemaRecord;
  readonly recordValueField?: FieldDef;
  readonly listItemField?: FieldDef;
}

type FieldApi<T, Req extends boolean, HasDef extends boolean> = FieldDef & {
  required(): FieldApi<T, true, HasDef>;
  optional(): FieldApi<T, false, HasDef>;
  default(value: T | (() => T)): FieldApi<T, Req, true>;
  immutable(): FieldApi<T, Req, HasDef>;
  version(): FieldApi<T, Req, HasDef>;
};

function createField<T, Req extends boolean, HasDef extends boolean>(
  base: Omit<FieldDef, "_required" | "_hasDefault"> & { _required: Req; _hasDefault: HasDef },
): FieldApi<T, Req, HasDef> {
  const api = {
    ...base,
    required(): FieldApi<T, true, HasDef> {
      return createField({ ...base, _required: true });
    },
    optional(): FieldApi<T, false, HasDef> {
      return createField({ ...base, _required: false });
    },
    default(value: T | (() => T)): FieldApi<T, Req, true> {
      const factory = typeof value === "function" ? (value as () => T) : () => value;
      return createField({ ...base, _hasDefault: true, defaultFactory: factory });
    },
    immutable(): FieldApi<T, Req, HasDef> {
      return createField({ ...base, isImmutable: true });
    },
    version(): FieldApi<T, Req, HasDef> {
      return createField({ ...base, isVersion: true });
    },
  };
  return api as unknown as FieldApi<T, Req, HasDef>;
}

export function string(): FieldApi<string, false, false> {
  return createField({
    _kind: "string",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

export function number(): FieldApi<number, false, false> {
  return createField({
    _kind: "number",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

export function boolean(): FieldApi<boolean, false, false> {
  return createField({
    _kind: "boolean",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

/** ISO 8601 string in v0.1 */
export function datetime(): FieldApi<string, false, false> {
  return createField({
    _kind: "datetime",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

export function enumType<const T extends readonly string[]>(
  values: T,
): FieldApi<T[number], false, false> & { readonly _enumValues: T } {
  const f = createField({
    _kind: "enum" as const,
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
    enumValues: values,
  });
  return Object.assign(f, { _enumValues: values }) as FieldApi<T[number], false, false> & {
    readonly _enumValues: T;
  };
}

export function id<const P extends string>(
  prefix: P,
): FieldApi<Brand<string, `${P}Id`>, false, false> & { readonly _idPrefix: P } {
  const f = createField({
    _kind: "id" as const,
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
    idPrefix: prefix,
  });
  return Object.assign(f, { _idPrefix: prefix }) as FieldApi<Brand<string, `${P}Id`>, false, false> & {
    readonly _idPrefix: P;
  };
}

export function json<T = unknown>(): FieldApi<T, false, false> {
  return createField({
    _kind: "json",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

/** Unix epoch seconds for DynamoDB TTL attributes. */
export function ttl(): FieldApi<number, false, false> {
  return createField({
    _kind: "ttl",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

export function object<const S extends SchemaRecord>(
  shape: S,
): FieldApi<InferItem<S>, false, false> & { readonly _objectShape: S } {
  const f = createField({
    _kind: "object" as const,
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
    objectShape: shape,
  });
  return Object.assign(f, { _objectShape: shape }) as FieldApi<InferItem<S>, false, false> & {
    readonly _objectShape: S;
  };
}

export function record<const V extends FieldDef>(
  valueField: V,
): FieldApi<Record<string, FieldToValue<V>>, false, false> & { readonly _recordValue: V } {
  const f = createField({
    _kind: "record" as const,
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
    recordValueField: valueField,
  });
  return Object.assign(f, { _recordValue: valueField }) as FieldApi<Record<string, FieldToValue<V>>, false, false> & {
    readonly _recordValue: V;
  };
}

export function list<const V extends FieldDef>(
  itemField: V,
): FieldApi<readonly FieldToValue<V>[], false, false> & { readonly _listItem: V } {
  const f = createField({
    _kind: "list" as const,
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
    listItemField: itemField,
  });
  return Object.assign(f, { _listItem: itemField }) as FieldApi<readonly FieldToValue<V>[], false, false> & {
    readonly _listItem: V;
  };
}

export function stringSet(): FieldApi<ReadonlySet<string>, false, false> {
  return createField({
    _kind: "stringSet",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

export function numberSet(): FieldApi<ReadonlySet<number>, false, false> {
  return createField({
    _kind: "numberSet",
    _required: false,
    _hasDefault: false,
    isImmutable: false,
    isVersion: false,
  });
}

export type SchemaRecord = Record<string, FieldDef>;

type FieldToValue<F extends FieldDef> = F["_kind"] extends "string"
  ? string
  : F["_kind"] extends "number"
    ? number
    : F["_kind"] extends "boolean"
      ? boolean
      : F["_kind"] extends "datetime"
        ? string
        : F["_kind"] extends "enum"
          ? F extends { enumValues: readonly (infer E)[] }
            ? E
            : string
          : F["_kind"] extends "id"
            ? F extends { idPrefix: infer P extends string }
              ? Brand<string, `${P}Id`>
              : string
            : F["_kind"] extends "json"
              ? unknown
              : F["_kind"] extends "ttl"
                ? number
                : F["_kind"] extends "object"
                ? F extends { objectShape: infer O extends SchemaRecord }
                  ? InferItem<O>
                  : Record<string, unknown>
                : F["_kind"] extends "record"
                  ? F extends { recordValueField: infer V extends FieldDef }
                    ? Record<string, FieldToValue<V>>
                    : Record<string, unknown>
                  : F["_kind"] extends "list"
                    ? F extends { listItemField: infer V extends FieldDef }
                      ? readonly FieldToValue<V>[]
                      : readonly unknown[]
                    : F["_kind"] extends "stringSet"
                      ? ReadonlySet<string>
                      : F["_kind"] extends "numberSet"
                        ? ReadonlySet<number>
                        : unknown;

export type InferItem<S extends SchemaRecord> = {
  [K in keyof S]: S[K]["_required"] extends true
    ? FieldToValue<S[K]>
    : FieldToValue<S[K]> | undefined;
};

type RequiredKeysNoDefault<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends FieldDef
    ? S[K]["_required"] extends true
      ? S[K]["_hasDefault"] extends true
        ? never
        : K
      : never
    : never;
}[keyof S];

type OptionalOrDefaultKeys<S extends SchemaRecord> = Exclude<keyof S, RequiredKeysNoDefault<S>>;

export type CreateInput<S extends SchemaRecord> = Pick<InferItem<S>, RequiredKeysNoDefault<S> & keyof S> &
  Partial<Pick<InferItem<S>, OptionalOrDefaultKeys<S> & keyof S>>;

export type PrimaryKeyInput<S extends SchemaRecord, Id extends readonly (keyof S)[]> = Pick<
  InferItem<S>,
  Id[number] & keyof InferItem<S>
>;

type MutableFieldKeys<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends FieldDef
    ? S[K]["isImmutable"] extends true
      ? never
      : S[K]["isVersion"] extends true
        ? never
        : K
    : never;
}[keyof S];

/** SET targets: mutable fields excluding identity keys */
export type SettableShape<S extends SchemaRecord, Id extends readonly (keyof S)[]> = Pick<
  InferItem<S>,
  Exclude<MutableFieldKeys<S>, Id[number]> & keyof InferItem<S>
>;

export type AddableKeys<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends FieldDef
    ? S[K]["isVersion"] extends true
      ? S[K]["_kind"] extends "number"
        ? K
        : never
      : never
    : never;
}[keyof S];

/** Numeric ADD surface (disjoint from Settable: version counters only in v0.1) */
export type AddableShape<S extends SchemaRecord> = Pick<InferItem<S>, AddableKeys<S> & keyof InferItem<S>>;

export type RemovableKeys<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends FieldDef
    ? S[K]["_required"] extends false
      ? S[K]["isImmutable"] extends true
        ? never
        : S[K]["isVersion"] extends true
          ? never
          : K
      : never
    : never;
}[keyof S];

export interface FieldRef<T> {
  readonly __brand: "FieldRef";
  readonly path: string;
  readonly _phantom?: T;
}

export function fieldRef<T>(path: string): FieldRef<T> {
  return { __brand: "FieldRef", path };
}

export function pathRef<T>(base: FieldRef<unknown>, ...segments: ReadonlyArray<string | number>): FieldRef<T> {
  let path = base.path;
  for (const seg of segments) {
    path += typeof seg === "number" ? `[${seg}]` : `.${seg}`;
  }
  return fieldRef<T>(path);
}

/** Build FieldMeta map from schema + identity keys */
export function buildFieldMetaMap(
  schema: SchemaRecord,
  identityKeys: readonly string[],
): Record<string, import("./types.js").FieldMeta> {
  const out: Record<string, import("./types.js").FieldMeta> = {};
  for (const key of Object.keys(schema)) {
    const f = schema[key];
    if (!f) continue;
    const isIdentity = identityKeys.includes(key);
    const allowAdd = f.isVersion && f._kind === "number";
    const allowRemove =
      !isIdentity && !f.isVersion && !f.isImmutable && f._required === false && !f._hasDefault;
    out[key] = {
      attrName: key,
      kind: f._kind,
      required: f._required,
      isIdentity,
      immutable: f.isImmutable,
      hasDefault: f._hasDefault,
      defaultFactory: f.defaultFactory,
      isVersion: f.isVersion,
      isDerived: false,
      isInternalLogical: false,
      allowAdd,
      allowRemove: Boolean(allowRemove),
      enumValues: f.enumValues,
      idPrefix: f.idPrefix,
    };
  }
  return out;
}
