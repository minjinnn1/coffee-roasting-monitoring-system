// dashboard.js — главная страница

// Aliases help map incoming stage_name or stage_code variants (ru/en, different punctuation)
const STAGE_ALIASES = {
  'пиролиз': 'pyrolysis',
  'pyrolysis': 'pyrolysis',
  'первый крэк': 'first_crack',
  'первый крек': 'first_crack',
  'first_crack': 'first_crack',
  'крэк': 'first_crack',
  'крек': 'first_crack',
  'второй крэк': 'second_crack',
  'второй крек': 'second_crack',
  'second_crack': 'second_crack',
  'сушка': 'drying',
  'drying': 'drying',
  'maillard': 'maillard',
  'маиллард': 'maillard',
  'development': 'development',
  'discharge': 'discharge',
  'выгрузка': 'discharge',
};

function getCanonicalStageKey(codeRaw, nameRaw) {
  const tryKey = (k) => { if (!k) return null; const s = String(k).trim().toLowerCase(); if (!s) return null; return s; };
  const c1 = tryKey(codeRaw);
  const c2 = tryKey(nameRaw);
  if (c1 && STAGE_META[c1]) return c1;
  if (c1 && STAGE_ALIASES[c1] && STAGE_META[STAGE_ALIASES[c1]]) return STAGE_ALIASES[c1];
  if (c2 && STAGE_META[c2]) return c2;
  if (c2 && STAGE_ALIASES[c2] && STAGE_META[STAGE_ALIASES[c2]]) return STAGE_ALIASES[c2];
  // try contains checks
  for (const k of Object.keys(STAGE_ALIASES)) {
    if (c1 && c1.includes(k)) return STAGE_ALIASES[k];
    if (c2 && c2.includes(k)) return STAGE_ALIASES[k];
  }
  return null;
}

let _dashboardTimer = null;
let _dashboardEventsBound = false;

const CONTROL_PARAM_IDS = [5, 6];

const CONTROL_CARDS = [
  { id: 5, key: 'power', name: 'Мощность нагрева', unit: 'кВт', currentId: 'ctrlCurrentPower', setpointId: 'ctrlSetpointPower', pendingId: 'pendingPower' },
  { id: 6, key: 'flow', name: 'Скорость воздушного потока', unit: 'м/с', currentId: 'ctrlCurrentFlow', setpointId: 'ctrlSetpointFlow', pendingId: 'pendingFlow' },
];

function isOperatorUser() { return Data.currentUser?.role === 'operator'; }
function isTechnologistUser() { return Data.currentUser?.role === 'technologist'; }

const overrideTimers = {};
const overrideResetPending = {};

function fmtStageTime(sec) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function isControlParam(id) {
  return CONTROL_PARAM_IDS.includes(Number(id));
}

function getCurrentSetpoint(id) {
  return Data.currentSetpoints?.[id] != null
    ? Number(Data.currentSetpoints[id])
    : getSetpoint(id);
}

function updateStageHeader(payload) {
  const wrap = $('#stageHeaderWrap');
  const stage = payload.stage;

  if (!wrap || !stage) {
    if (wrap) wrap.classList.add('hidden');
    return;
  }

  const elapsed = Number(payload.stage_elapsed || 0);
  const duration = Number(payload.stage_duration || 1) || 1;
  let percent = Math.round((elapsed / duration) * 100);
  percent = Math.max(0, Math.min(100, percent));

  const codeRaw = (stage.stage_code || '').toString();
  const nameRaw = (stage.stage_name || '').toString();

  // Try canonical key resolution
  let key = getCanonicalStageKey(codeRaw, nameRaw);
  let meta = key ? STAGE_META[key] : null;

  // Debug logging to help trace mismatches
  try { console.debug('[stage-header] incoming:', { codeRaw, nameRaw, keyFound: key, metaPresent: !!meta }); } catch (e) {}

  // Legacy heuristics: match by label content if still not found
  if (!meta && nameRaw) {
    const entries = Object.values(STAGE_META);
    meta = entries.find((m) => m.label === nameRaw);
    if (!meta) meta = entries.find((m) => (nameRaw || '').toLowerCase().includes((m.label || '').toLowerCase()));
    if (!meta) meta = entries.find((m) => (m.label || '').toLowerCase().includes((nameRaw || '').toLowerCase()));
  }

  if (!meta) meta = { color: '#6b7280', label: stage.stage_name || codeRaw || 'Этап', hint: '' };

  wrap.classList.remove('hidden');
  wrap.style.borderLeft = `4px solid ${meta.color}`;
  wrap.style.background = meta.bg || 'rgba(255,255,255,0.03)';

  $('#stageTitle').textContent = meta.label;
  $('#stageTitle').style.color = meta.color;
  $('#stageTime').textContent = `${fmtStageTime(elapsed)} / ${fmtStageTime(duration)}`;
  $('#stageProgress').style.width = `${percent}%`;
  $('#stageProgress').style.background = meta.color;
  $('#stageHint').textContent = meta.hint || '';
}

