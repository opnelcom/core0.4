(function () {
  const { qs, apiFetch, setMessage, prefillFromQuery } = window.CoreApi;

  const form = qs("#activateForm");
  const msg = qs("#message");

  const pre = prefillFromQuery();
  if (pre.email) qs("#email").value = pre.email;
  if (pre.token) qs("#token").value = pre.token;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage(msg, "ok", "");

    const email = qs("#email").value.trim();
    const token = qs("#token").value.trim();

    try {
      await apiFetch("/auth/user/activate", { method: "POST", json: { email, token } });
      setMessage(msg, "ok", "Activated! You can log in now.");

      setTimeout(() => {
        const u = new URL("login.html", window.location.href);
        u.searchParams.set("email", email);
        window.location.href = u.toString();
      }, 700);
    } catch (err) {
      setMessage(msg, "err", err.message || "Activation failed");
    }
  });
})();
