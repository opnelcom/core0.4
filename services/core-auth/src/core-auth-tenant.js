// core-auth-tenant.js
"use strict";

const express = require("express");

function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

const PRIVILEGED_ROLES = ["owner", "administrator"];
const ALL_ROLES = ["owner", "administrator", "users"];

async function insertTenantLog(applicationContext, tenantId, actingUserEmail, message) {
  await applicationContext.db.query({
    operation: "tenant.log",
    sql: `INSERT INTO core_tenant_log (tenant, user_email, created, log) VALUES ($1, $2, now(), $3)`,
    params: [tenantId, actingUserEmail, message],
  });
}

async function isTenantAdministrator(applicationContext, tenantId, userEmail) {
  const adminCheckResult = await applicationContext.db.query({
    operation: "tenant.isAdmin",
    sql: `
      SELECT 1
      FROM core_tenant_user
      WHERE tenant = $1
        AND user_email = $2
        AND role = ANY($3::text[])
        AND deactivated IS NULL
      LIMIT 1
    `,
    params: [tenantId, userEmail, PRIVILEGED_ROLES],
  });

  return (adminCheckResult.rows || []).length > 0;
}

async function getActivePrivilegedCount(applicationContext, tenantId) {
  const adminCountResult = await applicationContext.db.query({
    operation: "tenant.privilegedCount",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM core_tenant_user
      WHERE tenant = $1
        AND role = ANY($2::text[])
        AND deactivated IS NULL
    `,
    params: [tenantId, PRIVILEGED_ROLES],
  });

  return adminCountResult.rows?.[0]?.count ?? 0;
}

module.exports = function buildTenantRouter(applicationContext) {
  const router = express.Router();
  router.use(applicationContext.requireAuth);

  // ------------------------------------------------------------
  // CREATE TENANT (Authenticated)
  // - Creates tenant row
  // - Adds creator to tenant as administrator
  // - Writes tenant log
  // ------------------------------------------------------------
  router.post("/create", asyncHandler(async (request, response) => {
    const actingUserEmail = request.auth.email;
    const tenantName = String(request.body?.full_name || "").trim();
    const rawSubdomain = String(request.body?.subdomain || "").trim();

    if (!tenantName) {
      applicationContext.logger.warn("Tenant create missing full_name", { op: "tenant.create", actingUserEmail });
      return response.status(400).json({ ok: false, error: "full_name required" });
    }

    const subdomain = rawSubdomain ? applicationContext.slugifySubdomain(rawSubdomain) : null;

    if (rawSubdomain && !subdomain) {
      applicationContext.logger.warn("Tenant create invalid subdomain", { op: "tenant.create", actingUserEmail });
      return response.status(400).json({ ok: false, error: "invalid subdomain" });
    }

    if (subdomain) {
      const subdomainCheckResult = await applicationContext.db.query({
        operation: "tenant.create.subdomainCheck",
        sql: `SELECT 1 FROM core_tenant WHERE subdomain = $1 LIMIT 1`,
        params: [subdomain],
      });

      if ((subdomainCheckResult.rows || []).length) {
        applicationContext.logger.warn("Tenant create subdomain in use", { op: "tenant.create", actingUserEmail, subdomain });
        return response.status(409).json({ ok: false, error: "subdomain already in use" });
      }
    }

    const tenantInsertResult = await applicationContext.db.query({
      operation: "tenant.create.insert",
      sql: `
        INSERT INTO core_tenant (full_name, subdomain, create_user, created, updated)
        VALUES ($1, $2, $3, now(), now())
        RETURNING id
      `,
      params: [tenantName, subdomain, actingUserEmail],
    });

    const tenantId = tenantInsertResult.rows[0].id;

    await applicationContext.db.query({
      operation: "tenant.create.addCreatorAdmin",
      sql: `
        INSERT INTO core_tenant_user
          (tenant, user_email, role, create_user, created, update_user, updated, deactivated)
        VALUES
          ($1, $2, 'administrator', $2, now(), null, null, null)
        ON CONFLICT DO NOTHING
      `,
      params: [tenantId, actingUserEmail],
    });

    await insertTenantLog(applicationContext, tenantId, actingUserEmail, "Created tenant (creator added as administrator)");
    response.json({ ok: true, tenant_id: tenantId });
  }));

  // ------------------------------------------------------------
  // UPDATE TENANT (Authenticated, admin/owner only)
  // - Updates name and/or subdomain
  // - Enforces unique subdomain
  // - Writes tenant log
  // ------------------------------------------------------------
  router.post("/update", asyncHandler(async (request, response) => {
    const actingUserEmail = request.auth.email;
    const tenantId = Number(request.body?.tenant_id);
    const tenantName = request.body?.full_name;
    const rawSubdomain = request.body?.subdomain;

    if (!Number.isFinite(tenantId)) {
      applicationContext.logger.warn("Tenant update missing tenant_id", { op: "tenant.update", actingUserEmail });
      return response.status(400).json({ ok: false, error: "tenant_id required" });
    }

    const isAdmin = await isTenantAdministrator(applicationContext, tenantId, actingUserEmail);
    if (!isAdmin) {
      applicationContext.logger.warn("Tenant update not admin", { op: "tenant.update", actingUserEmail, tenantId });
      return response.status(403).json({ ok: false, error: "admin required" });
    }

    let subdomain = null;
    if (rawSubdomain !== undefined) {
      const normalized = String(rawSubdomain || "").trim();
      subdomain = normalized ? applicationContext.slugifySubdomain(normalized) : null;

      if (normalized && !subdomain) {
        applicationContext.logger.warn("Tenant update invalid subdomain", { op: "tenant.update", actingUserEmail, tenantId });
        return response.status(400).json({ ok: false, error: "invalid subdomain" });
      }

      if (subdomain) {
        const existsResult = await applicationContext.db.query({
          operation: "tenant.update.subdomainCheck",
          sql: `SELECT 1 FROM core_tenant WHERE subdomain = $1 AND id <> $2 LIMIT 1`,
          params: [subdomain, tenantId],
        });

        if ((existsResult.rows || []).length) {
          applicationContext.logger.warn("Tenant update subdomain in use", { op: "tenant.update", actingUserEmail, tenantId, subdomain });
          return response.status(409).json({ ok: false, error: "subdomain already in use" });
        }
      }
    }

    await applicationContext.db.query({
      operation: "tenant.update.updateRow",
      sql: `
        UPDATE core_tenant
        SET full_name = COALESCE($1, full_name),
            subdomain = COALESCE($2, subdomain),
            updated = now()
        WHERE id = $3
      `,
      params: [tenantName ?? null, rawSubdomain !== undefined ? subdomain : null, tenantId],
    });

    await insertTenantLog(applicationContext, tenantId, actingUserEmail, "Updated tenant settings");
    response.json({ ok: true });
  }));

  // ------------------------------------------------------------
  // SUBDOMAIN CHECK (Authenticated)
  // - Normalizes slug and checks availability
  // ------------------------------------------------------------
  router.get("/subdomaincheck", asyncHandler(async (request, response) => {
    const subdomain = applicationContext.slugifySubdomain(String(request.query?.subdomain || ""));
    if (!subdomain) {
      applicationContext.logger.warn("Subdomain check missing subdomain", { op: "tenant.subdomainCheck" });
      return response.status(400).json({ ok: false, error: "subdomain required" });
    }

    const existsResult = await applicationContext.db.query({
      operation: "tenant.subdomainCheck.query",
      sql: `SELECT 1 FROM core_tenant WHERE subdomain = $1 LIMIT 1`,
      params: [subdomain],
    });

    response.json({ ok: true, subdomain, available: (existsResult.rows || []).length === 0 });
  }));

  // ------------------------------------------------------------
  // ADD USER (Authenticated, admin/owner only)
  // - Adds an active user into tenant with role owner|administrator|users
  // - Prevents duplicates
  // - Writes tenant log
  // ------------------------------------------------------------
  router.post("/user/add", asyncHandler(async (request, response) => {
    const actingUserEmail = request.auth.email;
    const tenantId = Number(request.body?.tenant_id);
    const targetUserEmail = String(request.body?.user_email || "").trim().toLowerCase();
    const role = String(request.body?.role || "users").trim().toLowerCase();

    if (!Number.isFinite(tenantId) || !targetUserEmail) {
      applicationContext.logger.warn("Tenant add user invalid input", { op: "tenant.user.add", actingUserEmail });
      return response.status(400).json({ ok: false, error: "tenant_id and user_email required" });
    }

    if (!ALL_ROLES.includes(role)) {
      applicationContext.logger.warn("Tenant add user invalid role", { op: "tenant.user.add", actingUserEmail, tenantId });
      return response.status(400).json({ ok: false, error: "role must be owner|administrator|users" });
    }

    const isAdmin = await isTenantAdministrator(applicationContext, tenantId, actingUserEmail);
    if (!isAdmin) {
      applicationContext.logger.warn("Tenant add user not admin", { op: "tenant.user.add", actingUserEmail, tenantId });
      return response.status(403).json({ ok: false, error: "admin required" });
    }

    const activeUserCheckResult = await applicationContext.db.query({
      operation: "tenant.user.add.userExists",
      sql: `SELECT 1 FROM core_user WHERE email = $1 AND activated IS NOT NULL AND deactivated IS NULL LIMIT 1`,
      params: [targetUserEmail],
    });

    if (!(activeUserCheckResult.rows || []).length) {
      applicationContext.logger.warn("Tenant add user target not active", { op: "tenant.user.add", actingUserEmail, tenantId });
      return response.status(400).json({ ok: false, error: "user not found or not active" });
    }

    const existingMembershipResult = await applicationContext.db.query({
      operation: "tenant.user.add.existingCheck",
      sql: `
        SELECT 1
        FROM core_tenant_user
        WHERE tenant = $1 AND user_email = $2 AND deactivated IS NULL
        LIMIT 1
      `,
      params: [tenantId, targetUserEmail],
    });

    if ((existingMembershipResult.rows || []).length) {
      applicationContext.logger.warn("Tenant add user already active", { op: "tenant.user.add", actingUserEmail, tenantId });
      return response.status(409).json({ ok: false, error: "user already active in tenant" });
    }

    await applicationContext.db.query({
      operation: "tenant.user.add.insert",
      sql: `
        INSERT INTO core_tenant_user
          (tenant, user_email, role, create_user, created, update_user, updated, deactivated)
        VALUES
          ($1, $2, $3, $4, now(), null, null, null)
      `,
      params: [tenantId, targetUserEmail, role, actingUserEmail],
    });

    await insertTenantLog(applicationContext, tenantId, actingUserEmail, `Added user ${targetUserEmail} (${role})`);
    response.json({ ok: true });
  }));

  // ------------------------------------------------------------
  // UPDATE USER ROLE (Authenticated, admin/owner only)
  // - Updates an active tenant user's role
  // - Prevents removing last privileged (owner/admin)
  // - Writes tenant log
  // ------------------------------------------------------------
  router.post("/user/update", asyncHandler(async (request, response) => {
    const actingUserEmail = request.auth.email;
    const tenantId = Number(request.body?.tenant_id);
    const targetUserEmail = String(request.body?.user_email || "").trim().toLowerCase();
    const role = String(request.body?.role || "").trim().toLowerCase();

    if (!Number.isFinite(tenantId) || !targetUserEmail) {
      applicationContext.logger.warn("Tenant update user invalid input", { op: "tenant.user.update", actingUserEmail });
      return response.status(400).json({ ok: false, error: "tenant_id and user_email required" });
    }

    if (!ALL_ROLES.includes(role)) {
      applicationContext.logger.warn("Tenant update user invalid role", { op: "tenant.user.update", actingUserEmail, tenantId });
      return response.status(400).json({ ok: false, error: "role must be owner|administrator|users" });
    }

    const isAdmin = await isTenantAdministrator(applicationContext, tenantId, actingUserEmail);
    if (!isAdmin) {
      applicationContext.logger.warn("Tenant update user not admin", { op: "tenant.user.update", actingUserEmail, tenantId });
      return response.status(403).json({ ok: false, error: "admin required" });
    }

    const membershipResult = await applicationContext.db.query({
      operation: "tenant.user.update.lookup",
      sql: `
        SELECT role
        FROM core_tenant_user
        WHERE tenant = $1 AND user_email = $2 AND deactivated IS NULL
        LIMIT 1
      `,
      params: [tenantId, targetUserEmail],
    });

    if (!(membershipResult.rows || []).length) {
      applicationContext.logger.warn("Tenant update user not found", { op: "tenant.user.update", actingUserEmail, tenantId });
      return response.status(404).json({ ok: false, error: "tenant user not found" });
    }

    const currentRole = membershipResult.rows[0].role;

    // Prevent removing last privileged (owner/admin) by demotion
    if (PRIVILEGED_ROLES.includes(currentRole) && !PRIVILEGED_ROLES.includes(role)) {
      const activePrivilegedCount = await getActivePrivilegedCount(applicationContext, tenantId);
      if (activePrivilegedCount <= 1) {
        applicationContext.logger.warn("Tenant update would remove last privileged", { op: "tenant.user.update", tenantId });
        return response.status(409).json({ ok: false, error: "tenant must have at least 1 owner/administrator" });
      }
    }

    await applicationContext.db.query({
      operation: "tenant.user.update.updateRow",
      sql: `
        UPDATE core_tenant_user
        SET role = $1, update_user = $2, updated = now()
        WHERE tenant = $3 AND user_email = $4 AND deactivated IS NULL
      `,
      params: [role, actingUserEmail, tenantId, targetUserEmail],
    });

    await insertTenantLog(applicationContext, tenantId, actingUserEmail, `Updated role for ${targetUserEmail} -> ${role}`);
    response.json({ ok: true });
  }));

  // ------------------------------------------------------------
  // DEACTIVATE USER (Authenticated, admin/owner only)
  // - Deactivates an active tenant user
  // - Prevents removing last privileged (owner/admin)
  // - Writes tenant log
  // ------------------------------------------------------------
  router.post("/user/deactivate", asyncHandler(async (request, response) => {
    const actingUserEmail = request.auth.email;
    const tenantId = Number(request.body?.tenant_id);
    const targetUserEmail = String(request.body?.user_email || "").trim().toLowerCase();

    if (!Number.isFinite(tenantId) || !targetUserEmail) {
      applicationContext.logger.warn("Tenant deactivate user invalid input", { op: "tenant.user.deactivate", actingUserEmail });
      return response.status(400).json({ ok: false, error: "tenant_id and user_email required" });
    }

    const isAdmin = await isTenantAdministrator(applicationContext, tenantId, actingUserEmail);
    if (!isAdmin) {
      applicationContext.logger.warn("Tenant deactivate user not admin", { op: "tenant.user.deactivate", actingUserEmail, tenantId });
      return response.status(403).json({ ok: false, error: "admin required" });
    }

    const membershipResult = await applicationContext.db.query({
      operation: "tenant.user.deactivate.lookup",
      sql: `
        SELECT role
        FROM core_tenant_user
        WHERE tenant = $1 AND user_email = $2 AND deactivated IS NULL
        LIMIT 1
      `,
      params: [tenantId, targetUserEmail],
    });

    if (!(membershipResult.rows || []).length) {
      applicationContext.logger.warn("Tenant deactivate user not found", { op: "tenant.user.deactivate", actingUserEmail, tenantId });
      return response.status(404).json({ ok: false, error: "tenant user not found" });
    }

    const targetRole = membershipResult.rows[0].role;

    // Prevent removing last privileged (owner/admin) by deactivation
    if (PRIVILEGED_ROLES.includes(targetRole)) {
      const activePrivilegedCount = await getActivePrivilegedCount(applicationContext, tenantId);
      if (activePrivilegedCount <= 1) {
        applicationContext.logger.warn("Tenant deactivate would remove last privileged", { op: "tenant.user.deactivate", tenantId });
        return response.status(409).json({ ok: false, error: "tenant must have at least 1 owner/administrator" });
      }
    }

    await applicationContext.db.query({
      operation: "tenant.user.deactivate.updateRow",
      sql: `
        UPDATE core_tenant_user
        SET deactivated = now(), update_user = $1, updated = now()
        WHERE tenant = $2 AND user_email = $3 AND deactivated IS NULL
      `,
      params: [actingUserEmail, tenantId, targetUserEmail],
    });

    await insertTenantLog(applicationContext, tenantId, actingUserEmail, `Deactivated user ${targetUserEmail}`);
    response.json({ ok: true });
  }));

  // List tenants the current user belongs to
// GET /auth/tenant/list
router.get("/list", async (req, res, next) => {
  try {
    // 1) Auth guard (adjust fields to match your auth middleware)
    const email = req.auth?.email;
    if (!email) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // 2) Query (parameterized)
    const sql = `
      SELECT
        t.id,
        t.full_name,
        t.subdomain,
        tu.role,
        t.created,
        t.updated
      FROM core_tenant_user tu
      JOIN core_tenant t
        ON t.id = tu.tenant
      WHERE
        tu.user_email = ?
        AND tu.deactivated IS NULL
      ORDER BY t.full_name ASC
    `;

    const rows = await applicationContext.db.query(sql, [email]);

    // 3) Success response
    return res.status(200).json({ ok: true, tenants: rows });
  } catch (err) {
    // 4) Log real error, respond generically via your error middleware
    console.error("GET /auth/tenant/list failed:", err);
    return next(err);
  }
});

router.get(
  "/tenants",
  applicationContext.requireAuth,
  asyncHandler(async (request, response) => {
    // requireAuth should set request.auth
    if (!request.auth?.email) {
      return response.status(401).json({ ok: false, error: "not authenticated" });
    }

    const email = String(request.auth.email).toLowerCase();

    // (Optional) verify the user exists + isn’t deactivated (matches your /me behavior)
    const userResult = await applicationContext.db.query({
      operation: "user.tenants.userLookup",
      sql: `
        SELECT email, deactivated
        FROM core_user
        WHERE email = $1
        LIMIT 1
      `,
      params: [email],
    });

    if (!userResult.rows?.length) {
      return response.status(404).json({ ok: false, error: "user not found" });
    }

    const user = userResult.rows[0];
    if (user.deactivated) {
      return response.status(403).json({ ok: false, error: "user deactivated" });
    }

    // List tenants for this user
    const tenantsResult = await applicationContext.db.query({
      operation: "user.tenants.list",
      sql: `
        SELECT
          t.id,
          t.full_name,
          t.subdomain,
          tu.role
        FROM core_tenant_user tu
        JOIN core_tenant t
          ON t.id = tu.tenant
        WHERE
          tu.user_email = $1
          AND tu.deactivated IS NULL
        ORDER BY t.full_name ASC
      `,
      params: [email],
    });

    return response.json({
      ok: true,
      tenants: tenantsResult.rows || [],
    });
  })
);

  return router;
};