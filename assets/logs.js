// logs.js — отдельная страница логов

let currentLogTab = 'events'; // 'events' | 'control'
let eventLogsCache = [];
let controlLogsCache = [];

const EMPTY_VALUE = '—';

const EVENT_TYPE_META = {
  login: { label: 'Вход', tone: 'green' },
  batch_start: { label: 'Запуск партии', tone: 'blue' },
  batch_stop: { label: 'Остановка партии', tone: 'red' },
  recipe_create: { label: 'Создание рецепта', tone: 'green' },
  recipe_update: { label: 'Изменение рецепта', tone: 'yellow' },
  recipe_deactivate: { label: 'Деактивация рецепта', tone: 'red' },
  simulation_deviation: { label: 'Демонстрация', tone: 'purple' },
};

const EVENT_TYPE_LABELS = Object.fromEntries(
  Object.entries(EVENT_TYPE_META).map(([key, value]) => [key, value.label])
);

const ROLE_LABELS = {
  operator: 'Оператор',
  technologist: 'Технолог',
};

async function loadEventLogs() {
  try {
    const data = await fetchJson('/api/logs/events');
    eventLogsCache = Array.isArray(data) ? data : (data.rows || []);
    renderEventLogs();
    populateFiltersFromEvents();
  } catch (err) {
    console.error('Failed to load event logs', err);
    eventLogsCache = [];
    renderEventLogs();
  }
}

async function loadControlLogs() {
  try {
    const data = await fetchJson('/api/logs/control');
    controlLogsCache = Array.isArray(data) ? data : (data.rows || []);
    renderControlLogs();
    populateFiltersFromControl();
  } catch (err) {
    console.error('Failed to load control logs', err);
    controlLogsCache = [];
    renderControlLogs();
  }
}

function renderEventLogs(rows = null) {
  const body = document.getElementById('logsTableBody');
  const head = document.getElementById('logsTableHead');
  document.getElementById('logsTable').className = 'logs-table logs-table--events';
  head.innerHTML = `
    <tr>
      <th>Время</th>
      <th>Пользователь</th>
      <th>Роль</th>
      <th>Событие</th>
      <th>Описание</th>
    </tr>
  `;
  const data = rows || eventLogsCache || [];
  body.innerHTML = '';
  toggleEmpty(!data.length);
  if (!data.length) return;

  data.forEach((r) => {
    const tr = document.createElement('tr');
    const time = formatLogTime(r.created_at || r.time || r.timestamp);
    const user = displayValue(r.user_name || r.user || r.username);
    const role = formatRole(r.user_role || r.role || r.role_name);
    const typeRaw = r.event_type || r.type || '';
    const desc = formatEventDescription(r);

    tr.innerHTML = `
      <td>${escapeHtml(time)}</td>
      <td>${escapeHtml(user)}</td>
      <td>${escapeHtml(role)}</td>
      <td>${renderEventBadge(typeRaw)}</td>
      <td class="logs-description">${escapeHtml(desc)}</td>
    `;
    body.appendChild(tr);
  });
}

function renderControlLogs(rows = null) {
  const body = document.getElementById('logsTableBody');
  const head = document.getElementById('logsTableHead');
  document.getElementById('logsTable').className = 'logs-table logs-table--control';
  head.innerHTML = `
    <tr>
      <th>Время</th>
      <th>Оператор</th>
      <th>Партия</th>
      <th>Параметр</th>
      <th>Было</th>
      <th>Стало</th>
      <th>Ед. изм.</th>
      <th>Описание</th>
    </tr>
  `;
  const data = rows || controlLogsCache || [];
  body.innerHTML = '';
  toggleEmpty(!data.length);
  if (!data.length) return;

  data.forEach((r) => {
    const tr = document.createElement('tr');
    const time = formatLogTime(r.created_at || r.time || r.timestamp);
    const op = displayValue(r.operator_name || r.user_name || r.user);
    const batch = displayValue(r.batch_number || r.batch_id || r.id_batches || r.batch);
    const param = displayValue(r.parameter_name || r.parameter || r.param || r.parameter_id);
    const before = displayValue(r.before_value ?? r.old_value ?? r.from);
    const after = displayValue(r.after_value ?? r.new_value ?? r.to);
    const unit = displayValue(r.unit || r.parameter_unit);
    const desc = displayValue(r.description || r.msg || r.details);

    tr.innerHTML = `
      <td>${escapeHtml(time)}</td>
      <td>${escapeHtml(op)}</td>
      <td>${escapeHtml(batch)}</td>
      <td>${escapeHtml(param)}</td>
      <td>${escapeHtml(before)}</td>
      <td>${escapeHtml(after)}</td>
      <td>${escapeHtml(unit)}</td>
      <td class="logs-description">${escapeHtml(desc)}</td>
    `;
    body.appendChild(tr);
  });
}

