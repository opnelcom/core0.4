(function () {
  const { qs, apiFetch, setMessage, prefillFromQuery } = window.CoreApi;

  const form = qs("#loginForm");
  const msg = qs("#message");

  const pre = prefillFromQuery();
  if (pre.email) qs("#email").value = pre.email;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage(msg, "ok", "");

    const email = qs("#email").value.trim();
    const password = qs("#password").value;
    const remember_me = !!qs("#remember_me").checked;
    const device_id = qs("#device_id").value.trim();

    try {
      const payload = { email, password, remember_me };
      if (device_id) payload.device_id = device_id;

      await apiFetch("/auth/user/login", { method: "POST", json: payload });
      setMessage(msg, "ok", "Logged in. Redirecting…");

      setTimeout(() => { window.location.href = "dashboard.html"; }, 500);
    } catch (err) {
      setMessage(msg, "err", err.message || "Login failed");
    }
  });
})();
