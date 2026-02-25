(function () {
  const { qs, apiFetch, setMessage } = window.CoreApi;

  const userBox = qs("#userBox");
  const tenantsBox = qs("#tenantsBox");
  const userMsg = qs("#userMessage");
  const tenantsMsg = qs("#tenantsMessage");

  const logoutBtn = qs("#logoutBtn");
  const logoutAllBtn = qs("#logoutAllBtn");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function renderUser(u) {
    const email = u.email || "(unknown)";
    const nick = u.nick_name || "";
    const full = u.full_name || "";
    userBox.classList.remove("muted");
    userBox.innerHTML = `
      <div><strong>${escapeHtml(email)}</strong></div>
      <div class="muted">${escapeHtml([full, nick].filter(Boolean).join(" • ") || "—")}</div>
    `;
  }

  function renderTenants(list) {
    if (!Array.isArray(list) || list.length === 0) {
      tenantsBox.classList.add("muted");
      tenantsBox.textContent = "No tenants returned.";
      return;
    }

    tenantsBox.classList.remove("muted");
    const items = list.map(t => {
      const name = t.full_name || t.name || t.tenant_name || t.id || "Tenant";
      const sub = t.subdomain ? `@${t.subdomain}` : "";
      const role = t.role ? `<span class="pill">${escapeHtml(t.role)}</span>` : "";
      return `<li>${escapeHtml(name)} ${escapeHtml(sub)} ${role}</li>`;
    }).join("");

    tenantsBox.innerHTML = `<ul class="list">${items}</ul>`;
  }

  async function loadMe() {
    try {
      // Full /me endpoint recommended: { ok:true, user:{...}, tenants:[...] }
      const r = await apiFetch("/auth/user/me", { method: "GET" });
      if (!r.data || !r.data.ok) throw new Error("Unexpected response");

      const u = r.data.user || r.data;
      renderUser(u);

      // If /me includes tenants, use them. Otherwise fall back to /tenant/list.
      if (Array.isArray(r.data.tenants)) {
        renderTenants(r.data.tenants);
      } else {
        await loadTenants();
      }
    } catch (err) {
      if (err.status === 401) {
        window.location.href = "login.html";
        return;
      }
      userBox.classList.add("muted");
      userBox.textContent = "Could not load user.";
      setMessage(userMsg, "err", err.message || "Failed to load /auth/user/me");
    }
  }

  async function loadTenants() {
    try {
      const r = await apiFetch("/auth/tenant/tenants", { method: "GET" });
      if (!r.data || !r.data.ok) throw new Error("Unexpected response");
      renderTenants(r.data.tenants || r.data.rows || r.data);
    } catch (err) {
      if (err.status === 401) return;
      tenantsBox.classList.add("muted");
      tenantsBox.textContent = "Could not load tenants.";
      setMessage(tenantsMsg, "err", err.message || "Failed to load /auth/tenant/list");
    }
  }

  async function doLogout(all) {
    setMessage(userMsg, "ok", "");
    try {
      await apiFetch(all ? "/auth/user/logout-all" : "/auth/user/logout", { method: "POST", json: {} });
      window.location.href = "login.html";
    } catch (err) {
      setMessage(userMsg, "err", err.message || "Logout failed");
    }
  }

  logoutBtn?.addEventListener("click", () => doLogout(false));
  logoutAllBtn?.addEventListener("click", () => doLogout(true));

  loadMe();
})();
