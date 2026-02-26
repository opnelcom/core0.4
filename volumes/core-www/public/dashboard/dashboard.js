(function () {
  const { qs, apiFetch } = window.CoreApi;

  const headerUser = qs("#headerUser");
  const tenantSelect = qs("#tenantSelect");

  const appsList = qs("#appsList");
  const appsMessage = qs("#appsMessage");
  const appsBadge = qs("#appsBadge");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function pickTenantLabel(t) {
    const name = t.full_name || t.name || t.tenant_name || t.id || "Tenant";
    const sub = t.subdomain ? ` @${t.subdomain}` : "";
    return `${name}${sub}`;
  }

  function renderTenantsDropdown(tenants) {
    if (!tenantSelect) return;

    if (!Array.isArray(tenants) || tenants.length === 0) {
      tenantSelect.innerHTML = `<option value="">No tenants</option>`;
      tenantSelect.disabled = true;
      return;
    }

    tenantSelect.disabled = false;

    const opts = tenants.map((t, i) => {
      const id = t.id ?? t.tenant_id ?? t.tenant_uuid ?? String(i);
      const label = pickTenantLabel(t);
      return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
    }).join("");

    tenantSelect.innerHTML = opts;
  }

  function renderUser(u) {
    if (!headerUser) return;
    const displayName = u.full_name || u.nick_name || u.email || "User";
    headerUser.innerHTML = `👤 ${escapeHtml(displayName)}`;
  }

  function safeAppUrl(url) {
    // Allow only http(s) URLs; fall back to "#" if missing/unsafe
    try {
      const u = new URL(url, window.location.origin);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch { }
    return "#";
  }

  function renderApps(payload) {
    if (!appsList) return;

    const apps = payload?.apps;
    const isAdmin = Boolean(payload?.administrator);

    if (appsBadge) {
      appsBadge.hidden = !isAdmin;
    }

    if (!Array.isArray(apps) || apps.length === 0) {
      if (appsMessage) appsMessage.textContent = "No apps available.";
      appsList.innerHTML = "";
      return;
    }

    if (appsMessage) appsMessage.textContent = "";

    const items = apps.map(app => {
      const name = app.name || app.code || "App";
      const desc = app.description || "";
      const href = safeAppUrl(app.url);
      const tooltip = `${name}\n\n${desc}\n\n${href}`;

      // icon_svg is trusted server output; if you don't trust it, strip it or render a default icon.
      const icon = app.icon_svg
        ? `<span class="apps-icon" aria-hidden="true">${app.icon_svg}</span>`
        : `<span class="apps-icon" aria-hidden="true">⬚</span>`;

      return `
        <li>
          <button class="apps-item" data-url="${escapeHtml(href)}" type="button">
            ${icon}
            <span class="apps-meta">
              <span class="apps-name">${escapeHtml(name)}</span>
            </span>
          </button>
        </li>
      `;
    }).join("");

    appsList.innerHTML = items;
  }

  const appFrame = document.getElementById("appFrame");

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".apps-item");
    if (!btn) return;

    const url = btn.dataset.url;
    if (!url || !appFrame) return;

    appFrame.src = url;
  });

  async function loadMe() {
    try {
      const r = await apiFetch("/auth/user/me", { method: "GET" });
      if (!r.data || !r.data.ok) throw new Error("Unexpected response");

      const user = r.data.user || r.data;
      renderUser(user);
      renderTenantsDropdown(r.data.tenants);
    } catch (err) {
      if (err.status === 401) {
        window.location.href = "login.html";
        return;
      }
      if (headerUser) headerUser.textContent = "👤 Unknown";
      if (tenantSelect) {
        tenantSelect.innerHTML = `<option value="">Could not load tenants</option>`;
        tenantSelect.disabled = true;
      }
      console.error("Failed to load /auth/user/me:", err);
    }
  }

  async function loadApps() {
    if (appsMessage) appsMessage.textContent = "Loading…";

    try {
      const r = await apiFetch("/auth/user/apps", { method: "GET" });
      if (!r.data || !r.data.ok) throw new Error("Unexpected response");
      renderApps(r.data);
    } catch (err) {
      if (err.status === 401) return; // /me handler will redirect
      if (appsMessage) appsMessage.textContent = "Could not load apps.";
      if (appsList) appsList.innerHTML = "";
      console.error("Failed to load /auth/user/apps:", err);
    }
  }

  tenantSelect?.addEventListener("change", () => {
    sessionStorage.setItem("activeTenantId", tenantSelect.value);
  });

  loadMe();
  loadApps();
})();