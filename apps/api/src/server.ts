import { createServer } from "node:http";
import { logger } from "@ledger/observability";

export async function startServer(): Promise<void> {
  const port = Number(process.env.PORT ?? "3000");

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("bad request");
      return;
    }

    if (req.url === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  logger.info({ port }, "api listening");
}

