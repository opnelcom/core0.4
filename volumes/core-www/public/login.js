// =============================
// CONFIG
// =============================
const API_BASE = (new URLSearchParams(location.search).get("api") || "")
  .replace(/\/+$/, "");

document.getElementById("apiBaseLabel").textContent =
  API_BASE || "(same origin)";

// =============================
// HELPERS
// =============================
function showMsg(el, ok, text) {
  el.classList.remove("hidden", "ok", "err");
  el.classList.add(ok ? "ok" : "err");
  el.textContent = text;
}

function hideMsg(el) {
  el.classList.add("hidden");
  el.textContent = "";
}

async function api(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  return res.json();
}

// =============================
// TAB SWITCHING
// =============================
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b =>
      b.classList.remove("active")
    );
    document.querySelectorAll(".panel").forEach(p =>
      p.classList.remove("active")
    );

    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// =============================
// LOGIN
// =============================
document.getElementById("loginBtn").onclick = async () => {
  const json = await api("/auth/user/login", {
    email: loginEmail.value.trim(),
    password: loginPassword.value,
    remember_me: rememberMe.checked
  });

  if (json.ok) {
    location.href = "dashboard.html";
  } else {
    showMsg(loginMsg, false, json.error || "Login failed");
  }
};

// =============================
// REGISTER
// =============================
document.getElementById("registerBtn").onclick = async () => {
  const json = await api("/auth/user/register", {
    email: regEmail.value.trim(),
    password: regPassword.value
  });

  showMsg(
    registerMsg,
    json.ok,
    json.ok ? "Check email for activation token" : json.error
  );
};

// =============================
// ACTIVATE
// =============================
document.getElementById("activateBtn").onclick = async () => {
  const json = await api("/auth/user/activate", {
    email: actEmail.value.trim(),
    token: actToken.value.trim()
  });

  showMsg(
    activateMsg,
    json.ok,
    json.ok ? "Activated successfully" : json.error
  );
};

// =============================
// FORGOT PASSWORD
// =============================
document.getElementById("forgotBtn").onclick = async () => {
  const json = await api("/auth/user/forgotpassword", {
    email: fpEmail.value.trim(),
    token: fpToken.value.trim() || undefined,
    new_password: fpNewPassword.value || undefined
  });

  showMsg(
    forgotMsg,
    json.ok,
    json.ok ? "If valid, action completed." : json.error
  );
};

// =============================
// AUTO SESSION CHECK
// =============================
(async function checkSession() {
  try {
    const res = await fetch(
      API_BASE + "/auth/tenant/subdomaincheck?subdomain=test",
      { credentials: "include" }
    );
    if (res.ok) {
      location.href = "dashboard.html";
    }
  } catch {
    // silently ignore
  }
})();
