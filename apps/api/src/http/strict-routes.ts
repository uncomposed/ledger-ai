import type { FastifyInstance, RouteOptions } from "fastify";

export function enforceRouteSchemas(app: FastifyInstance): void {
  app.addHook("onRoute", (opts: RouteOptions) => {
    const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
    if (methods.includes("OPTIONS") || methods.includes("HEAD")) return;

    if (!opts.schema) {
      throw new Error(`Route ${String(opts.method)} ${opts.url} must define a schema (strict-by-default guardrail).`);
    }

    const authMode = (opts.config as any)?.auth;
    if (authMode !== "public" && authMode !== "actor" && authMode !== "entity") {
      throw new Error(
        `Route ${String(opts.method)} ${opts.url} must set config.auth to "public" | "actor" | "entity" (auth guardrail).`,
      );
    }
  });
}
