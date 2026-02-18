"use strict";

const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const { makeLogger } = require("/core/shared/core-logger");
const { nowIso } = require("/core/shared/core-utils");

function parseSeconds(secondsLike, fallbackSeconds) {
  if (!secondsLike) return fallbackSeconds;
  const normalized = String(secondsLike).trim().toLowerCase();
  const secondsMatch = normalized.match(/^(\d+)\s*s?$/);
  if (secondsMatch) return Number(secondsMatch[1]);

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : fallbackSeconds;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function slugifySubdomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function asyncHandler(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

function requireJson(request, response, next) {
  if (request.is("application/json") || request.method === "GET") return next();
  return response.status(415).json({ ok: false, error: "content-type must be application/json" });
}

function markLogged(error) {
  try {
    Object.defineProperty(error, "_alreadyLogged", { value: true, enumerable: false, configurable: true });
  } catch {
    // ignore
  }
  return error;
}

function isLogged(error) {
  return Boolean(error && error._alreadyLogged);
}

function makeCoreSqlClient({ logger }) {
  const coreSqlQueryUrl = process.env.CORE_SQL_URL || "http://core-sql:3002/query";
  const databaseId = process.env.CORE_SQL_DBID;

  if (!databaseId) {
    logger.error("Missing required env var CORE_SQL_DBID");
    process.exit(1);
  }

  async function query({ sql, params = [], operation = "db.query" }) {
    const payload = { dbId: databaseId, sql, params };

    let httpResponse;
    let rawText = "";
    let parsedBody = null;

    try {
      httpResponse = await fetch(coreSqlQueryUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      rawText = await httpResponse.text();
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        parsedBody = { ok: false, error: rawText };
      }
    } catch (fetchError) {
      logger.error("core-sql fetch failed", {
        op: operation,
        url: coreSqlQueryUrl,
        dbId: databaseId,
        err: String(fetchError),
      });
      const error = markLogged(new Error("database unavailable"));
      error.statusCode = 503;
      throw error;
    }

    if (!httpResponse.ok || !parsedBody?.ok) {
      logger.error("core-sql query failed", {
        op: operation,
        url: coreSqlQueryUrl,
        dbId: databaseId,
        httpStatus: httpResponse.status,
        error: parsedBody?.error,
        requestId: parsedBody?.requestId,
        sqlPreview: String(sql).slice(0, 180),
        paramsCount: Array.isArray(params) ? params.length : 0,
      });

      const error = markLogged(new Error("database error"));
      error.statusCode = 500;
      throw error;
    }

    return parsedBody; // expected: { ok, rows, ... }
  }

  async function health() {
    const healthUrl = coreSqlQueryUrl.replace(/\/query$/, "/health");
    try {
      const healthResponse = await fetch(healthUrl);
      return healthResponse.ok;
    } catch (healthError) {
      logger.warn("core-sql health check failed", { url: healthUrl, err: String(healthError) });
      return false;
    }
  }

  return {
    query,
    health,
    coreSqlQueryUrl,
    databaseId,
  };
}

async function sendEmailBestEffort({ to, subject, text, html, meta, logger }) {
  const smtpBaseUrl = process.env.CORE_SMTP_URL || "http://core-smtp:3001";
  const smtpPath = process.env.CORE_SMTP_PATH || "/send";
  const smtpUrl = smtpBaseUrl.replace(/\/+$/, "") + smtpPath;
  const fromEmail = process.env.CORE_SMTP_FROM;
  const fromName = process.env.CORE_SMTP_FROM_NAME || null;

  const payload = { to, from: fromEmail, fromName, subject, text, html, meta };

  try {
    const smtpResponse = await fetch(smtpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!smtpResponse.ok) {
      const smtpBody = await smtpResponse.text().catch(() => "");
      logger.warn("core-smtp responded non-OK", { url: smtpUrl, status: smtpResponse.status, body: smtpBody.slice(0, 800) });
      return { ok: false };
    }

    return { ok: true };
  } catch (smtpError) {
    logger.warn("Failed to call core-smtp (best-effort)", { url: smtpUrl, err: String(smtpError) });
    return { ok: false };
  }
}

function buildRequireAuthMiddleware(applicationContext) {
  return asyncHandler(async (request, response, next) => {
    const sessionId = request.cookies?.session_id;
    const deviceId = request.cookies?.device_id;

    if (!sessionId) return response.status(401).json({ ok: false, error: "not authenticated" });

    const sessionResult = await applicationContext.db.query({
      operation: "auth.sessionLookup",
      sql: `
        SELECT user_email, device_id, session_id, expiry
        FROM core_user_session
        WHERE session_id = $1
          AND expiry > now()
        LIMIT 1
      `,
      params: [sessionId],
    });

    if (!sessionResult.rows?.length) return response.status(401).json({ ok: false, error: "not authenticated" });

    const session = sessionResult.rows[0];

    if (deviceId && session.device_id && session.device_id !== deviceId) {
      applicationContext.logger.warn("Session device mismatch", { op: "auth.deviceMismatch" });
      return response.status(401).json({ ok: false, error: "not authenticated" });
    }

    const userResult = await applicationContext.db.query({
      operation: "auth.userLookup",
      sql: `
        SELECT email, nick_name, full_name, activated, deactivated
        FROM core_user
        WHERE email = $1
        LIMIT 1
      `,
      params: [session.user_email],
    });

    if (!userResult.rows?.length) return response.status(401).json({ ok: false, error: "not authenticated" });

    const user = userResult.rows[0];
    if (!user.activated || user.deactivated) return response.status(401).json({ ok: false, error: "not authenticated" });

    request.auth = { email: user.email, nick_name: user.nick_name, full_name: user.full_name };
    next();
  });
}

async function listTenantsForUser(databaseClient, userEmail) {
  const tenantResult = await databaseClient.query({
    operation: "tenant.listForUser",
    sql: `
      SELECT
        tenant.id,
        tenant.full_name,
        tenant.subdomain,
        tenantUser.role,
        tenantUser.deactivated
      FROM core_tenant_user tenantUser
      JOIN core_tenant tenant ON tenant.id = tenantUser.tenant
      WHERE tenantUser.user_email = $1
      ORDER BY tenant.created ASC
    `,
    params: [userEmail],
  });

  return tenantResult.rows || [];
}

async function main() {
  const serviceName = process.env.SERVICE_NAME || "core-auth";
  const logPath = process.env.LOG_PATH || "/core/core-auth/logs";
  const logLevel = process.env.LOG_LEVEL || "info";

  const logger = makeLogger({ serviceName, logPath, level: logLevel });

  const tokenExpirySeconds = parseSeconds(process.env.TOKEN_EXPIRY, 300);
  const loginExpirySeconds = parseSeconds(process.env.LOGIN_EXPIRY, 604800);

  const databaseClient = makeCoreSqlClient({ logger });

  const applicationContext = {
    logger,
    db: databaseClient,
    tokenExpirySeconds,
    loginExpirySeconds,
    sha256Hex,
    randomToken,
    slugifySubdomain,
    sendEmailBestEffort,
    listTenantsForUser,
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use(requireJson);

  // Request logging
  app.use((request, response, next) => {
    const startTime = Date.now();
    response.on("finish", () => {
      logger.info("http_request", {
        method: request.method,
        path: request.originalUrl,
        status: response.statusCode,
        duration_ms: Date.now() - startTime,
      });
    });
    next();
  });

  app.get("/health", async (request, response) => {
    const dbOk = await databaseClient.health();
    response.json({ ok: true, service: serviceName, time: nowIso(), dbOk });
  });

  const requireAuth = buildRequireAuthMiddleware(applicationContext);

  const buildUserRouter = require("./core-auth-user");
  const buildTenantRouter = require("./core-auth-tenant");

  app.use("/auth/user", buildUserRouter({ ...applicationContext, requireAuth }));
  app.use("/auth/tenant", buildTenantRouter({ ...applicationContext, requireAuth }));

  app.use((error, request, response, next) => {
    if (!isLogged(error)) {
      logger.error("Unhandled error", {
        method: request.method,
        path: request.originalUrl,
        err: String(error),
        stack: error?.stack,
      });
      markLogged(error);
    }

    const statusCode = Number(error?.statusCode) || 500;
    response.status(statusCode).json({
      ok: false,
      error: statusCode === 500 ? "server error" : "service unavailable",
    });
  });

  const port = Number(process.env.PORT || 3000);

  try {
    app.listen(port, () => {
      logger.info(`Listening on :${port}`, { coreSqlUrl: databaseClient.coreSqlQueryUrl, dbId: databaseClient.databaseId });
    });
  } catch (listenError) {
    logger.error("Failed to bind/listen", { port, err: String(listenError) });
    process.exit(1);
  }
}

// Bootstrap logger so startup failures are logged too
(function bootstrap() {
  const serviceName = process.env.SERVICE_NAME || "core-auth";
  const logPath = process.env.LOG_PATH || "/core/core-auth/logs";
  const logLevel = process.env.LOG_LEVEL || "info";
  const bootstrapLogger = makeLogger({ serviceName, logPath, level: logLevel });

  main().catch((startupError) => {
    bootstrapLogger.error("Startup failure", { err: String(startupError), stack: startupError?.stack });
    process.exit(1);
  });
})();
