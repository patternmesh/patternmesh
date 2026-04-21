import type { DynamoAdapter } from "./adapter.js";
import type { TableDef } from "./types.js";
import { COMPILED_ENTITY, type CompiledEntity } from "./entity.js";
import type { FieldRef } from "./fields.js";
import { ConfigurationError, ValidationError } from "./errors.js";
import { createRepository } from "./repository.js";
import { createTransactServices } from "./transact.js";
import { type ConditionExpr, conditionOpsImpl } from "./update.js";
import {
  applyRelations,
  createReadBundles,
  createRelations,
  createWriteRecipes,
  type ReadBundleBuilder,
  type ReadBundlesConfig,
  type RelationBuilder,
  type RelationsConfig,
  type WriteRecipeBuilder,
  type WriteRecipesConfig,
} from "./relations.js";

export interface ConnectOptions<E extends Record<string, CompiledEntity>> {
  readonly entities: E;
  readonly adapter: DynamoAdapter;
  readonly relations?: (r: RelationBuilder<E>) => RelationBuilder<E>;
  readonly readBundles?: (b: ReadBundleBuilder<E>) => ReadBundleBuilder<E>;
  readonly writeRecipes?: (b: WriteRecipeBuilder<E>) => WriteRecipeBuilder<E>;
}

type TransactBundle = ReturnType<typeof createTransactServices>;
type ConditionCheckFn = (fields: Record<string, FieldRef<unknown>>, op: typeof conditionOpsImpl) => unknown;

export type ConnectedDb<TTable extends TableDef, E extends Record<string, CompiledEntity>> = {
  readonly [K in keyof E]: ReturnType<typeof createRepository>;
} & {
  readonly table: TTable;
  readonly adapter: DynamoAdapter;
  /** Same compiled entities passed to `connect()`; useful for typing and `tx` participants. */
  readonly entities: E;
  readonly tx: TransactBundle["tx"];
  readonly explain: { readonly tx: TransactBundle["explain"] };
  readonly batchGet: (refs: Record<string, { entity: keyof E & string; key: Record<string, unknown> }>) => Promise<Record<string, unknown>>;
  readonly orchestrate: {
    /**
     * Explicit labeled cross-entity transaction bundle.
     * Callers control each participant; no hidden relation inference.
     */
    write: (
      fn: (o: {
        put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
        update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
        delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
        conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
      }) => void | Promise<void>,
      options?: { clientRequestToken?: string },
    ) => Promise<Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>>;
    /**
     * Explicit fan-out write primitive for materialized view maintenance.
     * Executes primary and fan-out participants in one transaction.
     */
    fanOut: (
      parts: {
        primary: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
        }) => void | Promise<void>;
        fanOut?: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
        }) => void | Promise<void>;
      },
      options?: { clientRequestToken?: string },
    ) => Promise<{
      primary: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>;
      fanOut: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>;
    }>;
    counterSummary: (
      parts: {
        primary: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
        }) => void | Promise<void>;
        summary?: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
        }) => void | Promise<void>;
      },
      options?: { clientRequestToken?: string },
    ) => Promise<{
      primary: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>;
      summary: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>;
    }>;
  };
  readonly read: {
    run: (
      bundleName: string,
      input: Record<string, unknown>,
      opts?: { maxSteps?: number; maxDepth?: number; fanOutCap?: number },
    ) => Promise<Record<string, unknown>>;
    explain: (
      bundleName: string,
      input: Record<string, unknown>,
      opts?: { maxSteps?: number; maxDepth?: number; fanOutCap?: number },
    ) => { readonly steps: readonly Record<string, unknown>[]; readonly warnings: readonly string[] };
  };
  readonly recipes: {
    run: (
      recipeName: string,
      input: Record<string, unknown>,
      options?: { clientRequestToken?: string },
    ) => Promise<Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>>;
    explain: (recipeName: string) => { readonly steps: readonly Record<string, unknown>[] };
  };
  readonly lifecycle: {
    softDelete: (spec: {
      label?: string;
      entity: CompiledEntity;
      key: Record<string, unknown>;
      deletedAtEpochSeconds: number;
      tombstone?: Record<string, unknown>;
      clientRequestToken?: string;
    }) => Promise<Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>>;
    archive: (spec: {
      archiveLabel?: string;
      sourceEntity: CompiledEntity;
      sourceKey: Record<string, unknown>;
      archiveEntity: CompiledEntity;
      archiveItem: Record<string, unknown>;
      sourceDisposition?: "mark" | "delete" | "none";
      markDeletedAtEpochSeconds?: number;
      markFields?: Record<string, unknown>;
      clientRequestToken?: string;
    }) => Promise<Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>>;
  };
};

