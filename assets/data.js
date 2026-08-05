// ── data.js — глобальное хранилище и константы ──────────────────────────────

const Data = {
  parameters: [],
  equipment: [],
  batch: null,
  currentUser: null,
  archiveBatches: [],
  recipes: [],
  recipeSetpoints: {},
  alarms: [],
  histories: {},
  current: {},
  tolerances: {},        // текущие допуски по параметрам (обновляются из WS)
  currentSetpoints: {},  // текущие уставки по параметрам (интерполированные, из WS)
  stages: [],            // этапы текущего рецепта (из loadAllData)
  batchStartTime: null,  // время старта партии в мс (для привязки этапов к оси X)
  activeRecipeSetpoints: {},
  alarmId: 1,
};

const STAGE_META = {
  drying: {
    label: 'Фаза сушки',
    color: '#FACC15',
    bg: 'rgba(250, 204, 21, 0.15)',
    border: '#FACC15',
    hint: 'Испарение влаги, прогрев зерна до 130-160 °C',
  },
  maillard: {
    label: 'Реакция Майяра',
    color: '#FB923C',
    bg: 'rgba(251, 146, 60, 0.15)',
    border: '#FB923C',
    hint: 'Потемнение зерна, формирование вкусо-ароматических соединений',
  },
  first_crack: {
    label: 'Первый крэк',
    color: '#A3E635',
    bg: 'rgba(163, 230, 53, 0.15)',
    border: '#A3E635',
    hint: 'Разрыв клеточной структуры зерна, характерный треск, переход к стадии развития',
  },
  development: {
    label: 'Стадия развития',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.15)',
    border: '#EF4444',
    hint: 'Период после первого крэка, формирование баланса вкуса',
  },
  second_crack: {
    label: 'Второй крэк',
    color: '#B91C1C',
    bg: 'rgba(185, 28, 28, 0.15)',
    border: '#B91C1C',
    hint: 'Второй крэк, выступление масел на поверхности зерна',
  },
  pyrolysis: {
    label: 'Пиролиз',
    color: '#8B5CF6',
    bg: 'rgba(139, 92, 246, 0.15)',
    border: '#8B5CF6',
    hint: 'Глубокое термическое разложение соединений, формирование тёмной обжарки',
  },
  discharge: {
    label: 'Выгрузка и охлаждение',
    color: '#06B6D4',
    bg: 'rgba(6, 182, 212, 0.15)',
    border: '#06B6D4',
    hint: 'Быстрое охлаждение зёрен для остановки обжарки',
  },
};

function getStageMeta(stageCode) {
  return STAGE_META[String(stageCode || '').trim().toLowerCase()] || null;
}

const PARAM_CHART_STYLE = {
  borderWidth: 2,
  pointRadius: 1.8,
  tension: 0.3,
  backgroundColor: 'transparent',
};

const PARAM_CHART_META = {
  beanTemp: {
    name: 'Температура зерна',
    color: '#38BDF8',
    ...PARAM_CHART_STYLE,
  },
  inletAir: {
    name: 'Температура входящего воздуха',
    color: '#FDE047',
    ...PARAM_CHART_STYLE,
  },
  exhaustAir: {
    name: 'Температура выходящего воздуха',
    color: '#4ADE80',
    ...PARAM_CHART_STYLE,
  },
  ror: {
    name: 'RoR',
    color: '#C084FC',
    ...PARAM_CHART_STYLE,
  },
  heatPower: {
    name: 'Мощность нагрева',
    color: '#F59E0B',
    ...PARAM_CHART_STYLE,
  },
  airFlow: {
    name: 'Скорость воздуха',
    color: '#60A5FA',
    ...PARAM_CHART_STYLE,
  },
};

function getChartYAxisScale(values, stepSize = 5) {
  const finiteValues = (values || []).map(Number).filter(Number.isFinite);
  if (!finiteValues.length) {
    return { minVal: 0, maxVal: stepSize, spanVal: stepSize, ticks: [0, stepSize], stepSize };
  }

  const rawMin = Math.min(...finiteValues);
  const rawMax = Math.max(...finiteValues);
  let maxVal = Math.ceil(rawMax / 10) * 10 + 10;
  let effectiveStep = stepSize;
  let minVal = Math.floor(rawMin / effectiveStep) * effectiveStep;
  const maxTicks = 9;

  while (((maxVal - minVal) / effectiveStep) + 1 > maxTicks) {
    effectiveStep *= 2;
    minVal = Math.floor(rawMin / effectiveStep) * effectiveStep;
  }
  maxVal = Math.ceil(maxVal / effectiveStep) * effectiveStep;
  if (minVal >= maxVal) minVal = maxVal - effectiveStep;

  const ticks = [];
  for (let tick = minVal; tick <= maxVal; tick += effectiveStep) {
    ticks.push(tick);
  }
  if (ticks[ticks.length - 1] !== maxVal) ticks.push(maxVal);

  return { minVal, maxVal, spanVal: maxVal - minVal || effectiveStep, ticks, stepSize: effectiveStep };
}

