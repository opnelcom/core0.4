// landing.js

async function fetchUser() {
    const res = await fetch('/auth/user/me', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    return res.json();
}

async function fetchApps() {
    const res = await fetch('/auth/user/apps', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    return res.json();
}

async function init() {
    const user = await fetchUser();
    if (!user) return redirectLogin();

    document.getElementById('userName').textContent = user.name;
    document.getElementById('userEmail').textContent = user.email;

    const tenantSelect = document.getElementById('tenantSelect');
    user.tenants.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        tenantSelect.appendChild(opt);
    });
    tenantSelect.value = localStorage.getItem('core.selectedTenantId') || user.tenants[0].id;
    tenantSelect.addEventListener('change', () => {
        localStorage.setItem('core.selectedTenantId', tenantSelect.value);
    });

    const apps = await fetchApps();
    if (!apps) return redirectLogin();

    const appList = document.getElementById('appList');
    appList.innerHTML = '';
    apps.forEach(app => {
        const btn = document.createElement('button');
        btn.className = 'app-item';
        btn.innerHTML = `
            <div class="app-icon"></div>
            <div class="app-name">${app.name}</div>
            <div class="app-desc">${app.description}</div>
        `;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.app-item').forEach(i => i.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('appFrame').src = app.url;
            document.getElementById('contentTitle').textContent = app.name;
            document.getElementById('contentUrl').textContent = app.url;
            localStorage.setItem('core.lastAppCode', app.code);
        });
        if (localStorage.getItem('core.lastAppCode') === app.code) {
            btn.classList.add('active');
            document.getElementById('appFrame').src = app.url;
            document.getElementById('contentTitle').textContent = app.name;
            document.getElementById('contentUrl').textContent = app.url;
        }
        appList.appendChild(btn);
    });

    document.getElementById('btnLogout').addEventListener('click', async () => {
        await fetch('/auth/user/logout', { method: 'POST', credentials: 'include' });
        redirectLogin();
    });

    document.getElementById('btnChangePw').addEventListener('click', async () => {
        await fetch('/auth/user/changepassword', { method: 'POST', credentials: 'include' });
        alert('Password change requested.');
    });

    document.getElementById('btnProfile').addEventListener('click', async () => {
        await fetch('/auth/user/update', { method: 'POST', credentials: 'include' });
        alert('Profile update requested.');
    });

    document.getElementById('btnToggleNav').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('core.sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });

    if (localStorage.getItem('core.sidebarCollapsed') === 'true') {
        document.getElementById('sidebar').classList.add('collapsed');
    }
}

function redirectLogin() {
    window.location.href = '