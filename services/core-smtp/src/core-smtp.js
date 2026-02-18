const express = require("express");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const { makeLogger } = require("/core/shared/core-logger");
const { readJson, nowIso } = require("/core/shared/core-utils");

const SERVICE_NAME = process.env.SERVICE_NAME || "core-smtp";
const PORT = Number(process.env.PORT || 3001);
const CONFIG_PATH = process.env.CONFIG_PATH;
const LOG_PATH = process.env.LOG_PATH;
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const EMAIL_PATH = process.env.EMAIL_PATH || path.join(process.cwd(), "emails");

const logger = makeLogger({
  serviceName: SERVICE_NAME,
  logPath: LOG_PATH,
  level: LOG_LEVEL
});

fs.mkdirSync(EMAIL_PATH, { recursive: true });

let config = {};
try {
  if (CONFIG_PATH) config = readJson(CONFIG_PATH);
} catch (e) {
  logger.warn("Failed to load config; continuing with defaults", { error: String(e) });
}

const smtpCfg = config.smtp || {};

/**
 * TLS handling (Option B — dev only)
 * Allows self-signed certificates when:
 *   tls.rejectUnauthorized === false
 */
const tlsOptions = smtpCfg.tls || {};

const transporter = nodemailer.createTransport({
  host: smtpCfg.host,
  port: smtpCfg.port || 587,
  secure: !!smtpCfg.secure, // true for 465, false for 587 STARTTLS
  auth: smtpCfg.user
    ? { user: smtpCfg.user, pass: smtpCfg.pass }
    : undefined,
  tls: tlsOptions
});

const app = express();
app.use(express.json());

/* ---------- Health ---------- */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: SERVICE_NAME,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/* ---------- Send email ---------- */
/*
POST /send
{
  "from": "...",
  "to": "...",
  "subject": "...",
  "text": "...",
  "html": "..."
}
*/
app.post("/send", async (req, res) => {
  const { from, to, subject, text, html } = req.body || {};

  if (!from || !to || !subject || (!text && !html)) {
    return res.status(400).json({
      ok: false,
      error: "from, to, subject and text/html required"
    });
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const record = {
    requestId,
    receivedAt: nowIso(),
    from,
    to,
    subject,
    hasText: !!text,
    hasHtml: !!html
  };

  try {
    const info = await transporter.sendMail({ from, to, subject, text, html });

    record.sentAt = nowIso();
    record.messageId = info.messageId;

    fs.writeFileSync(
      path.join(EMAIL_PATH, `${SERVICE_NAME}-${requestId}.json`),
      JSON.stringify(record, null, 2)
    );

    logger.info("Email sent", record);

    return res.json({
      ok: true,
      requestId,
      messageId: info.messageId
    });
  } catch (e) {
    record.error = String(e);
    record.failedAt = nowIso();

    fs.writeFileSync(
      path.join(EMAIL_PATH, `${SERVICE_NAME}-${requestId}.error.json`),
      JSON.stringify(record, null, 2)
    );

    logger.error("Email send failed", record);

    return res.status(502).json({
      ok: false,
      requestId,
      error: String(e)
    });
  }
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  logger.info(`Listening on ${PORT}`, {
    configPath: CONFIG_PATH,
    emailPath: EMAIL_PATH,
    tlsRejectUnauthorized: tlsOptions?.rejectUnauthorized
  });
});
