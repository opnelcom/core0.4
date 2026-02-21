"use strict";

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

function asyncHandler(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

function emailLooksOk(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getDeviceId(request) {
  return request.cookies?.device_id || request.body?.device_id || crypto.randomUUID();
}

function setDeviceCookie(response, deviceId) {
  response.cookie("device_id", deviceId, {
    httpOnly: false,
    secure: true,
    sameSite: "Strict",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

function setSessionCookie(response, sessionId, maxAgeSeconds) {
  response.cookie("session_id", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    maxAge: maxAgeSeconds * 1000,
  });
}

async function insertUserLog(applicationContext, userEmail, message) {
  await applicationContext.db.query({
    operation: "user.log",
    sql: `INSERT INTO core_user_log (user_email, created, log) VALUES ($1, now(), $2)`,
    params: [userEmail, message],
  });
}

module.exports = function buildUserRouter(applicationContext) {
  const router = express.Router();

  router.post("/register",asyncHandler(async (request, response) => {
      const email = String(request.body?.email || "").trim().toLowerCase();
      const password = String(request.body?.password || "");
      const nickName = String(request.body?.nick_name || "").trim();
      const fullName = String(request.body?.full_name || "").trim();

      if (!emailLooksOk(email)) {
        applicationContext.logger.warn("Register invalid email", { op: "user.register" });
        return response.status(400).json({ ok: false, error: "invalid email" });
      }

      if (!password || password.length < 8) {
        applicationContext.logger.warn("Register invalid password", { op: "user.register", email });
        return response.status(400).json({ ok: false, error: "password must be at least 8 chars" });
      }

      const deviceId = getDeviceId(request);
      setDeviceCookie(response, deviceId);

      const passwordHash = await bcrypt.hash(password, 12);

      const registrationToken = applicationContext.randomToken();
      const registrationTokenHash = applicationContext.sha256Hex(registrationToken);

      try {
        await applicationContext.db.query({
          operation: "user.register.insert",
          sql: `
            INSERT INTO core_user
              (email, nick_name, full_name, created, activated, deactivated, password_hash, token_hash, token_expiry)
            VALUES
              ($1, $2, $3, now(), null, null, $4, $5, now() + ($6 || ' seconds')::interval)
          `,
          params: [
            email,
            nickName || null,
            fullName || null,
            passwordHash,
            registrationTokenHash,
            String(applicationContext.tokenExpirySeconds),
          ],
        });
      } catch (error) {
        const message = String(error?.details?.body?.error || error);
        if (message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate")) {
          applicationContext.logger.warn("Register email already exists", { op: "user.register", email });
          return response.status(409).json({ ok: false, error: "email already registered" });
        }
        throw error; // already logged by db client
      }

      await insertUserLog(applicationContext, email, "Registered (pending activation)");

      await applicationContext.sendEmailBestEffort({
        to: email,
        subject: "Activate your account",
        text:
          `Hello,\n\n` +
          `Use this token to activate your account:\n\n` +
          `${registrationToken}\n\n` +
          `This token expires in ${applicationContext.tokenExpirySeconds} seconds.\n`,
        meta: { kind: "registration", email },
        logger: applicationContext.logger,
      });

      response.json({ ok: true, email });
    })
  );

  router.post("/activate",asyncHandler(async (request, response) => {
      const email = String(request.body?.email || "").trim().toLowerCase();
      const token = String(request.body?.token || "").trim();

      if (!emailLooksOk(email) || !token) {
        applicationContext.logger.warn("Activate invalid input", { op: "user.activate" });
        return response.status(400).json({ ok: false, error: "invalid input" });
      }

      const tokenHash = applicationContext.sha256Hex(token);

      const userResult = await applicationContext.db.query({
        operation: "user.activate.lookup",
        sql: `
          SELECT email, activated, deactivated, full_name
          FROM core_user
          WHERE email = $1
            AND token_hash = $2
            AND token_expiry > now()
          LIMIT 1
        `,
        params: [email, tokenHash],
      });

      if (!userResult.rows?.length) {
        applicationContext.logger.warn("Activate invalid/expired token", { op: "user.activate", email });
        return response.status(400).json({ ok: false, error: "invalid or expired token" });
      }

      const user = userResult.rows[0];
      if (user.deactivated) {
        applicationContext.logger.warn("Activate attempt for deactivated user", { op: "user.activate", email });
        return response.status(403).json({ ok: false, error: "user deactivated" });
      }

      await applicationContext.db.query({
        operation: "user.activate.update",
        sql: `
          UPDATE core_user
          SET activated = COALESCE(activated, now()),
              token_hash = null,
              token_expiry = null
          WHERE email = $1
        `,
        params: [email],
      });

      await insertUserLog(applicationContext, email, "Activated account");

      const personalTenantResult = await applicationContext.db.query({
        operation: "user.activate.personalTenant.lookup",
        sql: `SELECT id FROM core_tenant WHERE create_user = $1 AND subdomain IS NULL LIMIT 1`,
        params: [email],
      });

      let personalTenantId;
      if (personalTenantResult.rows?.length) {
        personalTenantId = personalTenantResult.rows[0].id;
      } else {
        const tenantName = user.full_name || email;

        const tenantInsertResult = await applicationContext.db.query({
          operation: "user.activate.personalTenant.insert",
          sql: `
            INSERT INTO core_tenant (full_name, subdomain, create_user, created, updated)
            VALUES ($1, null, $2, now(), now())
            RETURNING id
          `,
          params: [tenantName, email],
        });

        personalTenantId = tenantInsertResult.rows[0].id;

        await applicationContext.db.query({
          operation: "user.activate.personalTenant.addAdmin",
          sql: `
            INSERT INTO core_tenant_user
              (tenant, user_email, role, create_user, created, update_user, updated, deactivated)
            VALUES
              ($1, $2, 'administrator', $2, now(), null, null, null)
            ON CONFLICT DO NOTHING
          `,
          params: [personalTenantId, email],
        });

        await applicationContext.db.query({
          operation: "user.activate.personalTenant.log",
          sql: `INSERT INTO core_tenant_log (tenant, user_email, created, log) VALUES ($1, $2, now(), $3)`,
          params: [personalTenantId, email, "Created personal tenant"],
        });
      }

      response.json({ ok: true, email, tenant_id: personalTenantId });
    })
  );

  router.post(
    "/login",
    asyncHandler(async (request, response) => {
      const email = String(request.body?.email || "").trim().toLowerCase();
      const password = String(request.body?.password || "");
      const rememberMe = Boolean(request.body?.remember_me);

      if (!emailLooksOk(email) || !password) {
        applicationContext.logger.warn("Login invalid input", { op: "user.login" });
        return response.status(400).json({ ok: false, error: "invalid input" });
      }

      const deviceId = getDeviceId(request);
      const deviceDescription = String(request.body?.device_description || "").trim() || null;

      setDeviceCookie(response, deviceId);

      const userResult = await applicationContext.db.query({
        operation: "user.login.userLookup",
        sql: `
          SELECT email, nick_name, full_name, activated, deactivated, password_hash
          FROM core_user
          WHERE email = $1
          LIMIT 1
        `,
        params: [email],
      });

      if (!userResult.rows?.length) {
        applicationContext.logger.warn("Login invalid credentials", { op: "user.login", email });
        return response.status(401).json({ ok: false, error: "invalid credentials" });
      }

      const user = userResult.rows[0];

      if (!user.activated) {
        applicationContext.logger.warn("Login not activated", { op: "user.login", email });
        return response.status(403).json({ ok: false, error: "not activated" });
      }

      if (user.deactivated) {
        applicationContext.logger.warn("Login user deactivated", { op: "user.login", email });
        return response.status(403).json({ ok: false, error: "user deactivated" });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        applicationContext.logger.warn("Login invalid credentials", { op: "user.login", email });
        return response.status(401).json({ ok: false, error: "invalid credentials" });
      }

      const sessionId = applicationContext.randomToken();
      const sessionExpirySeconds = rememberMe
        ? applicationContext.loginExpirySeconds
        : Math.min(86400, applicationContext.loginExpirySeconds);

      await applicationContext.db.query({
        operation: "user.login.sessionInsert",
        sql: `
          INSERT INTO core_user_session
            (user_email, device_id, session_id, expiry, device_description)
          VALUES
            ($1, $2, $3, now() + ($4 || ' seconds')::interval, $5)
        `,
        params: [email, deviceId, sessionId, String(sessionExpirySeconds), deviceDescription],
      });

      setSessionCookie(response, sessionId, sessionExpirySeconds);
      await insertUserLog(applicationContext, email, "Logged in");

      const tenants = await applicationContext.listTenantsForUser(applicationContext.db, email);

      response.json({
        ok: true,
        user: { email: user.email, nick_name: user.nick_name, full_name: user.full_name },
        tenants,
      });
    })
  );

  router.post(
    "/changepassword",
    applicationContext.requireAuth,
    asyncHandler(async (request, response) => {
      const email = request.auth.email;
      const oldPassword = String(request.body?.old_password || "");
      const newPassword = String(request.body?.new_password || "");

      if (!oldPassword || !newPassword || newPassword.length < 8) {
        applicationContext.logger.warn("Change password invalid input", { op: "user.changePassword", email });
        return response.status(400).json({ ok: false, error: "invalid input" });
      }

      const userResult = await applicationContext.db.query({
        operation: "user.changePassword.lookup",
        sql: `SELECT password_hash FROM core_user WHERE email = $1 LIMIT 1`,
        params: [email],
      });

      if (!userResult.rows?.length) {
        applicationContext.logger.warn("Change password user not found", { op: "user.changePassword", email });
        return response.status(404).json({ ok: false, error: "user not found" });
      }

      const passwordHash = userResult.rows[0].password_hash;
      const isOldPasswordValid = await bcrypt.compare(oldPassword, passwordHash);

      if (!isOldPasswordValid) {
        applicationContext.logger.warn("Change password invalid credentials", { op: "user.changePassword", email });
        return response.status(401).json({ ok: false, error: "invalid credentials" });
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      await applicationContext.db.query({
        operation: "user.changePassword.update",
        sql: `UPDATE core_user SET password_hash = $1 WHERE email = $2`,
        params: [newPasswordHash, email],
      });

      await insertUserLog(applicationContext, email, "Changed password");
      response.json({ ok: true });
    })
  );

  router.post(
    "/forgotpassword",
    asyncHandler(async (request, response) => {
      const email = String(request.body?.email || "").trim().toLowerCase();
      const token = String(request.body?.token || "").trim();
      const newPassword = String(request.body?.new_password || "");

      if (!emailLooksOk(email)) {
        applicationContext.logger.warn("Forgot password invalid email", { op: "user.forgotPassword" });
        return response.status(400).json({ ok: false, error: "invalid email" });
      }

      if (!token) {
        const resetToken = applicationContext.randomToken();
        const resetTokenHash = applicationContext.sha256Hex(resetToken);

        const tokenUpdateResult = await applicationContext.db.query({
          operation: "user.forgotPassword.issueToken",
          sql: `
            UPDATE core_user
            SET token_hash = $1,
                token_expiry = now() + ($2 || ' seconds')::interval
            WHERE email = $3
              AND activated IS NOT NULL
              AND deactivated IS NULL
            RETURNING email
          `,
          params: [resetTokenHash, String(applicationContext.tokenExpirySeconds), email],
        });

        if (tokenUpdateResult.rows?.length) {
          await insertUserLog(applicationContext, email, "Requested password reset token");

          await applicationContext.sendEmailBestEffort({
            to: email,
            subject: "Password reset",
            text:
              `Hello,\n\n` +
              `Use this token to reset your password:\n\n` +
              `${resetToken}\n\n` +
              `This token expires in ${applicationContext.tokenExpirySeconds} seconds.\n`,
            meta: { kind: "password_reset", email },
            logger: applicationContext.logger,
          });
        }

        return response.json({ ok: true });
      }

      if (!newPassword || newPassword.length < 8) {
        applicationContext.logger.warn("Forgot password invalid new_password", { op: "user.forgotPassword", email });
        return response.status(400).json({ ok: false, error: "new_password must be at least 8 chars" });
      }

      const providedTokenHash = applicationContext.sha256Hex(token);

      const tokenValidationResult = await applicationContext.db.query({
        operation: "user.forgotPassword.validateToken",
        sql: `
          SELECT email
          FROM core_user
          WHERE email = $1
            AND token_hash = $2
            AND token_expiry > now()
            AND deactivated IS NULL
          LIMIT 1
        `,
        params: [email, providedTokenHash],
      });

      if (!tokenValidationResult.rows?.length) {
        applicationContext.logger.warn("Forgot password invalid/expired token", { op: "user.forgotPassword", email });
        return response.status(400).json({ ok: false, error: "invalid or expired token" });
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      await applicationContext.db.query({
        operation: "user.forgotPassword.setPassword",
        sql: `
          UPDATE core_user
          SET password_hash = $1,
              token_hash = null,
              token_expiry = null
          WHERE email = $2
        `,
        params: [newPasswordHash, email],
      });

      await insertUserLog(applicationContext, email, "Reset password via token");
      response.json({ ok: true });
    })
  );

  router.post(
    "/update",
    applicationContext.requireAuth,
    asyncHandler(async (request, response) => {
      const email = request.auth.email;
      const nickName = request.body?.nick_name;
      const fullName = request.body?.full_name;

      await applicationContext.db.query({
        operation: "user.updateProfile",
        sql: `
          UPDATE core_user
          SET nick_name = COALESCE($1, nick_name),
              full_name = COALESCE($2, full_name)
          WHERE email = $3
        `,
        params: [nickName ?? null, fullName ?? null, email],
      });

      await insertUserLog(applicationContext, email, "Updated profile");
      response.json({ ok: true });
    })
  );

  return router;
};
