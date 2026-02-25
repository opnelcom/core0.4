// Basic API helper for JSON endpoints.
// Uses same-origin cookies (session_id is httpOnly, so the browser sends it automatically).
(function () {
  function qs(sel) { return document.querySelector(sel); }

  async function apiFetch(path, opts = {}) {
    const init = {
      method: opts.method || "GET",
      headers: { ...(opts.headers || {}) },
      credentials: "include",
    };

    if (opts.json !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.json);
    } else if (opts.body !== undefined) {
      init.body = opts.body;
    }

    const res = await fetch(path, init);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();

    let data = null;
    if (contentType.includes("application/json")) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      try { data = await res.text(); } catch { data = null; }
    }

    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return { status: res.status, data, headers: res.headers };
  }

  function setMessage(el, kind, text) {
    if (!el) return;
    el.classList.remove("ok", "err");
    if (!text) { el.textContent = ""; return; }
    el.classList.add(kind === "ok" ? "ok" : "err");
    el.textContent = text;
  }

  function prefillFromQuery() {
    const params = new URLSearchParams(window.location.search);
    return {
      email: params.get("email") || "",
      token: params.get("token") || ""
    };
  }

  window.CoreApi = { qs, apiFetch, setMessage, prefillFromQuery };
})();
