const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { makeLogger } = require("/core/shared/core-logger");
const { readJson } = require("/core/shared/core-utils");

const SERVICE_NAME = process.env.SERVICE_NAME || "core-www";

// HTTP/HTTPS ports (separate so you can redirect 80 → 443)
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);

// If you only want the old single-port behavior, set ENABLE_HTTPS=false
const ENABLE_HTTPS = (process.env.ENABLE_HTTPS || "true").toLowerCase() === "true";
// If true, start an HTTP server that redirects all requests to https://...
const ENABLE_HTTP_REDIRECT = (process.env.ENABLE_HTTP_REDIRECT || "true").toLowerCase() === "true";

const CONFIG_PATH = process.env.CONFIG_PATH;
const LOG_PATH = process.env.LOG_PATH;
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const PUBLIC_PATH = process.env.PUBLIC_PATH || path.join(process.cwd(), "public");

const TLS_KEY_PATH = process.env.TLS_KEY_PATH || "/core/core-www/config/cert.key";
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || "/core/core-www/config/cert.crt";

const logger = makeLogger({ serviceName: SERVICE_NAME, logPath: LOG_PATH, level: LOG_LEVEL });

let config = {};
try {
  if (CONFIG_PATH) config = readJson(CONFIG_PATH);
} catch (e) {
  logger.warn("Failed to load config; continuing with defaults", { error: String(e) });
}

const app = express();
app.use(express.json());

// request logging middleware (unchanged)
app.use((req, res, next) => {
  const start = Date.now();

  const reqMeta = {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };

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
    logger.debug("HTTP request", meta);
  });

  next();
});

app.use("/", express.static(PUBLIC_PATH));
app.get("/health", (req, res) => res.json({ service: SERVICE_NAME, ok: true }));

app.use((req, res) => {
  const file = path.join(PUBLIC_PATH, "404.html");

  res.status(404);
  res.sendFile(file, (err) => {
    if (err) {
      res.json({ error: "Not Found", path: req.originalUrl });
    }
  });

  logger.error("404 Not Found", {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });
});

// ---- START SERVERS ----

function startHttps() {
  const tls = {
    key: fs.readFileSync(TLS_KEY_PATH),
    cert: fs.readFileSync(TLS_CERT_PATH),
  };

  https.createServer(tls, app).listen(HTTPS_PORT, () => {
    logger.info("HTTPS service started", {
      service: SERVICE_NAME,
      httpsPort: HTTPS_PORT,
      logLevel: LOG_LEVEL,
      publicPath: PUBLIC_PATH,
      configPath: CONFIG_PATH || null,
      tlsKeyPath: TLS_KEY_PATH,
      tlsCertPath: TLS_CERT_PATH,
    });
  });
}

function startHttpRedirect() {
  http.createServer((req, res) => {
    // Respect Host header, but strip any port and force https
    const host = (req.headers.host || "hpcore").split(":")[0];
    const location = `https://${host}${req.url}`;
    res.writeHead(301, { Location: location });
    res.end();
  }).listen(HTTP_PORT, () => {
    logger.info("HTTP redirect started", {
      service: SERVICE_NAME,
      httpPort: HTTP_PORT,
      redirectTo: "https",
    });
  });
}

if (ENABLE_HTTPS) {
  startHttps();
  if (ENABLE_HTTP_REDIRECT) startHttpRedirect();
} else {
  // legacy HTTP-only mode (kept for convenience)
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => {
    logger.info("HTTP service started", {
      service: SERVICE_NAME,
      port: PORT,
      logLevel: LOG_LEVEL,
      publicPath: PUBLIC_PATH,
      configPath: CONFIG_PATH || null,
    });
  });
}
