import Fastify from "fastify";
import { z } from "zod";
import { logger } from "@ledger/observability";
import {
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { strictSerializerCompiler, strictValidatorCompiler, zStrictObject } from "./http/zod.js";

export async function startServer(): Promise<void> {
  const port = Number(process.env.PORT ?? "3000");
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        allErrors: true,
      },
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(strictValidatorCompiler);
  app.setSerializerCompiler(strictSerializerCompiler);

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: zStrictObject({ ok: z.literal(true) }),
        },
      },
    },
    async () => ({ ok: true }),
  );

  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "api listening");
}
