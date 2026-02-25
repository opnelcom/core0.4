// landing.js
/* =========================================================
   Landing page controller (vanilla JS)
   - Loads /auth/user/me and /auth/user/apps
   - Populates tenants, user details, apps
   - Persists tenant/app/sidebar state in localStorage
   - Profile + change password + logout
   ========================================================= */

(() => {
  const API_BASE = ""; // set to "https://your-api-host" if needed

  const LS = {
    tenantId: "core.selectedTenantId",
    collapsed: "core.sidebarCollapsed",
    lastAppCode: "core.lastAppCode",
  };

  const el = {
    shell: document.querySelector(".app-shell"),
    tenantSelect: document.getElementById("tenantSelect"),
    userName: document.getElementById("userName"),
    userEmail: document.getElementById("userEmail"),
    btnToggleNav: document.getElementById("btnToggleNav"),
    btnProfile: document.getElementById("btnProfile"),
    btnChangePw: document.getElementById("btnChangePw"),
    btnLogout: document.getElementById("btnLogout"),
    appList: document.getElementById("appList"),
    contentTitle: document.getElementById("contentTitle"),
    contentUrl: document.getElementById("contentUrl"),
    appFrame: document.getElementById("appFrame"),

    profileDialog: document.getElementById("profileDialog"),
    profileFullName: document.getElementById("profileFullName"),
    profileNickName: document.getElementById("profileNickName"),
    btnProfileSave: document.getElementById("btnProfileSave"),
    profileMsg: document.getElementById("profileMsg"),

    pwDialog: document.getElementById("pwDialog"),
    pwOld: document.getElementById("pwOld"),
    pwNew: document.getElementById("pwNew"),
    btnPwSave: document.getElementById("btnPwSave"),
    pwMsg: document.getElementById("pwMsg"),

    toast: document.getElementById("toast"),
  };

  /** ---------- helpers ---------- */

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function apiFetch(path, { method = "GET", body } = {}) {
    const init = {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(apiUrl(path), init);
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    return { res, data };
  }

  function redirectToLogin() {
    window.location.href = "login.html";
  }

  function safeText(v) {
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function showToast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => el.toast.classList.remove("show"), 2200);
  }

  function isValidSvg(svg) {
    if (typeof svg !== "string") return false;
    const s = svg.trim();
    return s.startsWith("<svg") && s.includes("</svg>");
  }

  function defaultAppSvg() {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11Z" stroke="currentColor" stroke-width="1.6"/>
        <path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    `;
  }

  function normalizeTenants(tenants) {
    if (!Array.isArray(tenants)) return [];
    return tenants.map((t) => ({
      id: safeText(t.id ?? t.tenant_id ?? t.uuid ?? t.subdomain ?? t.name),
      label:
        safeText(t.full_name ?? t.name ?? t.display_name ?? t.subdomain ?? t.id) +
        (t.subdomain ? ` — ${t.subdomain}` : "") +
        (t.role ? ` (${t.role})` : ""),
      raw: t,
    }));
  }

  function normalizeApps(apps) {
    if (!Array.isArray(apps)) return [];
    return apps
      .map((a) => ({
        code: safeText(a.code ?? a.id ?? a.name),
        name: safeText(a.name ?? a.title ?? a.code ?? "App"),
        description: safeText(a.description ?? ""),
        url: safeText(a.url ?? ""),
        icon_svg: safeText(a.icon_svg ?? ""),
        raw: a,
      }))
      .filter((a) => a.code);
  }

  function getDisplayName(user) {
    return (
      user?.full_name ||
      user?.nick_name ||
      user?.name ||
      user?.email ||
      "User"
    );
  }

  function setSidebarCollapsed(isCollapsed) {
    if (isCollapsed) el.shell.classList.add("nav-collapsed");
    else el.shell.classList.remove("nav-collapsed");
    localStorage.setItem(LS.collapsed, isCollapsed ? "1" : "0");
  }

  function restoreSidebarCollapsed() {
    const v = localStorage.getItem(LS.collapsed);
    setSidebarCollapsed(v === "1");
  }

  /** ---------- rendering ---------- */

  function renderTenants(tenants) {
    el.tenantSelect.innerHTML = "";
    if (!tenants.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No tenants";
      el.tenantSelect.appendChild(opt);
      return;
    }

    for (const t of tenants) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      el.tenantSelect.appendChild(opt);
    }

    const saved = localStorage.getItem(LS.tenantId);
    const pick = tenants.find((t) => t.id === saved) ? saved : tenants[0].id;
    el.tenantSelect.value = pick;
    localStorage.setItem(LS.tenantId, pick);
  }

  function renderUser(user) {
    el.userName.textContent = getDisplayName(user);
    el.userEmail.textContent = user?.email ? safeText(user.email) : "";
    el.profileFullName.value = safeText(user?.full_name ?? "");
    el.profileNickName.value = safeText(user?.nick_name ?? "");
  }

  function renderApps(apps) {
    el.appList.innerHTML = "";

    if (!apps.length) {
      const empty = document.createElement("div");
      empty.className = "app-desc";
      empty.textContent = "No applications available.";
      el.appList.appendChild(empty);
      el.contentTitle.textContent = "No applications";
      el.contentUrl.textContent = "";
      el.appFrame.removeAttribute("src");
      return;
    }

    for (const app of apps) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "app-item";
      btn.setAttribute("role", "listitem");
      btn.dataset.code = app.code;

      const icon = document.createElement("div");
      icon.className = "app-icon";
      icon.innerHTML = isValidSvg(app.icon_svg) ? app.icon_svg : defaultAppSvg();

      const textWrap = document.createElement("div");

      const name = document.createElement("div");
      name.className = "app-name";
      name.textContent = app.name;

      const desc = document.createElement("div");
      desc.className = "app-desc";
      desc.textContent = app.description || " ";

      textWrap.appendChild(name);
      textWrap.appendChild(desc);

      btn.appendChild(icon);
      btn.appendChild(textWrap);

      btn.addEventListener("click", () => selectApp(apps, app.code));
      el.appList.appendChild(btn);
    }

    const savedCode = localStorage.getItem(LS.lastAppCode);
    const initial = apps.find((a) => a.code === savedCode) ? savedCode : apps[0].code;
    selectApp(apps, initial);
  }

  function selectApp(apps, code) {
    const app = apps.find((a) => a.code === code) ?? apps[0];
    if (!app) return;

    for (const node of el.appList.querySelectorAll(".app-item")) {
      node.classList.toggle("active", node.dataset.code === app.code);
    }

    el.contentTitle.textContent = app.name || "Application";
    el.contentUrl.textContent = app.url || "";
    if (app.url) el.appFrame.src = app.url;
    else el.appFrame.removeAttribute("src");

    localStorage.setItem(LS.lastAppCode, app.code);
  }

  /** ---------- actions ---------- */

  async function logout() {
    try {
      await apiFetch("/auth/user/logout", { method: "POST", body: {} });
    } finally {
      redirectToLogin();
    }
  }

  function openDialog(d) {
    if (!d) return;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "true");
  }

  function closeDialog(d) {
    if (!d) return;
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
  }

  async function saveProfile() {
    el.profileMsg.textContent = "";
    const full_name = el.profileFullName.value.trim();
    const nick_name = el.profileNickName.value.trim();

    try {
      const { data } = await apiFetch("/auth/user/update", {
        method: "POST",
        body: { full_name, nick_name },
      });

      if (!data || data.ok !== true) {
        el.profileMsg.textContent = (data && data.error) ? safeText(data.error) : "Update failed.";
        return;
      }

      showToast("Profile updated");
      closeDialog(el.profileDialog);

      // Refresh user display if server returns updated user
      if (data.user) renderUser(data.user);
      else {
        // minimally update what we know
        el.userName.textContent = full_name || nick_name || el.userName.textContent;
      }
    } catch {
      el.profileMsg.textContent = "Update failed.";
    }
  }

  async function changePassword() {
    el.pwMsg.textContent = "";
    const old_password = el.pwOld.value;
    const new_password = el.pwNew.value;

    if (!old_password || !new_password) {
      el.pwMsg.textContent = "Please fill both fields.";
      return;
    }

    try {
      const { data } = await apiFetch("/auth/user/changepassword", {
        method: "POST",
        body: { old_password, new_password },
      });

      if (!data || data.ok !== true) {
        el.pwMsg.textContent = (data && data.error) ? safeText(data.error) : "Password update failed.";
        return;
      }

      el.pwOld.value = "";
      el.pwNew.value = "";
      showToast("Password updated");
      closeDialog(el.pwDialog);
    } catch {
      el.pwMsg.textContent = "Password update failed.";
    }
  }

  /** ---------- init ---------- */

  async function init() {
    restoreSidebarCollapsed();

    el.btnToggleNav.addEventListener("click", () => {
      const collapsed = el.shell.classList.contains("nav-collapsed");
      setSidebarCollapsed(!collapsed);
    });

    el.btnLogout.addEventListener("click", logout);

    el.btnProfile.addEventListener("click", () => {
      el.profileMsg.textContent = "";
      openDialog(el.profileDialog);
    });

    el.btnChangePw.addEventListener("click", () => {
      el.pwMsg.textContent = "";
      openDialog(el.pwDialog);
    });

    el.btnProfileSave.addEventListener("click", saveProfile);
    el.btnPwSave.addEventListener("click", changePassword);

    el.tenantSelect.addEventListener("change", () => {
      localStorage.setItem(LS.tenantId, el.tenantSelect.value);
      showToast("Tenant selected");
      // If your backend changes app list per tenant, you can re-fetch apps here.
      // loadApps();
    });

    // Load user + tenants
    const me = await apiFetch("/auth/user/me");
    if (!me.data || me.data.ok !== true) {
      redirectToLogin();
      return;
    }

    const user = me.data.user ?? me.data.me ?? me.data;
    const tenants = normalizeTenants(me.data.tenants ?? me.data.user?.tenants ?? []);
    renderUser(user);
    renderTenants(tenants);

    // Load apps
    const appsRes = await apiFetch("/auth/user/apps");
    if (!appsRes.data || appsRes.data.ok !== true) {
      redirectToLogin();
      return;
    }

    const apps = normalizeApps(appsRes.data.apps ?? []);
    renderApps(apps);
  }

  // Run
  window.addEventListener("DOMContentLoaded", () => {
    init().catch(() => redirectToLogin());
  });
})();