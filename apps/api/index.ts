import { serve } from "@hono/node-server";
import { app } from "./src/app.ts";
import { config } from "./src/config.ts";
import { logger } from "./src/shared/logger.ts";

serve({ fetch: app.fetch, port: config.port });

logger.info("api started", {
  port: config.port,
  nodeEnv: config.nodeEnv,
  corsOrigins: config.corsOrigins,
});
