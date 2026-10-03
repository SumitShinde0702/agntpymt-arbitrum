import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, rootDir } from "./config.js";
import { apiRouter } from "./routes/api.js";
import { mcpRouter } from "./routes/mcp.js";
import { apiAuthMiddleware, installClerkMiddleware } from "./middleware/auth.js";
import { eq, getDb, schema } from "@agntpymt/db";
import { syncAllProvisionedProfileMcp, syncHermesGatewayMcpConfig, getHermesHomeDir, migrateLegacyHermesProfiles, ensureAllHermesProfiles } from "./services/hermes-profile.js";
import { mcpHttpRouter } from "./mcp/http-router.js";

async function main() {
  const { getDb: initDb } = await import("@agntpymt/db");
  initDb();

  if (env.hermesEnabled) try {
    await migrateLegacyHermesProfiles();
    const provisionedCount = await ensureAllHermesProfiles(env.orgId);
    const db = getDb();
    const provisioned = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.hermesProvisioned, true))
      .limit(1);
    const gatewayAgentId = provisioned[0]?.id ?? "";
    await syncHermesGatewayMcpConfig(gatewayAgentId);
    const n = await syncAllProvisionedProfileMcp();
    console.log(
      `Synced agntpymt MCP config (${getHermesHomeDir()}/config.yaml, + ${n} agent profile(s); provisioned ${provisionedCount} this boot)`
    );
  } catch (err) {
    console.warn("Could not sync Hermes MCP config:", err);
  }

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());
  app.use("/mcp", mcpHttpRouter());
  app.use(installClerkMiddleware());
  if (env.simulatePayments) {
    console.log("Payment mode: SIMULATED (x402 middleware skipped)");
  } else {
    try {
      const { createX402Middleware, warnIfPayToNotWhitelisted } = await import("./chain/x402.js");
      app.use(await createX402Middleware());
      void warnIfPayToNotWhitelisted();
      console.log(`Payment mode: x402 via ${env.facilitatorUrl}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  app.use("/api/mcp", mcpRouter);
  app.use("/api", apiAuthMiddleware, apiRouter);

  const clientDist = path.join(rootDir, "client", "dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  const server = app.listen(env.port, () => {
    console.log(`AgntPymt API running on http://localhost:${env.port}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${env.port} is already in use — an old server is still running.\n` +
          `Stop it with Ctrl+C on the previous terminal, or run: taskkill /F /IM node.exe (closes all Node processes).`
      );
      process.exit(1);
    }
    throw err;
  });
}

main().catch(console.error);
