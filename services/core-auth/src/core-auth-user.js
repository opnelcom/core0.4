"use strict";

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function emailLooksOk(email) {
  return typeof email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const COOKIE_SECURE = process.env.NODE_ENV === "production";

function getDeviceId(req) {
  return req.cookies?.device_id || crypto.randomUUID();
}

function setDeviceCookie(res, deviceId) {
  res.cookie("device_id", deviceId, {
    httpOnly: false,
    secure: COOKIE_SECURE,
    sameSite: "Strict",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

function setSessionCookie(res, sessionId, maxAgeSeconds) {
  res.cookie("session_id", sessionId, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "Strict",
    maxAge: maxAgeSeconds * 1000,
  });
}

async function insertUserLog(ctx, email, message) {
  await ctx.db.query({
    operation: "user.log",
    sql: `
      INSERT INTO core_user_log (user_email, created, log)
      VALUES ($1, now(), $2)
    `,
    params: [email, message],
  });
}

async function deleteAllUserSessions(ctx, email) {
  await ctx.db.query({
    operation: "user.session.deleteAll",
    sql: `DELETE FROM core_user_session WHERE user_email = $1`,
    params: [email],
  });
}

module.exports = function buildUserRouter(applicationContext) {
  const router = express.Router();

  // ------------------------------------------------------------
  // LOGIN
  // ------------------------------------------------------------
  router.post("/login", asyncHandler(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const rememberMe = Boolean(req.body?.remember_me);

    if (!emailLooksOk(email) || !password)
      return res.status(400).json({ ok: false, error: "invalid input" });

    const userResult = await applicationContext.db.query({
      operation: "user.login.lookup",
      sql: `
        SELECT email, nick_name, full_name, activated, deactivated, password_hash
        FROM core_user
        WHERE email = $1
        LIMIT 1
      `,
      params: [email],
    });

    if (!userResult.rows?.length)
      return res.status(401).json({ ok: false, error: "invalid credentials" });

    const user = userResult.rows[0];

    if (!user.activated)
      return res.status(403).json({ ok: false, error: "not activated" });

    if (user.deactivated)
      return res.status(403).json({ ok: false, error: "user deactivated" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ ok: false, error: "invalid credentials" });

    const deviceId = getDeviceId(req);
    setDeviceCookie(res, deviceId);

    const sessionId = applicationContext.randomToken();
    const expirySeconds = rememberMe
      ? applicationContext.loginExpirySeconds
      : Math.min(86400, applicationContext.loginExpirySeconds);

    await applicationContext.db.query({
      operation: "user.login.sessionInsert",
      sql: `
        INSERT INTO core_user_session
          (user_email, device_id, session_id, expiry)
        VALUES
          ($1, $2, $3, now() + ($4 || ' seconds')::interval)
      `,
      params: [email, deviceId, sessionId, String(expirySeconds)],
    });

    setSessionCookie(res, sessionId, expirySeconds);
    await insertUserLog(applicationContext, email, "Logged in");

    res.json({
      ok: true,
      user: {
        email: user.email,
        nick_name: user.nick_name,
        full_name: user.full_name,
      },
    });
  }));

  // ------------------------------------------------------------
  // ME
  // ------------------------------------------------------------
  router.get("/me", applicationContext.requireAuth, asyncHandler(async (req, res) => {
    const email = req.auth.email;

    const result = await applicationContext.db.query({
      operation: "user.me",
      sql: `
        SELECT email, nick_name, full_name, activated
        FROM core_user
        WHERE email = $1
        LIMIT 1
      `,
      params: [email],
    });

    if (!result.rows?.length)
      return res.status(404).json({ ok: false, error: "user not found" });

    const user = result.rows[0];

    const tenantsResult = await applicationContext.db.query({
      operation: "user.me.tenants",
      sql: `
        SELECT t.id, t.full_name, t.subdomain, tu.role
        FROM core_tenant_user tu
        JOIN core_tenant t ON t.id = tu.tenant
        WHERE tu.user_email = $1
          AND tu.deactivated IS NULL
        ORDER BY t.full_name ASC
      `,
      params: [email],
    });

    res.json({
      ok: true,
      user: {
        email: user.email,
        nick_name: user.nick_name,
        full_name: user.full_name,
        activated: !!user.activated,
      },
      tenants: tenantsResult.rows || [],
    });
  }));

  // ------------------------------------------------------------
  // LIST APPS
  // ------------------------------------------------------------
  router.get("/apps", applicationContext.requireAuth, asyncHandler(async (req, res) => {
    const email = req.auth.email;

    const userResult = await applicationContext.db.query({
      operation: "user.apps.lookup",
      sql: `
        SELECT administrator
        FROM core_user
        WHERE email = $1
        LIMIT 1
      `,
      params: [email],
    });

    if (!userResult.rows?.length)
      return res.status(404).json({ ok: false, error: "user not found" });

    const isAdmin = Boolean(userResult.rows[0].administrator);

    const appsResult = await applicationContext.db.query({
      operation: "user.apps.list",
      sql: `
        SELECT id, code, name, description, url, icon_svg, admin_app
        FROM core_apps
        WHERE enabled = true
          AND ($1::boolean = true OR admin_app = false)
        ORDER BY name ASC
      `,
      params: [isAdmin],
    });

    res.json({
      ok: true,
      administrator: isAdmin,
      apps: appsResult.rows || [],
    });
  }));

  // ------------------------------------------------------------
  // LOGOUT
  // ------------------------------------------------------------
  router.post("/logout", applicationContext.requireAuth, asyncHandler(async (req, res) => {
    const email = req.auth.email;
    const sessionId = req.cookies?.session_id;

    if (sessionId) {
      await applicationContext.db.query({
        operation: "user.logout",
        sql: `
          DELETE FROM core_user_session
          WHERE user_email = $1
            AND session_id = $2
        `,
        params: [email, sessionId],
      });
    }

    res.cookie("session_id", "", {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "Strict",
      expires: new Date(0),
    });

    res.cookie("device_id", "", {
      httpOnly: false,
      secure: COOKIE_SECURE,
      sameSite: "Strict",
      expires: new Date(0),
    });

    await insertUserLog(applicationContext, email, "logout");
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------
  // LOGOUT ALL
  // ------------------------------------------------------------
  router.post("/logout-all", applicationContext.requireAuth, asyncHandler(async (req, res) => {
    const email = req.auth.email;

    await deleteAllUserSessions(applicationContext, email);

    res.cookie("session_id", "", {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "Strict",
      expires: new Date(0),
    });

    res.cookie("device_id", "", {
      httpOnly: false,
      secure: COOKIE_SECURE,
      sameSite: "Strict",
      expires: new Date(0),
    });

    await insertUserLog(applicationContext, email, "logout-all");
    res.json({ ok: true });
  }));

  return router;
};