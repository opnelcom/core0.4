"use strict";

// Change this if your API is hosted elsewhere (e.g. https://api.example.com)
const API_BASE = "";

// Storage keys
const LS_SELECTED_TENANT = "core.selectedTenantId";
const LS_SIDEBAR_COLLAPSED = "core.sidebarCollapsed";
const LS_LAST_APP_CODE = "core.lastAppCode";

function $(id) {
  return document.getElementById(id);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include", // IMPORTANT for cookie-based auth
  });

  // Try to parse JSON, but don’t crash if it isn’t
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { res, body };
}

function redirectToLogin() {
  window.location.href = "login.html";
}

function safeText(v, fallback = "") {
  return (v === null || v === undefined) ? fallback : String(v);
}

function normalizeSvg(svgText) {
  const s = safeText(svgText).trim();
  if (!s) return "";
  // Basic safety: only allow SVG root-ish content (you can strengthen later)
  if (!/^\s*<svg[\s>]/i.test(s)) return "";
  return s;
}

function defaultAppIconSvg() {
  // simple grid icon
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none">
    <rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/>
  </svg>`;
}

function setSidebarCollapsed(collapsed) {
  const root = $("root");
  if (!root) return;
  root.classList.toggle("collapsed", collapsed);
  localStorage.setItem(LS_SIDEBAR_COLLAPSED, collapsed ? "1" : "0");
}

function getSidebarCollapsed() {
  return localStorage.getItem(LS_SIDEBAR_COLLAPSED) === "1";
}

function setSelectedTenant(tenantId) {
  localStorage.setItem(LS_SELECTED_TENANT, String(tenantId || ""));
}

function getSelectedTenant() {
  return localStorage.getItem(LS_SELECTED_TENANT) || "";
}

function setActiveAppCode(code) {
  localStorage.setItem(LS_LAST_APP_CODE, String(code || ""));
}

function getActiveAppCode() {
  return localStorage.getItem(LS_LAST_APP_CODE) || "";
}

function renderTenants(tenants) {
  const select = $("tenantSelect");
  select.innerHTML = "";

  if (!Array.isArray(tenants) || tenants.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No tenants";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  const preferred = getSelectedTenant();
  let selected = preferred;

  // If saved tenant not present, fall back to first
  if (selected && !tenants.some(t => String(t.id) === String(selected))) {
    selected = "";
  }
  if (!selected) selected = String(tenants[0].id);

  tenants.forEach(t => {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    const name = safeText(t.full_name || t.name || `Tenant ${t.id}`);
    const sub = safeText(t.subdomain, "");
    const role = safeText(t.role, "");
    opt.textContent = sub ? `${name} (${sub}) — ${role}` : `${name} — ${role}`;
    select.appendChild(opt);
  });

  select.value = selected;
  setSelectedTenant(selected);

  select.addEventListener("change", () => {
    setSelectedTenant(select.value);
    // If later you want tenant-specific app filtering, you’d re-fetch apps here.
  });
}

function renderUser(user) {
  $("userName").textContent =
    safeText(user.full_name || user.nick_name || user.email || "User");
  $("userEmail").textContent = safeText(user.email, "");
}

function setFrameApp(app) {
  const title = $("contentTitle");
  const urlEl = $("contentUrl");
  const frame = $("appFrame");

  if (!app) {
    title.textContent = "Select an application";
    urlEl.textContent = "";
    frame.src = "about:blank";
    return;
  }

  title.textContent = safeText(app.name || app.code || "Application");
  urlEl.textContent = safeText(app.url || "");
  frame.src = safeText(app.url || "about:blank");

  setActiveAppCode(app.code || "");
}

function renderApps(apps) {
  const list = $("appList");
  list.innerHTML = "";

  const lastCode = getActiveAppCode();

  if (!Array.isArray(apps) || apps.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "rgba(0,0,0,.65)";
    empty.style.padding = "10px";
    empty.textContent = "No applications available.";
    list.appendChild(empty);
    return;
  }

  let firstApp = apps[0];
  let matchApp = lastCode ? apps.find(a => String(a.code) === String(lastCode)) : null;
  if (matchApp) firstApp = matchApp;

  apps.forEach(app => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-item";
    btn.dataset.code = safeText(app.code, "");

    const icon = document.createElement("div");
    icon.className = "app-icon";

    const svg = normalizeSvg(app.icon_svg);
    icon.innerHTML = svg || defaultAppIconSvg();

    const textWrap = document.createElement("div");
    const name = document.createElement("div");
    name.className = "app-name";
    name.textContent = safeText(app.name || app.code || "App");

    const desc = document.createElement("div");
    desc.className = "app-desc";
    desc.textContent = safeText(app.description || "");

    textWrap.appendChild(name);
    textWrap.appendChild(desc);

    btn.appendChild(icon);
    btn.appendChild(textWrap);

    btn.addEventListener("click", () => {
      [...list.querySelectorAll(".app-item")].forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      setFrameApp(app);
    });

    list.appendChild(btn);
  });

  // Activate the first (or remembered) app
  const activeButton = [...list.querySelectorAll(".app-item")]
    .find(x => x.dataset.code === String(firstApp.code));
  if (activeButton) activeButton.click();
}

async function handleLogout() {
  try {
    await apiFetch("/auth/user/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // ignore
  }
  redirectToLogin();
}

async function handleChangePassword() {
  const oldPw = prompt("Enter your current password:");
  if (!oldPw) return;

  const newPw = prompt("Enter your new password (min 8 chars):");
  if (!newPw) return;

  const { res, body } = await apiFetch("/auth/user/changepassword", {
    method: "POST",
    body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
  });

  if (!res.ok || !body?.ok) {
    alert(body?.error || "Failed to change password.");
    if (res.status === 401) redirectToLogin();
    return;
  }

  alert("Password changed successfully.");
}

async function handleProfileUpdate() {
  const nick = prompt("New nickname (leave blank to keep):") ?? "";
  const full = prompt("New full name (leave blank to keep):") ?? "";

  const payload = {
    nick_name: nick.trim() ? nick.trim() : null,
    full_name: full.trim() ? full.trim() : null,
  };

  const { res, body } = await apiFetch("/auth/user/update", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok || !body?.ok) {
    alert(body?.error || "Failed to update profile.");
    if (res.status === 401) redirectToLogin();
    return;
  }

  // Refresh header user info
  await loadAll();
  alert("Profile updated.");
}

async function loadAll() {
  // 1) Load user + tenants
  const me = await apiFetch("/auth/user/me", { method: "GET" });
  if (!me.res.ok || !me.body?.ok) return false;

  renderUser(me.body.user || {});
  renderTenants(me.body.tenants || []);

  // 2) Load apps (your /auth/user/apps route should SELECT url + icon_svg too)
  const apps = await apiFetch("/auth/user/apps", { method: "GET" });
  if (!apps.res.ok || !apps.body?.ok) return false;

  renderApps(apps.body.apps || []);
  return true;
}

async function main() {
  // Sidebar collapse state
  setSidebarCollapsed(getSidebarCollapsed());

  $("btnToggleNav").addEventListener("click", () => {
    setSidebarCollapsed(!getSidebarCollapsed());
  });

  $("btnLogout").addEventListener("click", handleLogout);
  $("btnChangePw").addEventListener("click", handleChangePassword);
  $("btnProfile").addEventListener("click", handleProfileUpdate);

  const ok = await loadAll();
  if (!ok) redirectToLogin();
}

document.addEventListener("DOMContentLoaded", main);