const API_BASE         = 'http://localhost:3000';
const MEASURE_POLL_MS  = 3000;
const AUTH_TOKEN_KEY   = 'authToken';
const AUTH_USER_KEY    = 'authUser';

let measurePollTimer   = null;
let ws                 = null;
let wsConnected        = false;
let updateCurrentInfoFn = null;

// ── DOM-утилиты 
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ── Навигация 
const navLinks = [
  { href: 'index.html',   label: 'Главная' },
  { href: 'alarms.html',  label: 'Тревоги' },
  { href: 'batches.html', label: 'Партии'  },
  { href: 'recipes.html', label: 'Рецепты' },
  { href: 'logs.html',    label: 'Логи' },
];

function activeNav(page) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = '';
  navLinks.forEach((l) => {
    const a = document.createElement('a');
    a.href = l.href;
    a.textContent = l.label;
    if (page && l.href.includes(page)) a.classList.add('active');
    nav.appendChild(a);
  });
}

// ── Утилиты времени и форматирования ────────────────────────────────────────

function toMs(val) {
  if (!val) return null;
  const ts = new Date(val).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function formatMs(ms) {
  const m = Math.floor(ms / 60000).toString().padStart(2, '0');
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── CSV-утилиты (используются в page-batches.js) ─────────────────────────────

function csvCell(val) {
  if (val === null || val === undefined || val === '') return '';
  const s = String(val);
  if (/^\d+\.\d+$/.test(s)) return `="${s}"`;
  if (s.includes(';') || s.includes('\n') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(...cells) {
  return cells.map(csvCell).join(';');
}

// ── История измерений ────────────────────────────────────────────────────────

function addHistoryPoint(paramId, value, time) {
  const id = String(paramId || '');
  const val = Number(value);
  const t = Number(time);
  if (!id || !Number.isFinite(val) || !Number.isFinite(t)) return;
  if (!Data.histories[id]) Data.histories[id] = [];
  const history = Data.histories[id];
  const last = history[history.length - 1];
  if (last && last.t >= t) return;
  history.push({ v: val, t });
  if (history.length > 500) history.splice(0, history.length - 500);
}

// ── Уставки ──────────────────────────────────────────────────────────────────

function getSetpoint(paramId) {
  const recipeSp = Data.activeRecipeSetpoints && Data.activeRecipeSetpoints[paramId];
  if (recipeSp != null) return Number(recipeSp);
  const p = Data.parameters.find((x) => x.id === paramId);
  return Number(p?.setpoint ?? 0);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(text) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = text;
  toast.style.display = 'block';
  setTimeout(() => (toast.style.display = 'none'), 2600);
}

// ── Бейдж пользователя ───────────────────────────────────────────────────────

function setUserBadge() {
  const badge = $('#userRole');
  if (!badge) return;
  const user = Data.currentUser || {};
  // Форматирование: если operator -> "Оператор: ФИО", если technologist -> "Технолог: ФИО"
  if (user.name && user.role) {
    if (user.role === 'operator') {
      badge.textContent = `Оператор: ${user.name}`;
    } else if (user.role === 'technologist') {
      badge.textContent = `Технолог: ${user.name}`;
    } else {
      badge.textContent = `${user.name} (${user.role})`;
    }
  } else if (user.name) {
    badge.textContent = user.name;
  } else if (user.role) {
    badge.textContent = String(user.role);
  } else {
    badge.textContent = '-';
  }
  attachLogoutButton();
}

function attachLogoutButton() {
  if (document.body.dataset.page === 'login') return;
  if (document.getElementById('logoutBtn')) return;
  const target = document.querySelector('.header-right') || document.querySelector('header');
  if (!target) return;
  const btn = document.createElement('button');
  btn.id = 'logoutBtn';
  btn.className = 'secondary';
  btn.textContent = 'Выйти';
  btn.addEventListener('click', () => {
    setAuthToken(null);
    setStoredUser(null);
    window.location.href = 'login.html';
  });
  target.appendChild(btn);
}

// ── Модальное окно ────────────────────────────────────────────────────────────

function openModal(title, body, onConfirm) {
  // Use native confirm dialog instead of DOM modal to avoid overlay issues
  try {
    const msg = typeof body === 'string' ? body.replace(/<[^>]*>/g, '') : String(body);
    if (window.confirm(`${title}\n\n${msg}`)) {
      try { onConfirm && onConfirm(); } catch (e) { console.error(e); }
    }
  } catch (e) {
    console.error('openModal fallback failed', e);
  }
}

// ── Обновление панели текущей партии ─────────────────────────────────────────

function updateParamCurrentInfo() {
  if (typeof updateCurrentInfoFn === 'function') updateCurrentInfoFn();
}
