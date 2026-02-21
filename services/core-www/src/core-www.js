"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

// Shared libs (docker) or local fallback
let makeLogger, readJson, nowIso;
try {
  ({ makeLogger } = require("/core/shared/core-logger"));
  ({ readJson, nowIso } = require("/core/shared/core-utils"));
} catch {
  ({ makeLogger } = require("./core-logger"));
  ({ readJson, nowIso } = require("./core-utils"));
}

const SERVICE_NAME = process.env.SERVICE_NAME || "core-www";
const PORT = Number(process.env.PORT || 3000);

const LOG_PATH = process.env.LOG_PATH || path.join(process.cwd(), "logs");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const PUBLIC_PATH = process.env.PUBLIC_PATH || path.join(process.cwd(), "public");
const DEFAULT_PAGE = process.env.DEFAULT_PAGE || "index.html";
const CONFIG_PATH = process.env.CONFIG_PATH || "";

function safeReadConfig(configPath) {
  try {
    if (!configPath) return null;
    if (!fs.existsSync(configPath)) return { error: "CONFIG_PATH not found", path: configPath };
    return readJson(configPath);
  } catch (e) {
    return { error: "Failed to parse config JSON", message: e.message };
  }
}

const logger = makeLogger({
  serviceName: SERVICE_NAME,
  logPath: LOG_PATH,
  level: LOG_LEVEL,
  toConsole: true,
  toTextFile: true,
});

const app = express();
app.disable("x-powered-by");

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: SERVICE_NAME, now: nowIso() });
});

app.get("/meta", (req, res) => {
  res.json({
    service: SERVICE_NAME,
    now: nowIso(),
    publicPath: PUBLIC_PATH,
    defaultPage: DEFAULT_PAGE,
    configPath: CONFIG_PATH || null,
    config: safeReadConfig(CONFIG_PATH),
  });
});

// Static file serving (NO SPA fallback)
if (PUBLIC_PATH && fs.existsSync(PUBLIC_PATH)) {
  app.use(
    express.static(PUBLIC_PATH, {
      index: DEFAULT_PAGE
    })
  );

  // If file not found, return proper 404
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: "Not Found"
    });
  });
} else {
  logger.warn(`PUBLIC_PATH does not exist: ${PUBLIC_PATH}`);
  app.get("*", (req, res) =>
    res.status(500).json({ ok: false, error: "PUBLIC_PATH missing" })
  );
}

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Listening on port ${PORT}`);
});

// Graceful shutdown
function shutdown(signal) {
  logger.warn(`Received ${signal}, shutting down...`);
  server.close(() => {
    logger.info("Server closed. Bye!");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Force exit after timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));