(function () {
  const { qs, apiFetch, setMessage, prefillFromQuery } = window.CoreApi;

  const form = qs("#forgotResetForm");
  const msg = qs("#message");

  const pre = prefillFromQuery();
  if (pre.email) qs("#email").value = pre.email;
  if (pre.token) qs("#token").value = pre.token;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage(msg, "ok", "");

    const email = qs("#email").value.trim();
    const token = qs("#token").value.trim();
    const new_password = qs("#new_password").value;

    try {
      await apiFetch("/auth/user/forgotpassword", {
        method: "POST",
        json: { email, token, new_password }
      });

      setMessage(msg, "ok", "Password updated. You can log in now.");

      setTimeout(() => {
        const u = new URL("login.html", window.location.href);
        u.searchParams.set("email", email);
        window.location.href = u.toString();
      }, 800);
    } catch (err) {
      setMessage(msg, "err", err.message || "Reset failed");
    }
  });
})();
