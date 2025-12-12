import Fastify from "fastify";
import { z } from "zod";
import { logger } from "@ledger/observability";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

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

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({ ok: z.literal(true) }).strict(),
        },
      },
    },
    async () => ({ ok: true }),
  );

  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "api listening");
}
