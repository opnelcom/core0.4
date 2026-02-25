"use strict";

// If your API is on a different origin, set API_BASE to that full origin (e.g. "https://api.example.com")
const API_BASE = "";

function redirectToLogin() {
  window.location.href = "login.html";
}

async function apiGetMe() {
  const res = await fetch(API_BASE + "/auth/user/me", {
    method: "GET",
    credentials: "include", // IMPORTANT for cookie auth
    headers: { "accept": "application/json" },
  });

  let body = null;
  try { body = await res.json(); } catch { body = null; }

  return { res, body };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderTenants(tenants) {
  const tbody = document.getElementById("tenantBody");
  tbody.innerHTML = "";

  if (!Array.isArray(tenants) || tenants.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted">No tenants</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const t of tenants) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${String(t.id ?? "")}</td>
      <td>${String(t.full_name ?? "")}</td>
      <td>${String(t.subdomain ?? "")}</td>
      <td>${String(t.role ?? "")}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function load() {
  const { res, body } = await apiGetMe();

  // Not authenticated -> go login
  if (!res.ok || !body?.ok) {
    redirectToLogin();
    return;
  }

  const user = body.user || {};
  setText("fullName", user.full_name || user.nick_name || user.email || "(unknown)");
  setText("email", user.email || "");
  setText("activated", user.activated ? "Activated" : "Not activated");

  renderTenants(body.tenants || []);

  const rawEl = document.getElementById("raw");
  rawEl.textContent = JSON.stringify(body, null, 2);
}

async function logout() {
  try {
    await fetch(API_BASE + "/auth/user/logout", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    // ignore
  }
  redirectToLogin();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnRefresh").addEventListener("click", load);
  document.getElementById("btnLogout").addEventListener("click", logout);
  document.getElementById("btnGoLanding").addEventListener("click", () => {
    window.location.href = "landing.html";
  });

  load();
});