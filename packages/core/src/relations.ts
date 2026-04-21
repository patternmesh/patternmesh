import type { CompiledEntity } from "./entity.js";
import { ValidationError } from "./errors.js";
import type { FieldRef } from "./fields.js";
import { conditionOpsImpl } from "./update.js";

type EntityMap = Record<string, CompiledEntity>;
type ConditionCheckFn = (fields: Record<string, FieldRef<unknown>>, op: typeof conditionOpsImpl) => unknown;

export type HasManyDecl = {
  readonly kind: "hasMany";
  readonly root: string;
  readonly alias: string;
  readonly target: string;
  readonly listPattern: string;
  readonly mapCreate?: (input: Record<string, unknown>) => Record<string, unknown>;
};

export type BelongsToDecl = {
  readonly kind: "belongsTo";
  readonly source: string;
  readonly alias: string;
  readonly target: string;
  readonly mapGet: (input: Record<string, unknown>) => Record<string, unknown>;
};

export type HasManyThroughDecl = {
  readonly kind: "hasManyThrough";
  readonly root: string;
  readonly alias: string;
  readonly through: string;
  readonly target: string;
  readonly listPattern: string;
  readonly mapTargetKey: (throughItem: Record<string, unknown>) => Record<string, unknown>;
  readonly mapAdd?: (input: Record<string, unknown>) => Record<string, unknown>;
};

export type RelationDecl = HasManyDecl | BelongsToDecl | HasManyThroughDecl;

export type RelationsConfig = readonly RelationDecl[];

export type ReadBundleStepDecl =
  | {
      readonly kind: "rootGet";
      readonly label: string;
      readonly entity: string;
      readonly mapInput: (input: Record<string, unknown>) => Record<string, unknown>;
    }
  | {
      readonly kind: "rootPattern";
      readonly label: string;
      readonly entity: string;
      readonly pattern: string;
      readonly mapInput: (input: Record<string, unknown>) => Record<string, unknown>;
    }
  | {
      readonly kind: "relation";
      readonly label: string;
      readonly root: string;
      readonly alias: string;
      readonly method: "get" | "list" | "listTargets";
      readonly mapInput: (input: Record<string, unknown>) => Record<string, unknown>;
    };

export type ReadBundleDecl = {
  readonly name: string;
  readonly maxDepth?: number;
  readonly steps: readonly ReadBundleStepDecl[];
};

export type ReadBundlesConfig = readonly ReadBundleDecl[];

export type WriteRecipeStepDecl =
  | {
      readonly kind: "put";
      readonly label: string;
      readonly entity: string;
      readonly mapInput: (input: Record<string, unknown>) => Record<string, unknown>;
    }
  | {
      readonly kind: "delete";
      readonly label: string;
      readonly entity: string;
      readonly mapKey: (input: Record<string, unknown>) => Record<string, unknown>;
    }
  | {
      readonly kind: "conditionCheck";
      readonly label: string;
      readonly entity: string;
      readonly mapKey: (input: Record<string, unknown>) => Record<string, unknown>;
      readonly ifFn: ConditionCheckFn;
    }
  | {
      readonly kind: "update";
      readonly label: string;
      readonly entity: string;
      readonly mapKey: (input: Record<string, unknown>) => Record<string, unknown>;
      readonly apply: (u: unknown, input: Record<string, unknown>) => void;
    };

export type WriteRecipeDecl = {
  readonly name: string;
  readonly steps: readonly WriteRecipeStepDecl[];
};

export type WriteRecipesConfig = readonly WriteRecipeDecl[];

export class RelationBuilder<E extends EntityMap> {
  private readonly rels: RelationDecl[] = [];

  hasMany(
    root: keyof E & string,
    alias: string,
    opts: {
      target: keyof E & string;
      listPattern: string;
      mapCreate?: (input: Record<string, unknown>) => Record<string, unknown>;
    },
  ): this {
    this.rels.push({
      kind: "hasMany",
      root,
      alias,
      target: opts.target,
      listPattern: opts.listPattern,
      mapCreate: opts.mapCreate,
    });
    return this;
  }