function updateRow(param, value, time) {
  const row = $(`#row-${param.id}`);
  if (!row) return;

  const setpoint = getCurrentSetpoint(param.id);
  const tolerance = Data.tolerances?.[param.id] != null ? Number(Data.tolerances[param.id]) : null;
  const control = isControlParam(param.id);

  row.querySelector('[data-field="time"]').textContent = time ? new Date(time).toLocaleTimeString() : '-';
  row.querySelector('[data-field="current"]').textContent = `${value.toFixed(1)} ${param.unit}`;
  row.querySelector('[data-field="setpoint"]').textContent = tolerance != null
    ? `${setpoint.toFixed(1)} ± ${tolerance.toFixed(0)} ${param.unit}`
    : `${setpoint.toFixed(1)} ${param.unit}`;

  const deltaEl = row.querySelector('[data-field="delta"]');
  const statusEl = row.querySelector('[data-field="status"]');

  if (control) {
    deltaEl.textContent = '—';
    deltaEl.className = 'delta control';
    statusEl.textContent = 'Управление';
    statusEl.className = 'log-event-badge log-event-badge--neutral';
    return;
  }

  const delta = value - setpoint;
  const status = statusClass(value, param);

  deltaEl.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
  deltaEl.className = `delta ${status}`;

  statusEl.textContent = status === 'ok' ? 'OK' : status === 'warn' ? 'Warning' : 'Alarm';
  const statusTone = status === 'ok' ? 'green' : status === 'warn' ? 'yellow' : 'red';
  statusEl.className = `log-event-badge log-event-badge--${statusTone}`;
}

function updateHistory(id, value, time) {
  if (!Data.histories[id]) Data.histories[id] = [];
  Data.histories[id].push({ t: time, v: value });
  if (Data.histories[id].length > 120) Data.histories[id].shift();
}

function renderCurrentBatchInfo() {
  const batch = Data.batch || {};
  const isRunning = Number(Data.processState?.is_running ?? 0) === 1;

  $('#batchName').textContent = isRunning && batch.id ? (batch.batch_number || `#${batch.id}`) : '—';

  const isOperator = Data.currentUser?.role === 'operator';
  const isTechnologist = Data.currentUser?.role === 'technologist';

  // Start panel: visible to operator when not running; hide for technologist
  $('#startPanel')?.classList.toggle('hidden', isRunning || isTechnologist);

  if (isRunning) {
    // When running show operator panel and controls only for operator
    $('#operatorPanel')?.classList.toggle('hidden', false);
    $('#operatorControlPanel')?.classList.toggle('hidden', !isOperator);
    $('#deviationPanel')?.classList.toggle('hidden', false);
  } else {
    // Not running: operator sees startPanel; technologist sees informational message
    if (isTechnologist) {
      $('#operatorPanel')?.classList.toggle('hidden', false);
      $('#operatorControlPanel')?.classList.toggle('hidden', true);
      $('#deviationPanel')?.classList.toggle('hidden', true);
    } else {
      $('#operatorPanel')?.classList.toggle('hidden', true);
      $('#operatorControlPanel')?.classList.toggle('hidden', true);
      $('#deviationPanel')?.classList.toggle('hidden', true);
    }
  }

  // Hide control buttons for non-operator roles (redundant safe-guard)
  if (!isOperator) {
    $$('.ctrl-step').forEach((b) => { if (b) b.style.display = 'none'; });
    const applyBtn = $('#applyCorrection');
    if (applyBtn) applyBtn.style.display = 'none';
  } else {
    $$('.ctrl-step').forEach((b) => { if (b) b.style.display = ''; });
    const applyBtn = $('#applyCorrection');
    if (applyBtn) applyBtn.style.display = '';
  }

  if (isRunning) {
    $('#opBatchName').textContent = batch.id ? `Партия ${batch.batch_number || `#${batch.id}`}` : '—';
    $('#opBatchStatus').textContent = 'Active';
    $('#opBatchStatus').className = `status-chip ok`;
    $('#opBatchRecipe').textContent = batch.recipe || '—';
    $('#opBatchWeight').textContent = batch.weight ? `${batch.weight} кг` : '—';
    $('#opBatchOperator').textContent = batch.operator || '—';
    $('#opStartTime').textContent = batch.start ? new Date(batch.start).toLocaleTimeString() : '—';
  } else if (isTechnologist) {
    // informational message for technologist when no active batch
    $('#opBatchName').textContent = 'Активная партия отсутствует';
    $('#opBatchStatus').textContent = '';
    $('#opBatchStatus').className = '';
    $('#opBatchRecipe').textContent = 'Технолог может просматривать архив партий и управлять рецептурами.';
    $('#opBatchWeight').textContent = '';
    $('#opBatchOperator').textContent = '';
    $('#opStartTime').textContent = '';
  } else {
    $('#opBatchName').textContent = '—';
    $('#opBatchStatus').textContent = '—';
    $('#opBatchStatus').className = `status-chip `;
    $('#opBatchRecipe').textContent = '—';
    $('#opBatchWeight').textContent = '—';
    $('#opBatchOperator').textContent = '—';
    $('#opStartTime').textContent = '—';
  }
}


