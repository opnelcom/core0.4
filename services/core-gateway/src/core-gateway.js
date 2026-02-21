"use strict";

const fs = require("fs");
const express = require("express");

const { makeLogger } = require("/core/shared/core-logger"); // :contentReference[oaicite:3]{index=3}
const { readJson, nowIso } = require("/core/shared/core-utils"); // :contentReference[oaicite:4]{index=4}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function joinUrl(base, pathAndQuery) {
  return String(base).replace(/\/+$/, "") + pathAndQuery;
}

function applyRewrite(originalUrl, rewrite) {
  if (!rewrite) return originalUrl;

  let url = originalUrl;

  if (rewrite.stripPrefix) {
    if (url.startsWith(rewrite.stripPrefix)) {
      url = url.slice(rewrite.stripPrefix.length) || "/";
      if (!url.startsWith("/")) url = "/" + url;
    }
  }

  if (rewrite.prepend) {
    const p = String(rewrite.prepend);
    url = p.replace(/\/+$/, "") + (url.startsWith("/") ? url : "/" + url);
  }

  return url;
}

// Minimal reverse proxy using Node 18+/20 fetch (streams through)
async function proxyFetch(req, res, baseUrl, rewrite) {
  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  const forwardPath = applyRewrite(req.originalUrl, rewrite);
  const targetUrl = joinUrl(baseUrl, forwardPath);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (!v) continue;
    const key = k.toLowerCase();
    if (
      key === "connection" ||
      key === "keep-alive" ||
      key === "proxy-authenticate" ||
      key === "proxy-authorization" ||
      key === "te" ||
      key === "trailer" ||
      key === "transfer-encoding" ||
      key === "upgrade" ||
      key === "host"
    ) {
      continue;
    }
    headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }

  // forward info
  headers.set("x-forwarded-proto", req.protocol);
  headers.set("x-forwarded-host", req.headers.host || "");

  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k === "connection" ||
      k === "keep-alive" ||
      k === "proxy-authenticate" ||
      k === "proxy-authorization" ||
      k === "te" ||
      k === "trailer" ||
      k === "transfer-encoding" ||
      k === "upgrade"
    ) {
      return;
    }
    res.setHeader(key, value);
  });

  if (!upstream.body) return res.end();

  // pipe web stream -> node response
  upstream.body.pipeTo(
    new WritableStream({
      write(chunk) {
        res.write(Buffer.from(chunk));
      },
      close() {
        res.end();
      },
      abort(err) {
        res.destroy(err);
      },
    })
  );
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") throw new Error("Config must be an object");
  if (!cfg.defaultTarget?.baseUrl) throw new Error("Config.defaultTarget.baseUrl is required");
  if (!Array.isArray(cfg.routes)) cfg.routes = [];

  for (const r of cfg.routes) {
    if (!r.name) throw new Error("Each route needs a name");
    if (r.match?.type !== "prefix" || !r.match?.path) throw new Error(`Route ${r.name} needs match.type=prefix and match.path`);
    if (!r.target?.baseUrl) throw new Error(`Route ${r.name} needs target.baseUrl`);
  }
  return cfg;
}

function pickRoute(cfg, urlPath) {
  // Longest-prefix wins (more specific routes first)
  const sorted = [...cfg.routes].sort((a, b) => b.match.path.length - a.match.path.length);
  return sorted.find((r) => urlPath.startsWith(r.match.path)) || null;
}

async function main() {
  const serviceName = process.env.SERVICE_NAME || "core-gateway";
  const logPath = process.env.LOG_PATH || "/core/core-gateway/logs";
  const logLevel = process.env.LOG_LEVEL || "info";
  const port = Number(process.env.PORT || 8080);

  const configPath = process.env.CONFIG_PATH || "/core/core-gateway/config/core-gateway.json";

  const logger = makeLogger({ serviceName, logPath, level: logLevel }); // :contentReference[oaicite:5]{index=5}

  let currentConfig = validateConfig(readJson(configPath)); // :contentReference[oaicite:6]{index=6}
  logger.info("Loaded gateway config", { configPath });

  // Hot reload config when file changes (best effort)
  try {
    fs.watch(configPath, { persistent: false }, () => {
      try {
        const next = validateConfig(readJson(configPath)); // :contentReference[oaicite:7]{index=7}
        currentConfig = next;
        logger.info("Reloaded gateway config", { configPath });
      } catch (e) {
        logger.error("Failed to reload config (keeping old config)", { err: String(e) });
      }
    });
  } catch (e) {
    logger.warn("Config file watch not available", { err: String(e) });
  }

  const app = express();
  app.disable("x-powered-by");

  // logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info("http_request", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration_ms: Date.now() - start,
      });
    });
    next();
  });

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: serviceName, time: nowIso() }); // :contentReference[oaicite:8]{index=8}
  });

  // Single dynamic proxy handler
  app.use(
    asyncHandler(async (req, res) => {
      const cfg = currentConfig;
      const route = pickRoute(cfg, req.path);

      const baseUrl = route ? route.target.baseUrl : cfg.defaultTarget.baseUrl;
      const rewrite = route ? route.rewrite : null;

      logger.debug("route_match", {
        name: route?.name || "default",
        match: route?.match?.path || "*",
        target: baseUrl,
      });

      await proxyFetch(req, res, baseUrl, rewrite);
    })
  );

  // error handler
  app.use((err, req, res, next) => {
    logger.error("Unhandled error", { err: String(err), stack: err?.stack });
    res.status(502).json({ ok: false, error: "bad gateway" });
  });

  app.listen(port, () => logger.info(`Listening on :${port}`));
}

main().catch((e) => {
  console.error("core-gateway failed to start:", e);
  process.exit(1);
});