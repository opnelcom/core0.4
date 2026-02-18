const express = require("express");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { makeLogger } = require("/core/shared/core-logger");
const { readJson, nowIso } = require("/core/shared/core-utils");

const SERVICE_NAME = process.env.SERVICE_NAME || "core-sql";
const PORT = Number(process.env.PORT || 3002);
const CONFIG_PATH = process.env.CONFIG_PATH;
const LOG_PATH = process.env.LOG_PATH;
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const logger = makeLogger({ serviceName: SERVICE_NAME, logPath: LOG_PATH, level: LOG_LEVEL });

let config = {};
try {
  if (CONFIG_PATH) config = readJson(CONFIG_PATH);
} catch (e) {
  logger.warn("Failed to load config; continuing with defaults", { error: String(e) });
}

const dbs = config.databases || {};
const pools = new Map();

function getPool(dbId) {
  if (!dbs[dbId]) throw new Error(`Unknown db identifier: ${dbId}`);
  if (pools.has(dbId)) return pools.get(dbId);

  const c = dbs[dbId];
  const pool = new Pool({
    host: c.host,
    port: c.port || 5432,
    database: c.database,
    user: c.user,
    password: c.password,
  });

  pools.set(dbId, pool);
  return pool;
}

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ service: SERVICE_NAME, ok: true }));

// POST /query { dbId, sql, params?: [] }
app.post("/query", async (req, res) => {
  const { dbId, sql, params } = req.body || {};
  if (!dbId || !sql) return res.status(400).json({ ok: false, error: "dbId and sql required" });

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const start = Date.now();

  const record = {
    requestId,
    receivedAt: nowIso(),
    dbId,
    sqlPreview: String(sql).slice(0, 300),
    paramsCount: Array.isArray(params) ? params.length : 0
  };

  try {
    const pool = getPool(dbId);
    const result = await pool.query(sql, Array.isArray(params) ? params : []);
    const ms = Date.now() - start;

    record.completedAt = nowIso();
    record.durationMs = ms;
    record.rowCount = result.rowCount ?? (result.rows ? result.rows.length : 0);
    record.fields = result.fields ? result.fields.map(f => f.name) : [];

    fs.writeFileSync(
      path.join(LOG_PATH, `${SERVICE_NAME}-${requestId}.json`),
      JSON.stringify(record, null, 2)
    );

    logger.info("SQL executed", record);

    // Return rows but avoid returning huge payloads by default
    const maxRows = Number(config.maxRows || 200);
    const rows = (result.rows || []).slice(0, maxRows);

    res.json({
      ok: true,
      requestId,
      stats: { durationMs: ms, rowCount: record.rowCount, returnedRows: rows.length },
      rows
    });
  } catch (e) {
    record.error = String(e);
    record.failedAt = nowIso();

    try {
      fs.writeFileSync(
        path.join(LOG_PATH, `${SERVICE_NAME}-${requestId}.error.json`),
        JSON.stringify(record, null, 2)
      );
    } catch (_) {}

    logger.error("SQL failed", record);
    res.status(500).json({ ok: false, requestId, error: String(e) });
  }
});

app.listen(PORT, () => logger.info(`Listening on ${PORT}`, { configPath: CONFIG_PATH }));