function updateTimers() {
  const isRunning = Number(Data.processState?.is_running ?? 0) === 1;

  if (!isRunning || !Data.batch?.start) {
    $('#opRoastTime').textContent = '00:00';
    Data.current.timer = 0;
    Data.current.development = 0;
    return;
  }

  const roastMs = Date.now() - Data.batch.start;
  const devMs = Data.batch.developmentStart ? Date.now() - Data.batch.developmentStart : 0;

  $('#opRoastTime').textContent = formatMs(roastMs);
  Data.current.timer = roastMs / 60000;
  Data.current.development = Math.max(devMs, 0) / 60000;
}

function clearOverrideIndicator(id) {
  const key = String(id);
  const indicator = $(`#override-${key}`);
  if (overrideTimers[key]) {
    clearInterval(overrideTimers[key]);
    delete overrideTimers[key];
  }
  delete overrideResetPending[key];
  if (indicator) indicator.remove();
}

async function resetManualOverride(id) {
  const key = String(id);
  if (!isOperatorUser() || overrideResetPending[key]) return;

  overrideResetPending[key] = true;
  const button = $(`#override-${key} [data-action="reset-override"]`);
  if (button) button.disabled = true;

  try {
    await deleteJson(`/api/parameters/${key}/override`);
    clearOverrideIndicator(key);
    updateParamCurrentInfo();
    refreshControlCards({}, new Set());
    try { await refreshMeasurements(); } catch (refreshErr) { console.error(refreshErr); }
    showToast('Коррекция сброшена');
  } catch (err) {
    console.error(err);
    delete overrideResetPending[key];
    if (button) button.disabled = false;
    showToast('Не удалось сбросить коррекцию');
  }
}

function showOverrideIndicator(id, value, ttlSec) {
  const key = String(id);
  const card = CONTROL_CARDS.find((item) => item.id === Number(id));
  const template = $('#overrideTemplate');
  const wrap = $('#overrideIndicators');
  if (!card || !template || !wrap) return;

  clearOverrideIndicator(key);

  const node = template.content.cloneNode(true);
  const indicator = node.querySelector('.override-indicator');

  indicator.id = `override-${key}`;
  indicator.querySelector('[data-field="text"]').textContent = `Коррекция активна: ${card.name} → ${value} ${card.unit}`;
  const resetButton = indicator.querySelector('[data-action="reset-override"]');
  if (resetButton) {
    resetButton.classList.toggle('hidden', !isOperatorUser());
    resetButton.addEventListener('click', () => resetManualOverride(key));
  }

  let seconds = ttlSec;
  const timerEl = indicator.querySelector('[data-field="timer"]');
  const updateTimer = () => timerEl.textContent = `Сброс через ${seconds} сек`;

  updateTimer();
  wrap.appendChild(indicator);

  overrideTimers[key] = setInterval(() => {
    seconds -= 1;

    if (seconds <= 0) {
      clearOverrideIndicator(key);
    } else {
      updateTimer();
    }
  }, 1000);
}

