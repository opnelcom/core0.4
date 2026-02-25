(function () {
  const { qs, apiFetch, setMessage } = window.CoreApi;

  const form = qs("#registerForm");
  const msg = qs("#message");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage(msg, "ok", "");

    const email = qs("#email").value.trim();
    const password = qs("#password").value;
    const device_id = qs("#device_id").value.trim();

    try {
      const payload = { email, password };
      if (device_id) payload.device_id = device_id;

      const r = await apiFetch("/auth/user/register", { method: "POST", json: payload });

      const note = (r.data && r.data.message) ? r.data.message : "Registered. Check your email for activation token.";
      setMessage(msg, "ok", note);

      setTimeout(() => {
        const u = new URL("activate.html", window.location.href);
        u.searchParams.set("email", email);
        window.location.href = u.toString();
      }, 700);
    } catch (err) {
      // If server returns 409 with ok:true message, show it nicely.
      if (err.status === 409 && err.data && err.data.ok === true && err.data.message) {
        setMessage(msg, "ok", err.data.message);
        return;
      }
      setMessage(msg, "err", err.message || "Registration failed");
    }
  });
})();
