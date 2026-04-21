import type { AccessPatternDef, TableDef } from "./types.js";
import { createAccessPatternFactory } from "./access-pattern-factory.js";
import type { SchemaRecord } from "./fields.js";
import { buildFieldMetaMap } from "./fields.js";
import { listInternalAttrNames, type EntityRuntime } from "./entity-runtime.js";
import { ConfigurationError, ValidationError } from "./errors.js";

export const COMPILED_ENTITY = Symbol("compiledEntity");

export type CompiledEntity<
  S extends SchemaRecord = SchemaRecord,
  Id extends readonly (keyof S & string)[] = readonly (keyof S & string)[],
> = {
  readonly [COMPILED_ENTITY]: true;
  readonly runtime: EntityRuntime;
  /** Phantom: preserves `Id` for type-level consumers */
  readonly _identityKeys?: Id;
};

type KeyBuilder = (logical: Record<string, unknown>) => { pk: string; sk?: string };
type GsiEntry = { indexName: string; fn: (logical: Record<string, unknown>) => Record<string, string> };

interface EntityState<Name extends string, S extends SchemaRecord> {
  entityName: Name;
  schema: S;
  table?: TableDef;
  keyFn?: KeyBuilder;
  gsi: GsiEntry[];
  identityKeys?: readonly (keyof S & string)[];
}

function assertNoReservedLogicalNames(table: TableDef, schema: SchemaRecord): void {
  const reserved = listInternalAttrNames(table);
  const collisions = Object.keys(schema).filter((key) => reserved.has(key));
  if (collisions.length > 0) {
    throw new ValidationError(
      collisions.map((path) => ({
        path,
        message: `Field name is reserved for table metadata/index attributes and cannot be modeled as a logical field`,
      })),
    );
  }
}

export class EntityDraft<const Name extends string, const S extends SchemaRecord> {
  private readonly st: EntityState<Name, S>;

  constructor(name: Name, schema: S) {
    this.st = { entityName: name, schema, gsi: [] };
  }

  inTable<T extends TableDef>(table: T): EntityWithTable<Name, S, T> {
    this.st.table = table;
    return new EntityWithTable(this.st);
  }
}

class EntityWithTable<const Name extends string, const S extends SchemaRecord, T extends TableDef> {
  constructor(private readonly st: EntityState<Name, S>) {}

  keys(fn: (input: Record<string, unknown>) => { pk: string; sk?: string }): EntityWithKeys<Name, S, T> {
    this.st.keyFn = fn as KeyBuilder;
    return new EntityWithKeys(this.st);
  }
}

class EntityWithKeys<const Name extends string, const S extends SchemaRecord, T extends TableDef> {
  constructor(private readonly st: EntityState<Name, S>) {}

  index(
    indexName: (keyof NonNullable<T["indexes"]> | keyof NonNullable<T["localIndexes"]>) & string,
    fn: (input: Record<string, unknown>) => Record<string, string>,
  ): this {
    this.st.gsi.push({ indexName, fn });
    return this;
  }

  identity<const K extends readonly (keyof S & string)[]>(keys: K): EntityWithIdentity<Name, S, K> {
    this.st.identityKeys = keys;
    return new EntityWithIdentity(this.st);
  }
}

class EntityWithIdentity<const Name extends string, const S extends SchemaRecord, const Id extends readonly (keyof S & string)[]> {
  constructor(private readonly st: EntityState<Name, S>) {}

  accessPatterns(
    fn: (ap: ReturnType<typeof createAccessPatternFactory>) => Record<string, AccessPatternDef>,
  ): CompiledEntity<S, Id> {
    const table = this.st.table;
    const keyFn = this.st.keyFn;
    const identityKeys = this.st.identityKeys;
    if (!table || !keyFn || !identityKeys) {
      throw new ConfigurationError("entity: incomplete chain (inTable → keys → identity → accessPatterns)");
    }
    assertNoReservedLogicalNames(table, this.st.schema);
    const ap = createAccessPatternFactory(table, this.st.entityName);
    const raw = fn(ap);
    const patterns: AccessPatternDef[] = [];
    for (const name of Object.keys(raw)) {
      const def = raw[name];
      if (!def) continue;
      patterns.push({ ...def, name });
    }
    const fieldMeta = buildFieldMetaMap(this.st.schema, identityKeys);
    const runtime: EntityRuntime = {
      entityName: this.st.entityName,
      discriminatorValue: this.st.entityName,
      table,
      schema: this.st.schema,
      fieldMeta,
      identityKeys,
      buildTableKeys: keyFn,
      gsiProjections: this.st.gsi,
      accessPatterns: patterns,
    };
    return { [COMPILED_ENTITY]: true as const, runtime, _identityKeys: identityKeys } as CompiledEntity<S, Id>;
  }
}

export function entity<const Name extends string, const S extends SchemaRecord>(
  name: Name,
  schema: S,
): EntityDraft<Name, S> {
  return new EntityDraft(name, schema);
}