  belongsTo(
    source: keyof E & string,
    alias: string,
    opts: { target: keyof E & string; mapGet: (input: Record<string, unknown>) => Record<string, unknown> },
  ): this {
    this.rels.push({
      kind: "belongsTo",
      source,
      alias,
      target: opts.target,
      mapGet: opts.mapGet,
    });
    return this;
  }

  hasManyThrough(
    root: keyof E & string,
    alias: string,
    opts: {
      through: keyof E & string;
      target: keyof E & string;
      listPattern: string;
      mapTargetKey: (throughItem: Record<string, unknown>) => Record<string, unknown>;
      mapAdd?: (input: Record<string, unknown>) => Record<string, unknown>;
    },
  ): this {
    this.rels.push({
      kind: "hasManyThrough",
      root,
      alias,
      through: opts.through,
      target: opts.target,
      listPattern: opts.listPattern,
      mapTargetKey: opts.mapTargetKey,
      mapAdd: opts.mapAdd,
    });
    return this;
  }

  build(): RelationsConfig {
    return [...this.rels];
  }
}

export class ReadBundleStepBuilder<E extends EntityMap> {
  private readonly steps: ReadBundleStepDecl[] = [];
  private readonly labels = new Set<string>();
  constructor(private readonly entities: E) {}

  private assertLabel(label: string): void {
    if (this.labels.has(label)) {
      throw new ValidationError([{ path: `readBundle.${label}`, message: "Duplicate bundle label" }]);
    }
    this.labels.add(label);
  }

  private assertEntity(entity: keyof E & string, path: string): void {
    if (!this.entities[entity]) {
      throw new ValidationError([{ path, message: `Unknown entity "${String(entity)}"` }]);
    }
  }

  rootGet(label: string, entity: keyof E & string, mapInput: (input: Record<string, unknown>) => Record<string, unknown>): this {
    this.assertLabel(label);
    this.assertEntity(entity, `readBundle.${label}.entity`);
    this.steps.push({ kind: "rootGet", label, entity, mapInput });
    return this;
  }

  rootPattern(
    label: string,
    entity: keyof E & string,
    pattern: string,
    mapInput: (input: Record<string, unknown>) => Record<string, unknown>,
  ): this {
    this.assertLabel(label);
    this.assertEntity(entity, `readBundle.${label}.entity`);
    this.steps.push({ kind: "rootPattern", label, entity, pattern, mapInput });
    return this;
  }

  relation(
    label: string,
    root: keyof E & string,
    alias: string,
    method: "get" | "list" | "listTargets",
    mapInput: (input: Record<string, unknown>) => Record<string, unknown>,
  ): this {
    this.assertLabel(label);
    this.assertEntity(root, `readBundle.${label}.root`);
    this.steps.push({ kind: "relation", label, root, alias, method, mapInput });
    return this;
  }

  build(): readonly ReadBundleStepDecl[] {
    return [...this.steps];
  }
}

export class ReadBundleBuilder<E extends EntityMap> {
  private readonly bundles: ReadBundleDecl[] = [];
  private readonly names = new Set<string>();
  constructor(private readonly entities: E) {}

  bundle(
    name: string,
    fn: (b: ReadBundleStepBuilder<E>) => ReadBundleStepBuilder<E>,
    opts?: { maxDepth?: number },
  ): this {
    if (this.names.has(name)) {
      throw new ValidationError([{ path: `readBundle.${name}`, message: "Duplicate bundle name" }]);
    }
    this.names.add(name);
    const built = fn(new ReadBundleStepBuilder(this.entities)).build();
    this.bundles.push({ name, steps: built, maxDepth: opts?.maxDepth });
    return this;
  }

  build(): ReadBundlesConfig {
    return [...this.bundles];
  }
}

export class WriteRecipeStepBuilder<E extends EntityMap> {
  private readonly steps: WriteRecipeStepDecl[] = [];
  private readonly labels = new Set<string>();
  constructor(private readonly entities: E) {}

  private assertLabel(label: string): void {
    if (this.labels.has(label)) {
      throw new ValidationError([{ path: `writeRecipe.${label}`, message: "Duplicate recipe label" }]);
    }
    this.labels.add(label);
  }

