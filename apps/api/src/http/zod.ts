import {
  serializerCompiler as baseSerializerCompiler,
  validatorCompiler as baseValidatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";

export function zStrictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

function unwrap(schema: unknown): unknown {
  // biome-ignore lint/suspicious/noExplicitAny: zod internals
  const def = (schema as any)?._def;
  const typeName = def?.typeName as string | undefined;

  switch (typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodBranded":
    case "ZodReadonly":
      return def.innerType;
    case "ZodEffects":
    case "ZodPipeline":
      return def.schema;
    case "ZodLazy":
      return def.getter();
    default:
      return schema;
  }
}

function assertAllObjectsStrict(schema: unknown, seen = new Set<unknown>()) {
  const s = unwrap(schema);
  if (seen.has(s)) return;
  seen.add(s);

  // biome-ignore lint/suspicious/noExplicitAny: zod internals
  const def = (s as any)?._def;
  const typeName = def?.typeName as string | undefined;

  switch (typeName) {
    case "ZodObject": {
      if (def.unknownKeys !== "strict") {
        throw new Error("Zod object schemas must use .strict() (reject unknown fields).");
      }
      const shape = def.shape();
      for (const value of Object.values(shape)) {
        assertAllObjectsStrict(value, seen);
      }
      return;
    }
    case "ZodArray":
      assertAllObjectsStrict(def.type, seen);
      return;
    case "ZodTuple":
      for (const item of def.items as unknown[]) assertAllObjectsStrict(item, seen);
      return;
    case "ZodUnion":
      for (const opt of def.options as unknown[]) assertAllObjectsStrict(opt, seen);
      return;
    case "ZodDiscriminatedUnion":
      for (const opt of def.options.values() as Iterable<unknown>) assertAllObjectsStrict(opt, seen);
      return;
    case "ZodIntersection":
      assertAllObjectsStrict(def.left, seen);
      assertAllObjectsStrict(def.right, seen);
      return;
    case "ZodRecord":
      assertAllObjectsStrict(def.valueType, seen);
      return;
    case "ZodMap":
      assertAllObjectsStrict(def.keyType, seen);
      assertAllObjectsStrict(def.valueType, seen);
      return;
    case "ZodSet":
      assertAllObjectsStrict(def.valueType, seen);
      return;
    default:
      return;
  }
}

export const strictValidatorCompiler = (req: any) => {
  assertAllObjectsStrict(req?.schema);
  return (baseValidatorCompiler as any)(req);
};

export const strictSerializerCompiler = (req: any) => {
  assertAllObjectsStrict(req?.schema);
  return (baseSerializerCompiler as any)(req);
};
