import type { FastifyInstance, RouteOptions } from "fastify";

export function enforceRouteSchemas(app: FastifyInstance): void {
  app.addHook("onRoute", (opts: RouteOptions) => {
    if (!opts.schema) {
      throw new Error(`Route ${String(opts.method)} ${opts.url} must define a schema (strict-by-default guardrail).`);
    }
  });
}