function switchLogTab(tab) {
  currentLogTab = tab;
  document.getElementById('tabEvents').classList.toggle('active', tab === 'events');
  document.getElementById('tabControl').classList.toggle('active', tab === 'control');
  resetLogFilters(false);

  const typeSelect = document.getElementById('logTypeFilter');
  typeSelect.innerHTML = defaultTypeOption();
  document.getElementById('logsTableBody').innerHTML = '';
  toggleEmpty(false);
  if (tab === 'events') loadEventLogs(); else loadControlLogs();
}

function applyLogFilters() {
  const search = (document.getElementById('logSearch').value || '').toLowerCase().trim();
  const user = document.getElementById('logUserFilter').value || '';
  const type = document.getElementById('logTypeFilter').value || '';

  if (currentLogTab === 'events') {
    let rows = eventLogsCache.slice();
    if (search) rows = rows.filter(r => String(r.description || r.msg || r.details || '').toLowerCase().includes(search));
    if (user) rows = rows.filter(r => String(r.user_name || r.user || r.username || '') === user);
    if (type) rows = rows.filter(r => String(r.event_type || r.type || '') === type);
    renderEventLogs(rows);
  } else {
    let rows = controlLogsCache.slice();
    if (search) rows = rows.filter(r => String(r.description || r.msg || r.details || '').toLowerCase().includes(search));
    if (user) rows = rows.filter(r => String(r.operator_name || r.user_name || r.user || '') === user);
    if (type) rows = rows.filter(r => String(r.parameter_name || r.parameter || r.param || '') === type);
    renderControlLogs(rows);
  }
}

function resetLogFilters(shouldRender = true) {
  const search = document.getElementById('logSearch');
  const user = document.getElementById('logUserFilter');
  const type = document.getElementById('logTypeFilter');
  if (search) search.value = '';
  if (user) user.value = '';
  if (type) type.value = '';
  if (!shouldRender) return;
  if (currentLogTab === 'events') renderEventLogs(); else renderControlLogs();
}

function populateFiltersFromEvents() {
  const users = new Set();
  const types = new Set();
  (eventLogsCache || []).forEach(r => {
    const u = r.user_name || r.user || r.username; if (u) users.add(u);
    const t = r.event_type || r.type; if (t) types.add(t);
  });
  const userSel = document.getElementById('logUserFilter');
  const typeSel = document.getElementById('logTypeFilter');
  userSel.innerHTML = '<option value="">Пользователь</option>' + Array.from(users).sort().map(u => `<option value="${escapeAttr(u)}">${escapeHtml(u)}</option>`).join('');
  typeSel.innerHTML = defaultTypeOption() + Array.from(types).sort().map(t => `<option value="${escapeAttr(t)}">${escapeHtml(EVENT_TYPE_LABELS[t] || t)}</option>`).join('');
}

function populateFiltersFromControl() {
  const users = new Set();
  const params = new Set();
  (controlLogsCache || []).forEach(r => {
    const u = r.operator_name || r.user_name || r.user; if (u) users.add(u);
    const p = r.parameter_name || r.parameter || r.param; if (p) params.add(p);
  });
  const userSel = document.getElementById('logUserFilter');
  const typeSel = document.getElementById('logTypeFilter');
  userSel.innerHTML = '<option value="">Пользователь</option>' + Array.from(users).sort().map(u => `<option value="${escapeAttr(u)}">${escapeHtml(u)}</option>`).join('');
  typeSel.innerHTML = defaultTypeOption() + Array.from(params).sort().map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
}

function defaultTypeOption() {
  return `<option value="">${currentLogTab === 'events' ? 'Тип события' : 'Параметр'}</option>`;
}

function renderEventBadge(typeRaw) {
  const type = String(typeRaw || '');
  const meta = EVENT_TYPE_META[type] || { label: type || EMPTY_VALUE, tone: 'neutral' };
  return `<span class="log-event-badge log-event-badge--${meta.tone}">${escapeHtml(meta.label)}</span>`;
}

function formatEventDescription(row) {
  const eventType = String(row.event_type || row.type || '');
  const description = row.description || row.msg || row.details;
  const batchNumber = row.batch_number;
  if (eventType === 'batch_stop' && batchNumber) {
    return `Партия ${batchNumber} остановлена`;
  }
  return displayValue(description);
}

function formatRole(roleRaw) {
  const role = String(roleRaw || '').trim();
  if (!role) return EMPTY_VALUE;
  return ROLE_LABELS[role.toLowerCase()] || role;
}

function formatLogTime(value) {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  return String(value);
}

function toggleEmpty(show) {
  const empty = document.getElementById('logsEmpty');
  if (empty) empty.style.display = show ? 'block' : 'none';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) { return escapeHtml(s); }

function initLogsPage() {
  activeNav('logs');
  setUserBadge();

  document.getElementById('tabEvents').addEventListener('click', () => switchLogTab('events'));
  document.getElementById('tabControl').addEventListener('click', () => switchLogTab('control'));
  document.getElementById('applyLogFiltersBtn').addEventListener('click', applyLogFilters);
  document.getElementById('resetLogFiltersBtn').addEventListener('click', () => resetLogFilters(true));
  document.getElementById('logSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyLogFilters(); });

  switchLogTab('events');
}

window.initLogsPage = initLogsPage;