function isCompiled(x: unknown): x is CompiledEntity {
  return typeof x === "object" && x !== null && COMPILED_ENTITY in x && (x as CompiledEntity)[COMPILED_ENTITY] === true;
}

export function connect<const T extends TableDef, const E extends Record<string, CompiledEntity>>(
  table: T,
  opts: ConnectOptions<E>,
): ConnectedDb<T, E> {
  if (opts.entities === undefined || typeof opts.entities !== "object") {
    throw new ConfigurationError("connect: entities is required");
  }
  const transact = createTransactServices(table, opts.adapter);
  const out: Record<string, unknown> = {
    table,
    adapter: opts.adapter,
    entities: opts.entities,
    tx: transact.tx,
    explain: { tx: transact.explain },
  };
  for (const key of Object.keys(opts.entities)) {
    const ent = opts.entities[key];
    if (!ent) continue;
    if (!isCompiled(ent)) {
      throw new ConfigurationError(`connect: entities.${String(key)} is not a compiled entity`);
    }
    if (ent.runtime.table !== table) {
      throw new ConfigurationError(
        `connect: entities.${String(key)} was compiled with a different table reference — pass the same defineTable() instance as connect()'s first argument`,
      );
    }
    out[key] = createRepository(ent.runtime, opts.adapter);
  }
  const rels: RelationsConfig = opts.relations ? createRelations(opts.entities, opts.relations) : [];
  const bundles: ReadBundlesConfig = opts.readBundles ? createReadBundles(opts.entities, opts.readBundles) : [];
  const recipes: WriteRecipesConfig = opts.writeRecipes ? createWriteRecipes(opts.entities, opts.writeRecipes) : [];
  if (rels.length > 0) {
    applyRelations(out, rels);
  }

  out.batchGet = async (refs: Record<string, { entity: keyof E & string; key: Record<string, unknown> }>) => {
    const result: Record<string, unknown> = {};
    for (const label of Object.keys(refs)) {
      const spec = refs[label];
      if (!spec) continue;
      const repo = out[spec.entity] as { get?: (key: Record<string, unknown>) => Promise<unknown> } | undefined;
      if (!repo?.get) {
        result[label] = null;
        continue;
      }
      result[label] = await repo.get(spec.key);
    }
    return result;
  };

  const runOrchestrationWrite = async (
    fn: (o: {
      put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
      update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
      delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
      conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
    }) => void | Promise<void>,
    options?: { clientRequestToken?: string },
  ) => {
    const labels: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }> = {};
    await transact.tx.write(async (w) => {
      await fn({
        put: (label, ent, input) => {
          labels[label] = { operation: "Put", entity: ent.runtime.entityName };
          w.put(ent, input);
        },
        update: (label, ent, key) => {
          labels[label] = { operation: "Update", entity: ent.runtime.entityName };
          return w.update(ent, key);
        },
        delete: (label, ent, key) => {
          labels[label] = { operation: "Delete", entity: ent.runtime.entityName };
          w.delete(ent, key);
        },
        conditionCheck: (label, ent, key, ifFn) => {
          labels[label] = { operation: "ConditionCheck", entity: ent.runtime.entityName };
          w.conditionCheck(ent, key, (fields, op) => ifFn(fields, op) as ConditionExpr);
        },
      });
    }, options);
    return labels;
  };

  const runOrchestrationFanOut = async (
    parts: {
      primary: (o: {
        put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
        update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
        delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
        conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
      }) => void | Promise<void>;
      fanOut?: (o: {
        put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
        update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
        delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
        conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => void;
      }) => void | Promise<void>;
    },
    options?: { clientRequestToken?: string },
  ) => {
    const primary: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }> = {};
    const fanOut: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }> = {};
    await transact.tx.write(async (w) => {
      const bind = (
        sink: Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>,
      ) => ({
        put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => {
          sink[label] = { operation: "Put", entity: ent.runtime.entityName };
          w.put(ent, input);
        },
        update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => {
          sink[label] = { operation: "Update", entity: ent.runtime.entityName };
          return w.update(ent, key);
        },
        delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => {
          sink[label] = { operation: "Delete", entity: ent.runtime.entityName };
          w.delete(ent, key);
        },
        conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: ConditionCheckFn) => {
          sink[label] = { operation: "ConditionCheck", entity: ent.runtime.entityName };
          w.conditionCheck(ent, key, (fields, op) => ifFn(fields, op) as ConditionExpr);
        },
      });
      await parts.primary(bind(primary));
      if (parts.fanOut) await parts.fanOut(bind(fanOut));
    }, options);
    return { primary, fanOut };
  };

  out.orchestrate = {
    write: async (
      fn: (o: {
        put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
        update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
        delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
        conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: (...args: unknown[]) => unknown) => void;
      }) => void | Promise<void>,
      options?: { clientRequestToken?: string },
    ) => runOrchestrationWrite(fn, options),
    fanOut: async (
      parts: {
        primary: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: (...args: unknown[]) => unknown) => void;
        }) => void | Promise<void>;
        fanOut?: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: (...args: unknown[]) => unknown) => void;
        }) => void | Promise<void>;
      },
      options?: { clientRequestToken?: string },
    ) => runOrchestrationFanOut(parts, options),
    counterSummary: async (
      parts: {
        primary: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: (...args: unknown[]) => unknown) => void;
        }) => void | Promise<void>;
        summary?: (o: {
          put: (label: string, ent: CompiledEntity, input: Record<string, unknown>) => void;
          update: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => unknown;
          delete: (label: string, ent: CompiledEntity, key: Record<string, unknown>) => void;
          conditionCheck: (label: string, ent: CompiledEntity, key: Record<string, unknown>, ifFn: (...args: unknown[]) => unknown) => void;
        }) => void | Promise<void>;
      },
      options?: { clientRequestToken?: string },
    ) => {
      const result = await runOrchestrationFanOut(
        { primary: parts.primary, fanOut: parts.summary },
        options,
      );
      return { primary: result.primary, summary: result.fanOut };
    },
  };

  out.lifecycle = {
    softDelete: async (spec: {
      label?: string;
      entity: CompiledEntity;
      key: Record<string, unknown>;
      deletedAtEpochSeconds: number;
      tombstone?: Record<string, unknown>;
      clientRequestToken?: string;
    }) =>
      runOrchestrationWrite(
        async ({ update }) => {
          const u = update(spec.label ?? "softDelete", spec.entity, spec.key) as {
            setPath: (path: string, value: unknown) => unknown;
          };
          u.setPath("deletedAt", spec.deletedAtEpochSeconds);
          for (const [k, v] of Object.entries(spec.tombstone ?? {})) {
            u.setPath(k, v);
          }
        },
        { clientRequestToken: spec.clientRequestToken },
      ),
    archive: async (spec: {
      archiveLabel?: string;
      sourceEntity: CompiledEntity;
      sourceKey: Record<string, unknown>;
      archiveEntity: CompiledEntity;
      archiveItem: Record<string, unknown>;
      sourceDisposition?: "mark" | "delete" | "none";
      markDeletedAtEpochSeconds?: number;
      markFields?: Record<string, unknown>;
      clientRequestToken?: string;
    }) =>
      runOrchestrationWrite(
        async ({ put, update, delete: del }) => {
          put(spec.archiveLabel ?? "archivePut", spec.archiveEntity, spec.archiveItem);
          if (spec.sourceDisposition === "delete") {
            del("archiveSourceDelete", spec.sourceEntity, spec.sourceKey);
            return;
          }
          if (spec.sourceDisposition === "mark") {
            const u = update("archiveSourceMark", spec.sourceEntity, spec.sourceKey) as {
              setPath: (path: string, value: unknown) => unknown;
            };
            if (spec.markDeletedAtEpochSeconds !== undefined) {
              u.setPath("deletedAt", spec.markDeletedAtEpochSeconds);
            }
            for (const [k, v] of Object.entries(spec.markFields ?? {})) {
              u.setPath(k, v);
            }
          }
        },
        { clientRequestToken: spec.clientRequestToken },
      ),
  };

  const bundleMap = new Map(bundles.map((b) => [b.name, b]));
  out.read = {
      run: async (
        bundleName: string,
        input: Record<string, unknown>,
        opts?: { maxSteps?: number; maxDepth?: number; fanOutCap?: number },
      ) => {
        const plan = bundleMap.get(bundleName);
        if (!plan) {
          throw new ValidationError([{ path: `read.bundle.${bundleName}`, message: "Unknown read bundle" }]);
        }
        const maxSteps = opts?.maxSteps ?? 20;
        if (plan.steps.length > maxSteps) {
          throw new ValidationError([{ path: `read.bundle.${bundleName}`, message: `Bundle exceeds maxSteps (${maxSteps})` }]);
        }
        const maxDepth = opts?.maxDepth ?? plan.maxDepth ?? 1;
        if (maxDepth > 1) {
          throw new ValidationError([{ path: `read.bundle.${bundleName}`, message: "Only one-hop bundles are supported in v0.6" }]);
        }
        const result: Record<string, unknown> = {};
        let fanout = 0;
        for (const step of plan.steps) {
          if (step.kind === "rootGet") {
            const repo = out[step.entity] as { get?: (k: Record<string, unknown>) => Promise<unknown> } | undefined;
            if (!repo?.get) throw new ValidationError([{ path: `read.bundle.${bundleName}.${step.label}`, message: "Entity repo/get not found" }]);
            result[step.label] = await repo.get(step.mapInput(input));
            continue;
          }
          if (step.kind === "rootPattern") {
            const repo = out[step.entity] as { find?: Record<string, (i: Record<string, unknown>) => Promise<unknown>> } | undefined;
            const fn = repo?.find?.[step.pattern];
            if (typeof fn !== "function") {
              throw new ValidationError([{ path: `read.bundle.${bundleName}.${step.label}`, message: `Unknown pattern "${step.pattern}"` }]);
            }
            result[step.label] = await fn(step.mapInput(input));
            const page = result[step.label] as { items?: readonly unknown[] };
            fanout += page.items?.length ?? 0;
            continue;
          }
          const rootRepo = out[step.root] as Record<string, unknown> | undefined;
          const rel = (rootRepo?.[step.alias] as Record<string, (i: Record<string, unknown>) => Promise<unknown>> | undefined) ?? undefined;
          const fn = rel?.[step.method];
          if (typeof fn !== "function") {
            throw new ValidationError([{ path: `read.bundle.${bundleName}.${step.label}`, message: `Unknown relation route "${step.root}.${step.alias}.${step.method}"` }]);
          }
          const val = await fn(step.mapInput(input));
          if (step.method === "list") {
            const page = val as { items?: readonly unknown[] };
            fanout += page.items?.length ?? 0;
            result[step.label] = page.items ?? [];
          } else if (step.method === "listTargets") {
            const arr = (val as readonly unknown[]) ?? [];
            fanout += arr.length;
            result[step.label] = arr;
          } else {
            result[step.label] = val ?? null;
          }
        }
        const cap = opts?.fanOutCap;
        if (cap !== undefined && fanout > cap) {
          throw new ValidationError([{ path: `read.bundle.${bundleName}`, message: `Bundle fanout ${fanout} exceeded cap ${cap}` }]);
        }
        return result;
      },
      explain: (
        bundleName: string,
        input: Record<string, unknown>,
        opts?: { maxSteps?: number; maxDepth?: number; fanOutCap?: number },
      ) => {
        const plan = bundleMap.get(bundleName);
        if (!plan) {
          throw new ValidationError([{ path: `read.bundle.${bundleName}`, message: "Unknown read bundle" }]);
        }
        const maxSteps = opts?.maxSteps ?? 20;
        const maxDepth = opts?.maxDepth ?? plan.maxDepth ?? 1;
        const warnings: string[] = [];
        if (plan.steps.length > maxSteps) warnings.push(`Step count ${plan.steps.length} exceeds maxSteps ${maxSteps}`);
        if (maxDepth > 1) warnings.push("Only one-hop bundles are supported in v0.6");
        const steps = plan.steps.map((step) => {
          if (step.kind === "rootGet") {
            return { label: step.label, kind: step.kind, entity: step.entity };
          }
          if (step.kind === "rootPattern") {
            if (step.pattern.toLowerCase().includes("scan")) {
              warnings.push(`Step "${step.label}" may be scan-backed; verify access-pattern cost.`);
            }
            return { label: step.label, kind: step.kind, entity: step.entity, pattern: step.pattern, input: step.mapInput(input) };
          }
          if (step.method === "list" || step.method === "listTargets") {
            warnings.push(`Step "${step.label}" is collection expansion; watch fanout cost.`);
          }
          return {
            label: step.label,
            kind: step.kind,
            root: step.root,
            alias: step.alias,
            method: step.method,
            input: step.mapInput(input),
          };
        });
        return { steps, warnings };
      },
    };

  const recipeMap = new Map(recipes.map((r) => [r.name, r]));
  out.recipes = {
      run: async (
        recipeName: string,
        input: Record<string, unknown>,
        options?: { clientRequestToken?: string },
      ) => {
        const recipe = recipeMap.get(recipeName);
        if (!recipe) throw new ValidationError([{ path: `recipes.${recipeName}`, message: "Unknown write recipe" }]);
        await transact.tx.write(async (w) => {
          for (const step of recipe.steps) {
            const ent = opts.entities[step.entity];
            if (!ent) throw new ValidationError([{ path: `recipes.${recipeName}.${step.label}`, message: `Unknown entity "${step.entity}"` }]);
            if (step.kind === "put") {
              w.put(ent, step.mapInput(input));
              continue;
            }
            if (step.kind === "delete") {
              w.delete(ent, step.mapKey(input));
              continue;
            }
            if (step.kind === "conditionCheck") {
              w.conditionCheck(ent, step.mapKey(input), (fields, op) => step.ifFn(fields, op) as ConditionExpr);
              continue;
            }
            const u = w.update(ent, step.mapKey(input));
            step.apply(u, input);
          }
        }, options);
        return recipe.steps.reduce<Record<string, { operation: "Put" | "Update" | "Delete" | "ConditionCheck"; entity: string }>>((acc, step) => {
          acc[step.label] = {
            operation:
              step.kind === "put"
                ? "Put"
                : step.kind === "delete"
                  ? "Delete"
                  : step.kind === "conditionCheck"
                    ? "ConditionCheck"
                    : "Update",
            entity: step.entity,
          };
          return acc;
        }, {});
      },
      explain: (recipeName: string) => {
        const recipe = recipeMap.get(recipeName);
        if (!recipe) throw new ValidationError([{ path: `recipes.${recipeName}`, message: "Unknown write recipe" }]);
        const steps = recipe.steps.map((step) => ({
          label: step.label,
          kind: step.kind,
          entity: step.entity,
        }));
        return { steps };
      },
    };

  return out as ConnectedDb<T, E>;
}