  private assertEntity(entity: keyof E & string, path: string): void {
    if (!this.entities[entity]) {
      throw new ValidationError([{ path, message: `Unknown entity "${String(entity)}"` }]);
    }
  }

  put(label: string, entity: keyof E & string, mapInput: (input: Record<string, unknown>) => Record<string, unknown>): this {
    this.assertLabel(label);
    this.assertEntity(entity, `writeRecipe.${label}.entity`);
    this.steps.push({ kind: "put", label, entity, mapInput });
    return this;
  }

  delete(label: string, entity: keyof E & string, mapKey: (input: Record<string, unknown>) => Record<string, unknown>): this {
    this.assertLabel(label);
    this.assertEntity(entity, `writeRecipe.${label}.entity`);
    this.steps.push({ kind: "delete", label, entity, mapKey });
    return this;
  }

  conditionCheck(
    label: string,
    entity: keyof E & string,
    mapKey: (input: Record<string, unknown>) => Record<string, unknown>,
    ifFn: ConditionCheckFn,
  ): this {
    this.assertLabel(label);
    this.assertEntity(entity, `writeRecipe.${label}.entity`);
    this.steps.push({ kind: "conditionCheck", label, entity, mapKey, ifFn });
    return this;
  }

  update(
    label: string,
    entity: keyof E & string,
    mapKey: (input: Record<string, unknown>) => Record<string, unknown>,
    apply: (u: unknown, input: Record<string, unknown>) => void,
  ): this {
    this.assertLabel(label);
    this.assertEntity(entity, `writeRecipe.${label}.entity`);
    this.steps.push({ kind: "update", label, entity, mapKey, apply });
    return this;
  }

  build(): readonly WriteRecipeStepDecl[] {
    return [...this.steps];
  }
}

export class WriteRecipeBuilder<E extends EntityMap> {
  private readonly recipes: WriteRecipeDecl[] = [];
  private readonly names = new Set<string>();
  constructor(private readonly entities: E) {}

  recipe(name: string, fn: (b: WriteRecipeStepBuilder<E>) => WriteRecipeStepBuilder<E>): this {
    if (this.names.has(name)) {
      throw new ValidationError([{ path: `writeRecipe.${name}`, message: "Duplicate recipe name" }]);
    }
    this.names.add(name);
    this.recipes.push({ name, steps: fn(new WriteRecipeStepBuilder(this.entities)).build() });
    return this;
  }

  build(): WriteRecipesConfig {
    return [...this.recipes];
  }
}

export function createRelations<E extends EntityMap>(
  entities: E,
  fn: (r: RelationBuilder<E>) => RelationBuilder<E>,
): RelationsConfig {
  void entities;
  return fn(new RelationBuilder<E>()).build();
}

export function createReadBundles<E extends EntityMap>(
  entities: E,
  fn: (b: ReadBundleBuilder<E>) => ReadBundleBuilder<E>,
): ReadBundlesConfig {
  return fn(new ReadBundleBuilder(entities)).build();
}

export function createWriteRecipes<E extends EntityMap>(
  entities: E,
  fn: (b: WriteRecipeBuilder<E>) => WriteRecipeBuilder<E>,
): WriteRecipesConfig {
  return fn(new WriteRecipeBuilder(entities)).build();
}

function assertPatternExists(repo: Record<string, unknown>, patternName: string, path: string): void {
  const findObj = repo.find as Record<string, unknown> | undefined;
  const maybeFn = findObj?.[patternName];
  if (typeof maybeFn !== "function") {
    throw new ValidationError([{ path, message: `Unknown access pattern "${patternName}"` }]);
  }
}

