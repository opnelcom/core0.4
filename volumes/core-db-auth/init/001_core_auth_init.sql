-- 001_core_auth_init.sql
-- Core Auth database schema

BEGIN;

-- ----------------------------
-- core_user
-- ----------------------------
CREATE TABLE IF NOT EXISTS core_user (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  nick_name       TEXT NULL,
  full_name       TEXT NULL,
  created         TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated       TIMESTAMPTZ NULL DEFAULT NULL,
  deactivated     TIMESTAMPTZ NULL DEFAULT NULL,
  password_hash   TEXT NOT NULL,
  token_hash      TEXT NULL,
  token_expiry    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_core_user_email ON core_user (email);
CREATE INDEX IF NOT EXISTS idx_core_user_token_hash ON core_user (token_hash);
CREATE INDEX IF NOT EXISTS idx_core_user_token_expiry ON core_user (token_expiry);

-- ----------------------------
-- core_user_session
-- NOTE: includes user_email so session cookie can map back to user.
-- ----------------------------
CREATE TABLE IF NOT EXISTS core_user_session (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_email         TEXT NOT NULL REFERENCES core_user(email) ON DELETE CASCADE,
  device_id          TEXT NOT NULL,
  session_id         TEXT NOT NULL UNIQUE,
  expiry             TIMESTAMPTZ NOT NULL,
  device_description TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_core_user_session_user_email ON core_user_session (user_email);
CREATE INDEX IF NOT EXISTS idx_core_user_session_expiry ON core_user_session (expiry);
CREATE INDEX IF NOT EXISTS idx_core_user_session_device_id ON core_user_session (device_id);

-- ----------------------------
-- core_user_log
-- ----------------------------
CREATE TABLE IF NOT EXISTS core_user_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_email TEXT NOT NULL,
  created    TIMESTAMPTZ NOT NULL DEFAULT now(),
  log        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_core_user_log_user_email ON core_user_log (user_email);
CREATE INDEX IF NOT EXISTS idx_core_user_log_created ON core_user_log (created);

-- ----------------------------
-- core_tenant
-- ----------------------------
CREATE TABLE IF NOT EXISTS core_tenant (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name   TEXT NOT NULL,
  subdomain   TEXT NULL UNIQUE,
  create_user TEXT NOT NULL,
  created     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_core_tenant_subdomain ON core_tenant (subdomain);

-- ----------------------------
-- core_tenant_user
-- Users can be deactivated on a tenant, never deleted.
-- A user can exist only once per tenant when active.
-- ----------------------------
CREATE TABLE IF NOT EXISTS core_tenant_user (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant      BIGINT NOT NULL REFERENCES core_tenant(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL REFERENCES core_user(email) ON DELETE RESTRICT,
  role        TEXT NOT NULL CHECK (role IN ('administrator', 'users')),
  create_user TEXT NOT NULL,
  created     TIMESTAMPTZ NOT NULL DEFAULT now(),
  update_user TEXT NULL,
  updated     TIMESTAMPTZ NULL,
  deactivated TIMESTAMPTZ NULL
);

-- One ACTIVE membership row per (tenant, user_email)
CREATE UNIQUE INDEX IF NOT EXISTS uq_core_tenant_user_active
  ON core_tenant_user (tenant, user_email)
  WHERE deactivated IS NULL;

CREATE INDEX IF NOT EXISTS idx_core_tenant_user_tenant ON core_tenant_user (tenant);
CREATE INDEX IF NOT EXISTS idx_core_tenant_user_user_email ON core_tenant_user (user_email);
CREATE INDEX IF NOT EXISTS idx_core_tenant_user_role ON core_tenant_user (tenant, role);

-- ----------------------------
-- core_tenant_log
-- ----------------------------
CREATE TABLE IF NOT EXISTS core_tenant_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant     BIGINT NOT NULL REFERENCES core_tenant(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  created    TIMESTAMPTZ NOT NULL DEFAULT now(),
  log        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_core_tenant_log_tenant ON core_tenant_log (tenant);
CREATE INDEX IF NOT EXISTS idx_core_tenant_log_created ON core_tenant_log (created);

COMMIT;
