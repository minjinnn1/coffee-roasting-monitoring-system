//HTTP
async function responseError(res, path) {
  let message = `Request failed ${res.status} ${path}`;
  try {
    const data = await res.json();
    if (data?.message) message = data.message;
    else if (data?.error) message = data.error;
  } catch (e) {}
  const err = new Error(message);
  err.status = res.status;
  err.path = path;
  return err;
}

async function fetchJson(path) {
  const res = await fetch(API_BASE + path, { headers: { ...authHeaders() } });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
  if (!res.ok) throw await responseError(res, path);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
  if (!res.ok) throw await responseError(res, path);
  return res.json();
}

async function putJson(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
  if (!res.ok) throw await responseError(res, path);
  return res.json();
}

async function deleteJson(path) {
  const res = await fetch(API_BASE + path, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
  if (!res.ok) throw await responseError(res, path);
  return res.json();
}

//WebSocket
function deriveWsUrl() {
  return API_BASE.replace(/^http/, 'ws') + '/ws';
}

function applyMeasurementPoint(pid, val, t) {
  if (!pid || !Number.isFinite(Number(val)) || !Number.isFinite(Number(t))) return;
  addHistoryPoint(pid, val, t);
  Data.current[pid] = val;
  const p = Data.parameters.find((x) => x.id === String(pid) || Number(x.id) === Number(pid));
  if (p) updateRow(p, val, t);
}

function isValidWsMessage(msg) {
  return msg && typeof msg === 'object' && typeof msg.type === 'string';
}

function toMeasurementList(payload) {
  return Array.isArray(payload?.measurements) ? payload.measurements : [];
}

function refreshAlarmViews() {
  renderAlarms($('#alarmsList'), $('#alarmsSummary'));
  if (document.body?.dataset?.page === 'alarms' && typeof renderAlarmsPage === 'function') {
    renderAlarmsPage();
  }
}

function connectRealtime() {
  if (ws) { try { ws.close(); } catch (e) {} }
  try {
    ws = new WebSocket(deriveWsUrl());
  } catch (err) {
    console.error('WS init failed', err);
    startMeasurementsPolling();
    return;
  }
  ws.onopen = () => {
    wsConnected = true;
    if (measurePollTimer) clearInterval(measurePollTimer);
    showToast('WebSocket подключён');
  };
  ws.onclose = () => {
    wsConnected = false;
    startMeasurementsPolling();
    setTimeout(connectRealtime, 2000);
  };
  ws.onerror = (err) => { console.error('WS error', err); };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (!isValidWsMessage(msg)) return;

      if (msg.type === 'measurements') {
        const payload = msg.payload || {};
        if (payload.batch_id && Data.batch && Number(Data.batch.id) !== Number(payload.batch_id)) return;
        toMeasurementList(payload).forEach((m) => {
          const pid = String(m.parameter_id);
          const val = Number(m.value);
          const t   = toMs(m.timestamp) || Date.now();
          if (!pid || !Number.isFinite(val)) return;
          applyMeasurementPoint(pid, val, t);
          if (m.tolerance != null) Data.tolerances[pid] = m.tolerance;
          if (m.setpoint  != null) Data.currentSetpoints[pid] = m.setpoint;
        });
        updateStageHeader(payload);
        evaluateAllParameters();
        updateParamCurrentInfo();
        drawCharts();
      }

      if (msg.type === 'batch:started') {
        clearChartData();
        showToast('Партия запущена');
        loadAllData();
      }

      if (msg.type === 'batch:stopped') {
        showToast('Партия остановлена');
        clearChartData();
        updateStageHeader({});
        Data.histories = {};
        Data.alarms = [];
        $$('[data-field="status"]').forEach((el) => { el.className = 'status-chip ok'; el.textContent = 'OK'; });
        $$('.delta').forEach((el) => { el.className = 'delta ok'; });
        renderAlarms($('#alarmsList'), $('#alarmsSummary'));
        loadAllData();
      }

      if (msg.type === 'alarm:new') {
        const a = msg.payload || {};
        if (!a.id || !a.parameter_id) return;
        Data.alarms.unshift({
          id:        a.id,
          paramId:   String(a.parameter_id || ''),
          paramName: a.parameter_name || 'Параметр',
          value:     Number(a.value ?? 0),
          setpoint:  Number(a.setpoint ?? 0),
          deviation: Number((a.value ?? 0) - (a.setpoint ?? 0)),
          severity:  a.severity ? a.severity.charAt(0).toUpperCase() + a.severity.slice(1).toLowerCase() : 'Warning',
          status:    a.status || 'active',
          time:      toMs(a.created_at) || Date.now(),
          clearTime: null,
          batchId:   a.batch_id,
          acknowledgedBy: a.acknowledged_by || null,
          acknowledgedByName: a.acknowledged_by_name || '',
        });
        refreshAlarmViews();
      }

      if (msg.type === 'alarm:ack') {
        const alarm = Data.alarms.find((x) => Number(x.id) === Number(msg.payload?.id));
        if (alarm) {
          alarm.status = 'ack';
          alarm.ackTime = toMs(msg.payload?.acknowledged_at) || Date.now();
          alarm.acknowledgedBy = msg.payload?.acknowledged_by || alarm.acknowledgedBy || null;
          alarm.acknowledgedByName = msg.payload?.acknowledged_by_name || alarm.acknowledgedByName || '';
        }
        refreshAlarmViews();
      }

      if (msg.type === 'alarm:clear') {
        const pid   = String(msg.payload?.parameter_id || '');
        const batchId = msg.payload?.batch_id;
        const closedIds = Array.isArray(msg.payload?.closed_alarm_ids)
          ? msg.payload.closed_alarm_ids.map((id) => Number(id))
          : [];
        const clearTime = toMs(msg.payload?.acknowledged_at) || Date.now();
        Data.alarms
          .filter((x) => {
            const sameParameter = x.paramId === pid && (batchId == null || Number(x.batchId) === Number(batchId));
            const explicitlyClosed = closedIds.includes(Number(x.id));
            return x.status !== 'cleared' && (sameParameter || explicitlyClosed);
          })
          .forEach((alarm) => {
            alarm.status = 'cleared';
            alarm.clearTime = clearTime;
            alarm.acknowledgedBy = null;
            alarm.acknowledgedByName = '';
          });
        refreshAlarmViews();
      }

      if (msg.type === 'manual:override') {
        const pid    = String(msg.payload?.parameter_id || '');
        const val    = Number(msg.payload?.value ?? 0);
        const expSec = Number(msg.payload?.expires_in_sec ?? 60);
        if (!pid || !Number.isFinite(val)) return;
        showOverrideIndicator(pid, val, expSec);
      }

      if (msg.type === 'manual:override:clear') {
        const pid = String(msg.payload?.parameter_id || '');
        if (!pid) return;
        clearOverrideIndicator(pid);
        updateParamCurrentInfo();
        refreshMeasurements();
      }
    } catch (err) {
      console.error('WS parse error', err);
    }
  };
}

