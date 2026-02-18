const express = require("express");
const path = require("path");
const { makeLogger } = require("/core/shared/core-logger");
const { readJson } = require("/core/shared/core-utils");

const SERVICE_NAME = process.env.SERVICE_NAME || "core-www";
const PORT = Number(process.env.PORT || 3000);
const CONFIG_PATH = process.env.CONFIG_PATH;
const LOG_PATH = process.env.LOG_PATH;
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const PUBLIC_PATH = process.env.PUBLIC_PATH || path.join(process.cwd(), "public");

const logger = makeLogger({ serviceName: SERVICE_NAME, logPath: LOG_PATH, level: LOG_LEVEL });

let config = {};
try {
  if (CONFIG_PATH) config = readJson(CONFIG_PATH);
} catch (e) {
  logger.warn("Failed to load config; continuing with defaults", { error: String(e) });
}

const app = express();
const TLS = {
  key: fs.readFileSync(process.env.TLS_KEY_PATH || "/core/core-www/config/cert.key"),
  cert: fs.readFileSync(process.env.TLS_CERT_PATH || "/core/core-www/config/cert.crt"),
};
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();

  const reqMeta = {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };

  // Optional: small/safe-ish JSON body preview (truncated). Avoid logging secrets in production.
  let bodyPreview;
  if (req.is("application/json") && req.body && Object.keys(req.body).length) {
    try {
      const s = JSON.stringify(req.body);
      bodyPreview = s.length > 2048 ? s.slice(0, 2048) + "...(truncated)" : s;
    } catch {
      bodyPreview = "[unserializable body]";
    }
  }

  res.on("finish", () => {
    const ms = Date.now() - start;
    const meta = {
      ...reqMeta,
      status: res.statusCode,
      ms,
      ...(bodyPreview ? { bodyPreview } : {}),
    };

    // Use debug so you can turn it on/off via LOG_LEVEL
    logger.debug("HTTP request", meta);
  });

  next();
});

app.use("/", express.static(PUBLIC_PATH));

app.get("/health", (req, res) => res.json({ service: SERVICE_NAME, ok: true }));

app.use((req, res) => {
  const file = path.join(PUBLIC_PATH, "404.html");

  res.status(404);

  // If custom file exists → serve it
  res.sendFile(file, (err) => {
    if (err) {
      // fallback plain message if file missing
      res.json({
        error: "Not Found",
        path: req.originalUrl,
      });
    }
  });

  logger.error("404 Not Found", {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });
});

app.listen(PORT, () => {
  logger.info("Service started", {
    service: SERVICE_NAME,
    port: PORT,
    logLevel: LOG_LEVEL,
    publicPath: PUBLIC_PATH,
    configPath: CONFIG_PATH || null,
  });
});