function tickDashboard() {
  const now = Date.now();

  Data.parameters.forEach((param) => {
    const history = Data.histories[param.id] || [];
    const last = history[history.length - 1];
    const value = last ? last.v : param.setpoint;
    const time = last ? last.t : now;

    Data.current[param.id] = value;
    updateRow(param, value, time);

    if (!last || last.t !== time) updateHistory(param.id, value, time);
    if (!isControlParam(param.id)) evaluateAlarm(param, value, time);
  });

  drawCharts();
  updateTimers();
  renderCurrentBatchInfo();
  renderAlarms($('#alarmsList'), $('#alarmsSummary'));
  updateParamCurrentInfo();
}

function refreshControlCards(state, changed) {
  CONTROL_CARDS.forEach((card) => {
    if (!changed.has(card.id)) state[card.id] = Data.current[card.id] ?? getSetpoint(card.id);

    const current = Data.current[card.id];
    const setpoint = getCurrentSetpoint(card.id);
    const pending = state[card.id];

    $(`#${card.currentId}`).textContent = `Текущее: ${current != null ? Number(current).toFixed(1) : '—'} ${card.unit}`;
    $(`#${card.setpointId}`).textContent = `Уставка: ${setpoint.toFixed(1)} ${card.unit}`;
    $(`#${card.pendingId}`).textContent = `${Number(pending).toFixed(1)} ${card.unit}`;
  });
}

function bindCorrectionControls() {
  // Protect controls: only operator may change corrections
  if (!isOperatorUser()) {
    // hide buttons if any
    $$('.ctrl-step').forEach((b) => { if (b) b.style.display = 'none'; });
    const applyBtn = $('#applyCorrection'); if (applyBtn) applyBtn.style.display = 'none';
    return;
  }

  const state = {};
  const changed = new Set();

  const refresh = () => refreshControlCards(state, changed);
  updateCurrentInfoFn = refresh;
  refresh();

  $$('.ctrl-step').forEach((button) => {
    button.addEventListener('click', () => {
      // double-check role at runtime
      if (!isOperatorUser()) return;
      const card = CONTROL_CARDS.find((item) => item.key === button.dataset.paramKey);
      if (!card) return;

      if (!changed.has(card.id)) state[card.id] = Data.current[card.id] ?? getSetpoint(card.id);

      changed.add(card.id);
      state[card.id] = Math.round((state[card.id] + Number(button.dataset.delta)) * 10) / 10;
      refresh();
    });
  });

  $('#applyCorrection')?.addEventListener('click', () => {
    // runtime protection
    if (!isOperatorUser()) return showToast('Доступ запрещён');
    if (!Data.batch?.id || Data.batch.id === '-') return showToast('Нет активной партии');

    const changes = CONTROL_CARDS.filter((card) => changed.has(card.id));
    if (!changes.length) return showToast('Измените значение перед применением');

    openModal('Подтвердить коррекцию', `Применить изменения к ${changes.length} параметр(ам)?`, async () => {
      try {
        for (const card of changes) {
          const value = state[card.id];
          const time = Date.now();

          await postJson(`/api/parameters/${card.id}/override`, {
            value,
            batchId: Data.batch.id,
            userId: Data.currentUser?.id || Data.currentUser?.id_user || 1,
          });

          addHistoryPoint(card.id, value, time);
          Data.current[card.id] = value;

          const param = Data.parameters.find((item) => Number(item.id) === card.id);
          if (param) updateRow(param, value, time);

          showOverrideIndicator(card.id, value, 60);
        }

        changed.clear();
        refresh();
        renderAlarms($('#alarmsList'), $('#alarmsSummary'));
        showToast('Коррекция применена — действует 60 сек');
      } catch (err) {
        console.error(err);
        showToast('Не удалось обновить значение');
      }
    });
  });
}