//Опрос измерений 
async function refreshMeasurements() {
  if (!Data.batch || !Data.batch.id || Data.batch.id === '-') return;
  try {
    const measurements = await fetchJson(`/api/batches/${Data.batch.id}/measured`);
    (measurements || [])
      .sort((a, b) => (toMs(a.created_at || a.timestamp) || 0) - (toMs(b.created_at || b.timestamp) || 0))
      .forEach((m) => {
        const pid     = String(m.parameter_id || m.id_parameters || '');
        const val     = Number(m.value);
        const t       = toMs(m.created_at || m.timestamp);
        if (!pid || !Number.isFinite(val) || !t) return;
        const history = Data.histories[pid] || [];
        const last    = history[history.length - 1];
        if (last && last.t >= t) return;
        addHistoryPoint(pid, val, t);
        Data.current[pid] = val;
      });
    evaluateAllParameters();
    updateParamCurrentInfo();
  } catch (err) {
    console.error('Failed to refresh measurements', err);
  }
}

function startMeasurementsPolling() {
  if (measurePollTimer) clearInterval(measurePollTimer);
  refreshMeasurements();
  measurePollTimer = setInterval(refreshMeasurements, MEASURE_POLL_MS);
}

//Загрузка всех данных при старте

async function loadAllData() {
  try {
    const [params, batches, recipes, alarms, user, processState] = await Promise.all([
      fetchJson('/api/parameters'),
      fetchJson('/api/batches'),
      fetchJson('/api/recipes'),
      fetchJson('/api/alarms'),
      fetchJson('/api/me'),
      fetchJson('/api/process-state'),
    ]);

    Data.currentUser = user || getStoredUser() || null;
    if (Data.currentUser) setStoredUser(Data.currentUser);

    Data.processState = processState || {};

    // Параметры
    const palette = ['#38BDF8','#FDE047','#4ADE80','#C084FC','#F59E0B','#60A5FA','#F472B6','#2DD4BF','#818CF8','#E879F9','#F0ABFC','#67E8F9'];
    const assignedColors = new Set();
    let paletteIdx = 0;
    Data.parameters = (params || []).map((p) => {
      let color = (p.color || '').trim();
      if (!color || assignedColors.has(color)) { color = palette[paletteIdx % palette.length]; paletteIdx++; }
      assignedColors.add(color);
      return {
        id:         String(p.id),
        name:       p.name || String(p.id),
        unit:       p.unit || '',
        color,
        setpoint:   Number(p.setpoint_default ?? 0),
        warnLow:    Number(p.warn_low   ?? p.setpoint_default ?? 0),
        warnHigh:   Number(p.warn_high  ?? p.setpoint_default ?? 0),
        alarmLow:   Number(p.alarm_low  ?? p.setpoint_default ?? 0),
        alarmHigh:  Number(p.alarm_high ?? p.setpoint_default ?? 0),
      };
    });

    Data.batches  = batches  || [];
    Data.processState = processState || {};
    const isRunning = Number(Data.processState?.is_running ?? 0) === 1;

    // Активная партия
    let activeBatch = null;
    if (isRunning) {
      activeBatch =
        (batches || []).find((b) => Number(b.id) === Number(Data.processState.active_batch_id)) ||
        (batches || []).find((b) => Number(b.id_batches) === Number(Data.processState.active_batch_id)) ||
        (batches || []).find((b) => (b.status || '').toLowerCase() === 'active') ||
        null;
    }
    if (activeBatch) {
      Data.batch = {
        id:               activeBatch.id ?? activeBatch.id_batches,
        batch_number:     activeBatch.batch_number || null,
        recipe:           activeBatch.recipe || activeBatch.recipe_id || '-',
        recipeId:         activeBatch.recipe_id,
        operator:         activeBatch.operator || '-',
        technologist:     activeBatch.technologist || '-',
        start:            toMs(activeBatch.start_time) || 0,
        developmentStart: toMs(activeBatch.development_start) || toMs(activeBatch.start_time) || 0,
        weight:           activeBatch.green_weight_in != null ? String(activeBatch.green_weight_in) : '-',
        status:           activeBatch.status || 'active',
      };
      Data.batchStartTime = toMs(activeBatch.start_time) || null;
      const activeRecipe = (recipes || []).find((r) => Number(r.id) === Number(activeBatch.recipe_id));
      Data.stages = activeRecipe ? (activeRecipe.stages || []) : [];
    } else {
      Data.batch = null;
      Data.batchStartTime = null;
      Data.stages = [];
    }

    //Архив партий
    Data.archiveBatches = (batches || []).map((b) => {
      const startMs = toMs(b.start_time);
      const endMs   = toMs(b.end_time);
      return {
        id:             b.id,
        batchNumber:    b.batch_number || `#${b.id}`,
        recipe:         b.recipe || '-',
        recipeCategory: b.recipe_category || '-',
        operator:       b.operator || '-',
	        coffeeVariety:  b.coffee_variety || '-',
	        greenWeight:    b.green_weight_in != null ? b.green_weight_in : '-',
	        roastedWeight:  b.weight != null ? b.weight : '-',
	        lossKg:         b.loss_kg != null ? b.loss_kg : '-',
	        lossPercent:    b.loss_percent != null ? b.loss_percent : '-',
	        startTime:      startMs ? new Date(startMs).toLocaleString('ru', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-',
        duration:       startMs && endMs ? formatMs(endMs - startMs) : '-',
        status:         b.status || 'completed',
      };
    });

    //Рецепты
    Data.recipes = (recipes || []).map((r) => ({
      id:                 r.id,
      name:               r.name,
      category:           r.category,
      description:        r.description || '',
      total_duration_sec: r.total_duration_sec || 0,
      target_weight_kg:   r.target_weight_kg || 0,
      setpoints:          r.setpoints || [],
      stages:             r.stages    || [],
      is_active:          Number(r.is_active ?? 1),
    }));
    Data.recipeSetpoints = {};
    Data.recipes.forEach((r) => {
      const map = {};
      (r.setpoints || []).forEach((sp) => {
        const pid = String(sp.parameter_id || sp.id_parameters || sp.pid || sp.id || '');
        map[pid] = sp.target_value;
      });
      Data.recipeSetpoints[r.id] = map;
    });
    Data.activeRecipeSetpoints = Data.batch && Data.batch.recipeId
      ? Data.recipeSetpoints[Data.batch.recipeId] || {}
      : {};

    //Тревоги
    Data.alarms = (alarms || []).map((a) => ({
      id:        a.id,
      paramId:   String(a.parameter_id || a.id_parameters || ''),
      paramName: a.parameter_name || 'Parameter',
      value:     Number(a.value    ?? 0),
      setpoint:  Number(a.setpoint ?? 0),
      deviation: Number((a.value ?? 0) - (a.setpoint ?? 0)),
      severity:  a.severity ? a.severity.charAt(0).toUpperCase() + a.severity.slice(1).toLowerCase() : 'Warning',
      status:    a.status   || 'active',
      time:      toMs(a.created_at) || Date.now(),
      clearTime: toMs(a.acknowledged_at) || null,
      batchId:   a.batch_id || a.id_batches,
      acknowledgedBy: a.acknowledged_by || null,
      acknowledgedByName: a.acknowledged_by_name || '',
    }));
    if (Data.alarms.length) {
      Data.alarmId = Math.max(...Data.alarms.map((x) => Number(x.id) || 0)) + 1;
    }

    //История измерений активной партии
    if (Data.batch && Data.batch.id && Data.batch.id !== '-') {
      const measurements = await fetchJson(`/api/batches/${Data.batch.id}/measured`);
      (measurements || [])
        .sort((a, b) => (toMs(a.created_at || a.timestamp) || 0) - (toMs(b.created_at || b.timestamp) || 0))
        .forEach((m) => {
          const pid = String(m.parameter_id || m.id_parameters || '');
          const val = Number(m.value ?? 0);
          const t   = toMs(m.created_at || m.timestamp) || Date.now();
          addHistoryPoint(pid, val, t);
          Data.current[pid] = val;
        });
    }

    Data.parameters.forEach((p) => {
      if (Data.current[p.id] == null) Data.current[p.id] = getSetpoint(p.id);
      if (!Data.histories[p.id])      Data.histories[p.id] = [];
    });

    evaluateAllParameters();
    renderCurrentBatchInfo();
    refreshAlarmViews();
  } catch (err) {
    console.error('Failed to load data', err);
    showToast('Failed to load data from API');
  }
}