export function applyRelations(
  dbOut: Record<string, unknown>,
  rels: RelationsConfig,
): void {
  for (const rel of rels) {
    if (rel.kind === "hasMany") {
      const rootRepo = dbOut[rel.root] as Record<string, unknown> | undefined;
      const targetRepo = dbOut[rel.target] as Record<string, unknown> | undefined;
      if (!rootRepo || !targetRepo) {
        throw new ValidationError([{ path: `relations.${rel.root}.${rel.alias}`, message: `Unknown relation entity reference "${rel.root}" or "${rel.target}"` }]);
      }
      if (rootRepo[rel.alias] !== undefined) {
        throw new ValidationError([{ path: `relations.${rel.root}.${rel.alias}`, message: "Alias collision on root namespace" }]);
      }
      assertPatternExists(targetRepo, rel.listPattern, `relations.${rel.root}.${rel.alias}.listPattern`);
      const listFn = (targetRepo.find as Record<string, (input: Record<string, unknown>) => Promise<unknown>>)[rel.listPattern]!;
      rootRepo[rel.alias] = {
        list: (input: Record<string, unknown>) => listFn(input),
        add:
          typeof targetRepo.create === "function" && rel.mapCreate
            ? (input: Record<string, unknown>) =>
                (targetRepo.create as (input: Record<string, unknown>) => Promise<unknown>)(rel.mapCreate!(input))
            : undefined,
        create:
          typeof targetRepo.create === "function" && rel.mapCreate
            ? (input: Record<string, unknown>) =>
                (targetRepo.create as (input: Record<string, unknown>) => Promise<unknown>)(rel.mapCreate!(input))
            : undefined,
      };
      continue;
    }

    if (rel.kind === "belongsTo") {
      const sourceRepo = dbOut[rel.source] as Record<string, unknown> | undefined;
      const targetRepo = dbOut[rel.target] as Record<string, unknown> | undefined;
      if (!sourceRepo || !targetRepo) {
        throw new ValidationError([{ path: `relations.${rel.source}.${rel.alias}`, message: `Unknown relation entity reference "${rel.source}" or "${rel.target}"` }]);
      }
      if (sourceRepo[rel.alias] !== undefined) {
        throw new ValidationError([{ path: `relations.${rel.source}.${rel.alias}`, message: "Alias collision on source namespace" }]);
      }
      sourceRepo[rel.alias] = {
        get:
          typeof targetRepo.get === "function"
            ? (input: Record<string, unknown>) =>
                (targetRepo.get as (input: Record<string, unknown>) => Promise<unknown>)(rel.mapGet(input))
            : undefined,
      };
      continue;
    }

    const rootRepo = dbOut[rel.root] as Record<string, unknown> | undefined;
    const throughRepo = dbOut[rel.through] as Record<string, unknown> | undefined;
    const targetRepo = dbOut[rel.target] as Record<string, unknown> | undefined;
    if (!rootRepo || !throughRepo || !targetRepo) {
      throw new ValidationError([
        { path: `relations.${rel.root}.${rel.alias}`, message: `Unknown relation entity reference "${rel.root}", "${rel.through}", or "${rel.target}"` },
      ]);
    }
    if (rootRepo[rel.alias] !== undefined) {
      throw new ValidationError([{ path: `relations.${rel.root}.${rel.alias}`, message: "Alias collision on root namespace" }]);
    }
    assertPatternExists(throughRepo, rel.listPattern, `relations.${rel.root}.${rel.alias}.listPattern`);
    const listFn = (throughRepo.find as Record<string, (input: Record<string, unknown>) => Promise<unknown>>)[rel.listPattern]!;
    rootRepo[rel.alias] = {
      list: (input: Record<string, unknown>) => listFn(input),
      listTargets: async (input: Record<string, unknown>) => {
        const throughPage = (await listFn(input)) as { items?: readonly Record<string, unknown>[] };
        const keys = (throughPage.items ?? []).map((it) => rel.mapTargetKey(it));
        if (typeof targetRepo.batchGet === "function") {
          return (targetRepo.batchGet as (keys: readonly Record<string, unknown>[]) => Promise<unknown>)(keys);
        }
        return [];
      },
      add:
        typeof throughRepo.create === "function" && rel.mapAdd
          ? (input: Record<string, unknown>) =>
              (throughRepo.create as (input: Record<string, unknown>) => Promise<unknown>)(rel.mapAdd!(input))
          : undefined,
    };
  }
}