function bindBatchButtons() {
  const isOp = isOperatorUser();
  // Hide buttons for non-operators and do not bind handlers
  if (!isOp) {
    $('#startBatchBtn')?.classList.add('hidden');
    $('#stopBatchBtn')?.classList.add('hidden');
    return;
  }

  $('#startBatchBtn')?.addEventListener('click', async () => {
    // runtime check
    if (!isOperatorUser()) return showToast('Доступ запрещён');
    try {
      const recipeId = Number($('#startRecipeSelect')?.value || 0);
      if (!recipeId) return showToast('Выберите рецепт');

      const recipe = Data.recipes.find((item) => Number(item.id) === recipeId);

      const response = await postJson('/api/batches/start', {
        id_recipe: recipeId,
        green_weight_in: Number($('#startBatchWeight')?.value || 12),
        coffee_variety: $('#startCoffeeVariety')?.value || '',
        target_roast_degree: recipe?.category || 'medium',
      });

      showToast(`Партия запущена: ${response.batch_number || response.batch_id}`);
      await loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Не удалось запустить партию');
    }
  });

  $('#stopBatchBtn')?.addEventListener('click', async () => {
    if (!isOperatorUser()) return showToast('Доступ запрещён');
    try {
      await postJson('/api/batches/stop', {});

      Data.batch = null;
      Data.processState = Data.processState || {};
      Data.processState.is_running = 0;
      Data.current.timer = 0;
      Data.current.development = 0;
      Data.histories = {};
      Data.alarms = [];

      renderCurrentBatchInfo();
      updateStageHeader({});
      Data.parameters.forEach((param) => updateRow(param, getSetpoint(param.id), Date.now()));
      renderAlarms($('#alarmsList'), $('#alarmsSummary'));

      showToast('Партия остановлена');
      await loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Не удалось остановить партию');
    }
  });
}

function bindSimulationButton() {
  // Restrict to operator
  if (!isOperatorUser()) {
    $('#simulateOverheatBtn')?.classList.add('hidden');
    return;
  }

  $('#simulateOverheatBtn')?.addEventListener('click', async () => {
    if (!isOperatorUser()) return showToast('Доступ запрещён');
    const response = await fetch(`${API_BASE}/api/simulation/deviation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ type: 'grain_overheat', value: 10, durationSec: 30 }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) showToast('Сценарий перегрева запущен на 30 секунд');
    else if (data.error === 'NO_ACTIVE_BATCH') showToast('Сначала запустите партию');
    else showToast('Не удалось запустить сценарий');
  });
}

function bindDashboardEvents() {
  bindCorrectionControls();
  bindBatchButtons();
  bindSimulationButton();
}

function fillStartRecipeSelect() {
  const select = $('#startRecipeSelect');
  if (!select) return;

  select.innerHTML = '';

  Data.recipes
    .filter((recipe) => Number(recipe.is_active) !== 0)
    .forEach((recipe) => {
      const option = document.createElement('option');

      option.value = recipe.id;
      option.textContent = recipe.name;
      option.selected = Data.batch && Number(Data.batch.recipeId) === Number(recipe.id);

      select.appendChild(option);
    });
}

function renderSetpointRows() {
  const tbody = $('#setpointsTable');
  const template = $('#setpointRowTemplate');
  if (!tbody || !template) return;

  tbody.innerHTML = '';

  Data.parameters.forEach((param) => {
    if (!Data.histories[param.id]) Data.histories[param.id] = [];
    if (Data.current[param.id] == null) Data.current[param.id] = param.setpoint;

    const row = template.content.cloneNode(true);
    const tr = row.querySelector('tr');
    const control = isControlParam(param.id);

    tr.id = `row-${param.id}`;
    row.querySelector('[data-field="name"]').textContent = param.name;
    row.querySelector('[data-field="setpoint"]').textContent = `${getSetpoint(param.id).toFixed(1)} ${param.unit}`;
    row.querySelector('[data-field="delta"]').textContent = control ? '—' : '0';
    row.querySelector('[data-field="delta"]').className = `delta ${control ? 'control' : ''}`;

    const status = row.querySelector('[data-field="status"]');
    status.textContent = control ? 'Управление' : 'OK';
    status.className = `log-event-badge log-event-badge--${control ? 'neutral' : 'green'}`;

    tbody.appendChild(row);
  });
}

function initDashboard() {
  activeNav('index');
  setUserBadge();
  renderCurrentBatchInfo();
  fillStartRecipeSelect();
  renderSetpointRows();

  tickDashboard();
  if (_dashboardTimer) clearInterval(_dashboardTimer);
  _dashboardTimer = setInterval(tickDashboard, 1000);

  if (!_dashboardEventsBound) {
    bindDashboardEvents();
    _dashboardEventsBound = true;
  }
}
