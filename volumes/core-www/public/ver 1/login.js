// ---------- Tabs ----------
const tabs = [
  { btn: document.getElementById('tab-register'), panel: document.getElementById('panel-register') },
  { btn: document.getElementById('tab-activate'), panel: document.getElementById('panel-activate') },
  { btn: document.getElementById('tab-login'), panel: document.getElementById('panel-login') },
  { btn: document.getElementById('tab-forgot'), panel: document.getElementById('panel-forgot') },
];

function setActiveTab(index) {
  tabs.forEach((t, i) => {
    const active = i === index;
    t.btn.setAttribute('aria-selected', active ? 'true' : 'false');
    t.panel.classList.toggle('active', active);
  });
}
tabs.forEach((t, i) => t.btn.addEventListener('click', () => setActiveTab(i)));

// ---------- Helpers ----------
const apiBaseInput = document.getElementById('apiBase');

function getApiBase() {
  const raw = (apiBaseInput.value || '').trim();
  // Blank => same origin
  return raw ? raw.replace(/\/+$/, '') : '';
}

function asJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function pretty(obj) {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj === 'string') return obj;
  return JSON.stringify(obj, null, 2);
}

function setStatus(el, ok, title, data) {
  const icon = ok ? '✅' : '❌';
  const cls = ok ? 'ok' : 'bad';
  el.innerHTML = `<span class="${cls}">${icon} ${title}</span>\n\n${pretty(data)}`;
}

async function postJson(path, body) {
  const base = getApiBase();
  const url = base + path;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include', // IMPORTANT for cookies (login/session)
  });

  const text = await res.text();
  const json = asJson(text);
  return { res, text, json };
}

// ---------- Device ID storage ----------
const DEVICE_KEY = 'core_device_id';

function genDeviceId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = genDeviceId();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function setDeviceId(id) {
  localStorage.setItem(DEVICE_KEY, id);
}

// ---------- Register ----------
const regStatus = document.getElementById('reg-status');

document.getElementById('btn-register-filldevice').addEventListener('click', () => {
  const id = getOrCreateDeviceId();
  document.getElementById('reg-device').value = id;
  setStatus(regStatus, true, 'Generated device_id', { device_id: id });
});

document.getElementById('btn-register').addEventListener('click', async () => {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const nick_name = document.getElementById('reg-nick').value.trim();
  const full_name = document.getElementById('reg-full').value.trim();
  let device_id = document.getElementById('reg-device').value.trim();

  if (!email || !password) return setStatus(regStatus, false, 'Missing fields', { required: ['email', 'password'] });

  if (!device_id) device_id = getOrCreateDeviceId();
  setDeviceId(device_id);

  const payload = {
    email,
    password,
    device_id,
    ...(nick_name ? { nick_name } : {}),
    ...(full_name ? { full_name } : {}),
  };

  try {
    const { res, json, text } = await postJson('/auth/user/register', payload);
    const ok = res.ok && (json ? json.ok !== false : true);
    setStatus(regStatus, ok, `POST /auth/user/register (${res.status})`, json ?? text);

    if (ok) {
      document.getElementById('act-email').value = email;
      document.getElementById('log-email').value = email;
      document.getElementById('fp-email').value = email;
      setActiveTab(1); // go to Activate
    }
  } catch (e) {
    setStatus(regStatus, false, 'Network error', String(e));
  }
});

// ---------- Activate ----------
const actStatus = document.getElementById('act-status');

document.getElementById('btn-activate-copyfromregister').addEventListener('click', () => {
  document.getElementById('act-email').value = document.getElementById('reg-email').value.trim();
  setStatus(actStatus, true, 'Copied email from Register', { email: document.getElementById('act-email').value });
});

document.getElementById('btn-activate').addEventListener('click', async () => {
  const email = document.getElementById('act-email').value.trim();
  const token = document.getElementById('act-token').value.trim();
  if (!email || !token) return setStatus(actStatus, false, 'Missing fields', { required: ['email', 'token'] });

  try {
    const { res, json, text } = await postJson('/auth/user/activate', { email, token });
    const ok = res.ok && (json ? json.ok !== false : true);
    setStatus(actStatus, ok, `POST /auth/user/activate (${res.status})`, json ?? text);
    if (ok) setActiveTab(2); // go to Login
  } catch (e) {
    setStatus(actStatus, false, 'Network error', String(e));
  }
});

// ---------- Login ----------
const logStatus = document.getElementById('log-status');

document.getElementById('btn-login-filldevice').addEventListener('click', () => {
  const id = getOrCreateDeviceId();
  document.getElementById('log-device').value = id;
  setStatus(logStatus, true, 'Using stored device_id', { device_id: id });
});

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('log-email').value.trim();
  const password = document.getElementById('log-password').value;
  const remember_me = document.getElementById('log-remember').value === 'true';
  const device_description = document.getElementById('log-device-desc').value.trim();
  let device_id = document.getElementById('log-device').value.trim();

  if (!email || !password) return setStatus(logStatus, false, 'Missing fields', { required: ['email', 'password'] });

  if (!device_id) device_id = getOrCreateDeviceId();
  setDeviceId(device_id);

  const payload = {
    email,
    password,
    remember_me,
    device_id,
    ...(device_description ? { device_description } : {}),
  };

  try {
    const { res, json, text } = await postJson('/auth/user/login', payload);
    const ok = res.ok && (json ? json.ok !== false : true);
    setStatus(logStatus, ok, `POST /auth/user/login (${res.status})`, json ?? text);
  } catch (e) {
    setStatus(logStatus, false, 'Network error', String(e));
  }
});

// ---------- Forgot password ----------
const fpStatus = document.getElementById('fp-status');

document.getElementById('btn-fp-copyfromlogin').addEventListener('click', () => {
  document.getElementById('fp-email').value = document.getElementById('log-email').value.trim();
  setStatus(fpStatus, true, 'Copied email from Login', { email: document.getElementById('fp-email').value });
});

document.getElementById('btn-fp-request').addEventListener('click', async () => {
  const email = document.getElementById('fp-email').value.trim();
  if (!email) return setStatus(fpStatus, false, 'Missing fields', { required: ['email'] });

  try {
    const { res, json, text } = await postJson('/auth/user/forgotpassword', { email });
    const ok = res.ok && (json ? json.ok !== false : true);
    setStatus(fpStatus, ok, `POST /auth/user/forgotpassword (request) (${res.status})`, json ?? text);
  } catch (e) {
    setStatus(fpStatus, false, 'Network error', String(e));
  }
});

document.getElementById('btn-fp-reset').addEventListener('click', async () => {
  const email = document.getElementById('fp-email').value.trim();
  const token = document.getElementById('fp-token').value.trim();
  const new_password = document.getElementById('fp-newpass').value;

  if (!email || !token || !new_password) {
    return setStatus(fpStatus, false, 'Missing fields', { required: ['email', 'token', 'new_password'] });
  }

  try {
    const { res, json, text } = await postJson('/auth/user/forgotpassword', { email, token, new_password });
    const ok = res.ok && (json ? json.ok !== false : true);
    setStatus(fpStatus, ok, `POST /auth/user/forgotpassword (reset) (${res.status})`, json ?? text);
    if (ok) setActiveTab(2); // go to Login
  } catch (e) {
    setStatus(fpStatus, false, 'Network error', String(e));
  }
});

// Default: same-origin API
apiBaseInput.value = '';
