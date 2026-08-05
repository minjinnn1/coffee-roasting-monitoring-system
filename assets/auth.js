// ── auth.js — аутентификация и управление сессией ───────────────────────────

function getAuthToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); }
  catch { return null; }
}
function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else       localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}
function getStoredUser() {
  try   { return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null'); }
  catch { return null; }
}
function setStoredUser(user) {
  try {
    if (user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify({
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email,
    }));
    else      localStorage.removeItem(AUTH_USER_KEY);
  } catch {}
}
function handleUnauthorized() {
  setAuthToken(null);
  setStoredUser(null);
  window.location.href = 'login.html';
}
function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function ensureAuth() {
  if (document.body.dataset.page === 'login') return true;
  if (!getAuthToken()) { handleUnauthorized(); return false; }
  return true;
}

// ── Страница логина ───────────────────────────────────────────────────────────

function initLoginPage() {
  const form    = document.getElementById('loginForm');
  const errorEl = document.getElementById('loginError');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) {
      errorEl.textContent = 'Введите логин и пароль';
      return;
    }
    try {
      const res = await fetch(API_BASE + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: username, password }),
      });
      if (!res.ok) { errorEl.textContent = 'Неверный логин или пароль'; return; }
      const data = await res.json();
      setAuthToken(data.token);
      setStoredUser(data.user);
      window.location.href = 'index.html';
    } catch {
      errorEl.textContent = 'Ошибка сети, попробуйте еще раз';
    }
  });
}
