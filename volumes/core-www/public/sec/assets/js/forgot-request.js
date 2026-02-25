(function () {
  const { qs, apiFetch, setMessage } = window.CoreApi;

  const form = qs("#forgotRequestForm");
  const msg = qs("#message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage(msg, "ok", "");

    const email = qs("#email").value.trim();

    try {
      await apiFetch("/auth/user/forgotpassword", { method: "POST", json: { email } });
      setMessage(msg, "ok", "If that account exists, a reset token has been sent. Check your email.");

      setTimeout(() => {
        const u = new URL("forgot-reset.html", window.location.href);
        u.searchParams.set("email", email);
        window.location.href = u.toString();
      }, 700);
    } catch (err) {
      setMessage(msg, "err", err.message || "Request failed");
    }
  });
})();
