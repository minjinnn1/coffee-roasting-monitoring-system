require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const http = require('http');
const WebSocket = require('ws');
const {
  ROLES,
  PARAMETER_IDS,
  ALL_PROCESS_PARAMETER_IDS,
  ALARM_PARAMETER_IDS,
  CONTROL_PARAMETER_IDS,
  BATCH_STATUSES,
  EVENT_TYPES,
  WS_EVENTS,
  DEVIATION_SCENARIOS,
  MANUAL_OVERRIDE_TTL_MS,
} = require('./config/constants');
const {
  toPositiveInt,
  toFiniteNumber,
  toNonNegativeNumber,
  cleanText,
  validateRecipePayload,
} = require('./utils/validation');

const {
  DB_HOST = 'localhost',
  DB_PORT = 3306,
  DB_USER = 'root',
  DB_PASS = '',
  DB_NAME = '',
  PORT = 3000,
  API_CORS_ORIGIN = '*',
} = process.env;

const app = express();
app.use(express.json());
app.use(cors({ origin: API_CORS_ORIGIN === '*' ? '*' : API_CORS_ORIGIN.split(',').map((o) => o.trim()) }));

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
});
pool.getConnection()
  .then(conn => { console.log('✅ MySQL connected'); conn.release(); })
  .catch(err => { console.error('❌ MySQL connection error:', err); });

function handleDbError(res, err) {
  console.error('[DB_ERROR]', err);
  res.status(500).json({ ok: false, error: 'DB_ERROR', message: err.message });
}

function badRequest(res, error, message) {
  return res.status(400).json({ ok: false, error, message });
}

async function safeRollback(conn, context) {
  try { await conn.rollback(); }
  catch (rollbackErr) { console.error(`[${context}_ROLLBACK_ERROR]`, rollbackErr); }
}

async function logEvent(conn, {
  eventType,
  userId = null,
  batchId = null,
  recipeId = null,
  description = ''
}) {
  await conn.query(
    `INSERT INTO system_events_log (event_type, id_user, id_batches, id_recipe, description)
     VALUES (?, ?, ?, ?, ?)`,
    [eventType, userId, batchId, recipeId, description]
  );
}

async function logControlAction(conn, {
  userId,
  batchId,
  parameterId,
  oldValue,
  newValue,
  unit,
  description = ''
}) {
  await conn.query(
    `INSERT INTO control_actions_log (id_user, id_batches, id_parameters, old_value, new_value, unit, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, batchId, parameterId, oldValue, newValue, unit, description]
  );
}

// ─── СЕССИИ ──────────────────────────────────────────────────────────────────
const sessions = new Map();
function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  const session = { token, user, expiresAt };
  sessions.set(token, session);
  return session;
}
function getSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(token); return null; }
  return session;
}
function authMiddleware(req, res, next) {
  if (req.path === '/api/login' || req.path === '/health' || req.path === '/api/ping-db') return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token ? getSession(token) : null;
  if (!session) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  req.user = session.user;
  next();
}

// ─── СОСТОЯНИЕ СИМУЛЯЦИИ ─────────────────────────────────────────────────────
const simState = {
  timer: null,
  activeBatchId: null,
  startedAt: null,
  recipeId: null,
  deviationScenario: null,
  setpoints: new Map(),
  stages: [],
  currentValues: new Map(),
  parameterMeta: new Map(),
  activeAlarmKeys: new Set(),
  activeAlarmSeverity: new Map(),
  manualOverrides: new Map(),
  beanTempHistory: [],
  autoCtrl: { P_heat: null, V_air: null, tickCount: 0, lastLoggedAt: 0 },

  // Временный демонстрационный сценарий отклонения для защиты ВКР.
  testDeviation: null,

};

// ─── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ──────────────────────────────────────────────────
function safeSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); }
  catch (err) { console.error('[WS_SEND_ERROR]', err); }
}
function broadcast(payload) { wss.clients.forEach((client) => safeSend(client, payload)); }
function makeBatchNumber(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `BATCH-${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}
function roastLossPercent(roastDegree) {
  const degree = String(roastDegree || '').trim().toLowerCase();
  if (degree === 'light') return 11;
  if (degree === 'dark') return 17;
  if (degree === 'medium') return 14;
  return 0;
}
function calculateRoastedWeight(greenWeightIn, roastDegree) {
  const greenWeight = Number(greenWeightIn);
  const lossPercent = roastLossPercent(roastDegree);
  if (!Number.isFinite(greenWeight) || greenWeight <= 0 || !lossPercent) return null;
  return Number((greenWeight * (1 - lossPercent / 100)).toFixed(2));
}
async function loadParameterMeta(conn=pool) {
  const [rows] = await conn.query(`SELECT id_parameters, name, unit FROM parameters ORDER BY id_parameters`);
  simState.parameterMeta = new Map(rows.map((r) => [Number(r.id_parameters), r]));
  return rows;
}

async function getStageTypesMap(conn=pool) {
  const [rows] = await conn.query(
    `SELECT id_stage_type, stage_code, stage_name, description, sort_order FROM stage_types`
  );
  return new Map(rows.map((r) => [r.stage_code, r]));
}

function findStageForSetpoint(stages, timeOffsetSec) {
  return stages.find((s) => timeOffsetSec >= s.start_time_sec && timeOffsetSec <= s.end_time_sec) || null;
}

// Линейная интерполяция уставки по времени
function interpolateAt(points, elapsedSec) {
  const arr = (points || []).slice().sort((a,b) => a.time_offset_sec - b.time_offset_sec);
  if (!arr.length) return { value: 0, tolerance: 0 };
  if (elapsedSec <= arr[0].time_offset_sec) return { value: Number(arr[0].target_value), tolerance: Number(arr[0].tolerance || 0) };
  for (let i=1; i<arr.length; i++) {
    const prev=arr[i-1], cur=arr[i];
    if (elapsedSec <= cur.time_offset_sec) {
      const span = cur.time_offset_sec - prev.time_offset_sec || 1;
      const ratio = (elapsedSec - prev.time_offset_sec) / span;
      return {
        value: Number(prev.target_value) + (Number(cur.target_value)-Number(prev.target_value))*ratio,
        tolerance: Number(prev.tolerance || 0) + (Number(cur.tolerance||0)-Number(prev.tolerance||0))*ratio,
      };
    }
  }
  const last=arr[arr.length-1];
  return { value: Number(last.target_value), tolerance: Number(last.tolerance || 0) };
}

function currentStage(elapsedSec) {
  return simState.stages.find((s) => elapsedSec >= s.start_time_sec && elapsedSec <= s.end_time_sec)
    || simState.stages[simState.stages.length-1] || null;
}

function noise(scale=1) { return (Math.random()-0.5) * scale * 2; }

function makeAlarmKey(batchId, parameterId, severity) {
  return `${batchId}:${parameterId}:${severity}`;
}

function makeAlarmStateKey(batchId, parameterId) {
  return `${batchId}:${parameterId}`;
}

function clearAlarmKeysForParameter(batchId, parameterId) {
  const prefix = `${batchId}:${parameterId}:`;
  let cleared = false;
  for (const key of simState.activeAlarmKeys) {
    if (key.startsWith(prefix)) {
      simState.activeAlarmKeys.delete(key);
      cleared = true;
    }
  }
  return cleared;
}

async function closeActiveAlarmsForParameter(conn, batchId, parameterId) {
  const [rows] = await conn.query(
    `SELECT id_error
     FROM errors_log
     WHERE id_batches=?
       AND id_parameters=?
       AND is_acknowledged=0`,
    [batchId, parameterId]
  );
  if (!rows.length) return [];

  await conn.query(
    `UPDATE errors_log
     SET is_acknowledged=1,
         acknowledged_at=NOW(),
         acknowledged_by=NULL
     WHERE id_batches=?
       AND id_parameters=?
       AND is_acknowledged=0`,
    [batchId, parameterId]
  );
  return rows.map((row) => row.id_error);
}

// ─── ЗАГРУЗКА КОНТЕКСТА СИМУЛЯЦИИ ────────────────────────────────────────────
async function loadSimulationContext(batchId, conn=pool) {
  const [[batch]] = await conn.query(
    `SELECT b.id_batches, b.id_recipe, b.start_time, r.total_duration_sec
     FROM batches b JOIN recipes r ON r.id_recipe=b.id_recipe
     WHERE b.id_batches=? LIMIT 1`,
    [batchId]
  );
  if (!batch) return null;

  const [setpoints] = await conn.query(
    `SELECT id_recipe, id_parameters, time_offset_sec, target_value, tolerance
     FROM recipe_setpoints WHERE id_recipe=? ORDER BY id_parameters, time_offset_sec`,
    [batch.id_recipe]
  );
  const [stages] = await conn.query(
    `SELECT rs.id_stage, rs.id_recipe, rs.id_stage_type,
            st.stage_code,
            COALESCE(rs.stage_name, st.stage_name) AS stage_name,
            rs.start_time_sec, rs.end_time_sec, st.description
     FROM recipe_stages rs
     JOIN stage_types st ON st.id_stage_type = rs.id_stage_type
     WHERE rs.id_recipe=? ORDER BY rs.start_time_sec`,
    [batch.id_recipe]
  );
  await loadParameterMeta(conn);

  simState.activeBatchId = batchId;
  simState.recipeId = batch.id_recipe;
  simState.startedAt = new Date(batch.start_time).getTime();
  simState.stages = stages;
  simState.setpoints = new Map();
  simState.currentValues = new Map();
  simState.activeAlarmKeys = new Set();
  simState.activeAlarmSeverity = new Map();

  // Полный сброс состояния — новая партия не наследует поведение предыдущей
  simState.beanTempHistory = [];
  simState.manualOverrides = new Map();
  simState.deviationScenario = null;
  simState.autoCtrl = { P_heat: null, V_air: null, tickCount: 0, lastLoggedAt: 0 };

  for (const sp of setpoints) {
    const pid = Number(sp.id_parameters);
    if (!simState.setpoints.has(pid)) simState.setpoints.set(pid, []);
    simState.setpoints.get(pid).push(sp);
  }

  // Инициализируем стартовые значения из уставок t=0,
  // чтобы партия начиналась в рабочей точке профиля, а не от нуля
  for (const pid of ALL_PROCESS_PARAMETER_IDS) {
    const sp0 = interpolateAt(simState.setpoints.get(pid) || [], 0);
    simState.currentValues.set(pid, Number(sp0.value) || 0);
  }

  return batch;
}

// ─── БД: ЗАПИСЬ ИЗМЕРЕНИЯ ────────────────────────────────────────────────────
async function insertMeasurement(conn, batchId, parameterId, value, timestamp=new Date()) {
  await conn.query(
    `INSERT INTO measured_values (id_batches, id_parameters, value, timestamp) VALUES (?, ?, ?, ?)`,
    [batchId, parameterId, value, timestamp]
  );
}

// ─── БД: СОЗДАНИЕ ТРЕВОГИ ────────────────────────────────────────────────────
async function createDeviationIfNeeded(conn, payload) {
  const { batchId, parameterId, actualValue, expectedValue, tolerance } = payload;
  const diff = Math.abs(actualValue - expectedValue);
  const severity = diff > tolerance * 1.5 ? 'critical' : 'warning';
  const key = makeAlarmKey(batchId, parameterId, severity);
  const stateKey = makeAlarmStateKey(batchId, parameterId);

  if (diff <= tolerance) {
    const wasActive = clearAlarmKeysForParameter(batchId, parameterId);
    simState.activeAlarmSeverity.delete(stateKey);
    const closedAlarmIds = await closeActiveAlarmsForParameter(conn, batchId, parameterId);
    return (wasActive || closedAlarmIds.length)
      ? { cleared: true, parameter_id: parameterId, batch_id: batchId, closed_alarm_ids: closedAlarmIds }
      : null;
  }

  const lastSeverity = simState.activeAlarmSeverity.get(stateKey);
  if (!lastSeverity) {
    const [[lastOpenAlarm]] = await conn.query(
      `SELECT severity
       FROM errors_log
       WHERE id_batches=?
         AND id_parameters=?
         AND is_acknowledged=0
       ORDER BY timestamp DESC, id_error DESC
       LIMIT 1`,
      [batchId, parameterId]
    );
    if (lastOpenAlarm?.severity) {
      simState.activeAlarmSeverity.set(stateKey, lastOpenAlarm.severity);
    }
  }
  if (simState.activeAlarmSeverity.get(stateKey) === severity) return null;

  const meta = simState.parameterMeta.get(parameterId) || {};
  const [[sensor]] = await conn.query(
    `SELECT id_sensor, id_equipment
     FROM sensors
     WHERE id_parameters = ?
       AND status = 'operational'
     LIMIT 1`,
    [parameterId]
  );
  const description = `Отклонение параметра ${meta.name || parameterId} от уставки`;
  const [res] = await conn.query(
    `INSERT INTO errors_log (
       id_batches,
       id_equipment,
       id_sensor,
       id_parameters,
       error_type,
       description,
       actual_value,
       expected_value,
       severity,
       timestamp
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      batchId,
      sensor?.id_equipment || null,
      sensor?.id_sensor || null,
      parameterId,
      'setpoint_deviation',
      description,
      actualValue,
      expectedValue,
      severity
    ]
  );
  simState.activeAlarmKeys.add(key);
  simState.activeAlarmSeverity.set(stateKey, severity);
  return {
    id: res.insertId,
    parameter_id: parameterId,
    parameter_name: meta.name || `Параметр ${parameterId}`,
    parameter_unit: meta.unit || '',
    severity,
    status: BATCH_STATUSES.ACTIVE,
    value: actualValue,
    setpoint: expectedValue,
    description: `Отклонение ${meta.name || parameterId}`,
    batch_id: batchId,
    alarm_key: key,
    alarm_state_key: stateKey,
    created_at: new Date().toISOString(),
    acknowledged_at: null,
  };
}


async function tickSimulation() {
  if (!simState.activeBatchId || !simState.startedAt) return;

  const elapsedSec = Math.max(0, Math.floor((Date.now() - simState.startedAt) / 1000));
  const stage = currentStage(elapsedSec);
  const batchId = simState.activeBatchId;
  const measurements = [];
  const newAlarms = [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. УПРАВЛЯЮЩИЕ ПАРАМЕТРЫ (рецепт + ручная коррекция оператора) ───────
    const { P_heat, V_air } = updateControls(elapsedSec);

    // ── 2. ИЗМЕРЯЕМЫЕ ТЕМПЕРАТУРЫ — реагируют на P_heat и V_air ──────────────
    const { T_in, T_out, T_grain } = generateTemperatures(P_heat, V_air, elapsedSec);

    // ── 3. RoR — реагирует на управляющие параметры по той же модели ─────────
    const RoR = calculateRoR(elapsedSec, P_heat, V_air);

    // ── 4. СОХРАНЯЕМ ТЕКУЩИЕ ЗНАЧЕНИЯ ────────────────────────────────────────
    const values = {
      1: Number(T_in.toFixed(2)),
      2: Number(T_out.toFixed(2)),
      3: Number(T_grain.toFixed(2)),
      4: Number(RoR.toFixed(2)),
      5: Number(P_heat.toFixed(2)),
      6: Number(V_air.toFixed(2)),
    };

    applyTestDeviation(values, stage, P_heat, elapsedSec);

    for (const pid of ALL_PROCESS_PARAMETER_IDS) {
      simState.currentValues.set(pid, values[pid]);
    }

    // ── 5. ЗАПИСЬ В БД + ПРОВЕРКА ТРЕВОГ ─────────────────────────────────────
    await saveMeasurements(conn, batchId, values, elapsedSec, measurements, newAlarms);

    await conn.commit();
  } catch (err) {
    await safeRollback(conn, 'SIM_TICK');
    for (const a of newAlarms) {
      if (a.alarm_key) simState.activeAlarmKeys.delete(a.alarm_key);
      if (a.alarm_state_key) simState.activeAlarmSeverity.delete(a.alarm_state_key);
    }
    newAlarms.length = 0;
    console.error('[SIM_TICK_ERROR]', err);
  } finally {
    conn.release();
  }

  // ── 6. РАССЫЛКА ПО WEBSOCKET ─────────────────────────────────────────────
  const stageElapsed = stage ? Math.max(0, elapsedSec - stage.start_time_sec) : 0;
  const stageDuration = stage ? Math.max(1, stage.end_time_sec - stage.start_time_sec) : 1;
  broadcast({
    type: WS_EVENTS.MEASUREMENTS,
    payload: {
      batch_id: batchId,
      elapsed_sec: elapsedSec,
      stage,
      stage_elapsed: stageElapsed,
      stage_duration: stageDuration,
      measurements,
      generated_at: new Date().toISOString(),
    },
  });

  for (const alarm of newAlarms) {
    if (alarm.cleared) {
      broadcast({
        type: WS_EVENTS.ALARM_CLEAR,
        payload: {
          parameter_id: alarm.parameter_id,
          batch_id: alarm.batch_id,
          closed_alarm_ids: alarm.closed_alarm_ids || [],
          acknowledged_at: new Date().toISOString(),
        }
      });
    } else {
      broadcast({ type: WS_EVENTS.ALARM_NEW, payload: alarm });
    }
  }

  if (stage && stage.stage_code === 'discharge') {
    const maxEnd = Math.max(...simState.stages.map((s) => s.end_time_sec), 0);
    if (elapsedSec >= maxEnd) {
      await stopBatch({ batchId, roastedWeightOut: null, status: BATCH_STATUSES.COMPLETED, userId: 1, auto: true });
    }
  }
}

// Демонстрационное отклонение применяется до записи измерений:
// графики, тревоги и WebSocket получают то же значение, что сохраняется в БД.
function applyTestDeviation(values, stage, P_heat, elapsedSec) {
  if (!simState.testDeviation?.enabled) return;

  const deviation = simState.testDeviation;
  const now = Date.now();
  const isTimeActive = now - deviation.startedAt < deviation.durationMs;
  const isTargetStage = stage?.stage_code === deviation.stageCode;

  if (isTimeActive && isTargetStage) {
    const dtSec = Math.max(0.2, Math.min(3, ((now - (deviation.lastTickAt || now)) / 1000) || 1));
    deviation.lastTickAt = now;

    // Насколько оператор снизил мощность относительно рецептурной уставки.
    const recipePower = simState.autoCtrl.P_heat || P_heat;
    const reduction = Math.max(0, recipePower - P_heat);

    // Каждые -1 кВт постепенно уменьшают перегрев примерно на 4 °C.
    const correctionEffect = reduction * (deviation.correctionPerKw ?? 4);

    // Целевое отклонение меняется сразу, но фактическая температура догоняет его с инерцией.
    const targetOffset = Math.max(
      0,
      deviation.offsetValue - correctionEffect
    );
    const currentOffset = Number(deviation.currentOffset ?? 0);
    const tauSec = Number(deviation.thermalTauSec ?? 8);
    const alpha = 1 - Math.exp(-dtSec / Math.max(1, tauSec));
    deviation.currentOffset = Number(
      (currentOffset + (targetOffset - currentOffset) * alpha).toFixed(2)
    );

    // Перегрев входящего воздуха.
    const parameterId = Number(deviation.parameterId);
    values[parameterId] = Number(
      (
        values[parameterId] + deviation.currentOffset
      ).toFixed(2)
    );
  }

  if (!isTimeActive) {
    simState.testDeviation = null;
  }
}

// ─── ФУНКЦИЯ: ОБНОВЛЕНИЕ УПРАВЛЯЮЩИХ ПАРАМЕТРОВ ───────────────────────────────
// Управляющие параметры (5, 6) следуют уставке рецепта.
// Ручная коррекция оператора имеет приоритет на 60 секунд.
function updateControls(elapsedSec) {
  const getControlValue = (pid, fallback) => {
    const ov = simState.manualOverrides.get(pid);
    if (ov && (Date.now() - ov.setAt) < MANUAL_OVERRIDE_TTL_MS) return ov.value;
    if (ov) simState.manualOverrides.delete(pid);
    return fallback;
  };

  const recipeP = interpolateAt(simState.setpoints.get(5) || [], elapsedSec).value || 0;
  const recipeV = interpolateAt(simState.setpoints.get(6) || [], elapsedSec).value || 0;

  simState.autoCtrl.P_heat = recipeP;
  simState.autoCtrl.V_air = recipeV;

  const P_heat = getControlValue(5, recipeP);
  const V_air = getControlValue(6, recipeV);

  return { P_heat, V_air };
}

// ─── ФУНКЦИЯ: ГЕНЕРАЦИЯ ТЕМПЕРАТУР (ФИЗИЧЕСКАЯ МОДЕЛЬ) ────────────────────────
// Имитатор датчиков. Принцип:
//   T_target = T_setpoint_рецепт + k_P × (P_heat − P_рецепт) − k_V × (V_air − V_рецепт)
//
// Когда P_heat и V_air идут по рецепту (ΔP = ΔV = 0):
//   → T_target = T_setpoint_рецепт точно
//   → значение колышется около уставки только из-за маленького шума
//   → тревог нет (идеальный режим)
//
// Когда оператор вручную меняет управляющие параметры:
//   → температуры реально реагируют:
//     рост мощности → рост температур;
//     рост воздуха → охлаждение T_in/T_grain, рост T_out (унос тепла наружу).
//
// Тепловая инерция: фактическое значение плавно тянется к target,
// зерно медленнее воздуха (большая тепловая масса).
//
// Сценарии deviationScenario накладываются ПОВЕРХ модели — для демонстрации
// работы системы тревог по запросу оператора.
function generateTemperatures(P_heat, V_air, elapsedSec) {
  const spIn    = interpolateAt(simState.setpoints.get(1) || [], elapsedSec).value;
  const spOut   = interpolateAt(simState.setpoints.get(2) || [], elapsedSec).value;
  const spGrain = interpolateAt(simState.setpoints.get(3) || [], elapsedSec).value;

  const spP = interpolateAt(simState.setpoints.get(5) || [], elapsedSec).value || P_heat;
  const spV = interpolateAt(simState.setpoints.get(6) || [], elapsedSec).value || V_air;

  const prevIn    = simState.currentValues.get(1) ?? spIn;
  const prevOut   = simState.currentValues.get(2) ?? spOut;
  const prevGrain = simState.currentValues.get(3) ?? spGrain;

  const dP = Number(P_heat) - Number(spP);
  const dV = Number(V_air) - Number(spV);

  // Если управление идёт по рецепту, dP = 0 и dV = 0,
  // значит целевые температуры точно равны уставкам.
  let targetIn =
    Number(spIn) +
    dP * 1.2 -
    dV * 0.8;

  let targetGrain =
    Number(spGrain) +
    dP * 0.7 -
    dV * 0.4;

  let targetOut =
    Number(spOut) +
    dP * 0.8 +
    dV * 0.5;

  const scenario = simState.deviationScenario;

  if (scenario && Date.now() < scenario.endsAt) {
    if (scenario.type === 'grain_overheat') targetGrain += scenario.value;
    if (scenario.type === 'grain_underheat') targetGrain -= scenario.value;
    if (scenario.type === 'air_overheat') targetIn += scenario.value;
    if (scenario.type === 'airflow_problem') targetOut += scenario.value;
  }

  if (scenario && Date.now() >= scenario.endsAt) {
    simState.deviationScenario = null;
  }

  const controlChanged = Math.abs(dP) > 0.01 || Math.abs(dV) > 0.01 || scenario;

  if (!controlChanged) {
    return {
      T_in: Number(spIn),
      T_out: Number(spOut),
      T_grain: Number(spGrain),
    };
  }

  const T_in =
    prevIn + (targetIn - prevIn) * 0.35;

  const T_out =
    prevOut + (targetOut - prevOut) * 0.30;

  const T_grain =
    prevGrain + (targetGrain - prevGrain) * 0.15;

  return {
    T_in: Math.max(20, Math.min(260, T_in)),
    T_out: Math.max(20, Math.min(260, T_out)),
    T_grain: Math.max(20, Math.min(260, T_grain)),
  };
}

function calculateRoR(elapsedSec, P_heat, V_air) {
  const spRoR = interpolateAt(simState.setpoints.get(4) || [], elapsedSec).value;
  const spP   = interpolateAt(simState.setpoints.get(5) || [], elapsedSec).value || 30;
  const spV   = interpolateAt(simState.setpoints.get(6) || [], elapsedSec).value || 12;

  // Отклонения управляющих от рецепта
  const dP = Number(P_heat) - Number(spP);
  const dV = Number(V_air)  - Number(spV);

  // Коэффициенты влияния:
  //   больше мощности → быстрее нагрев зерна → выше RoR;
  //   больше воздуха  → больше уноса тепла   → ниже RoR.
  const K_ROR_P = 0.3;
  const K_ROR_V = 0.4;

  let RoR_target = Number(spRoR ?? 0) + K_ROR_P * dP - K_ROR_V * dV;

  // Сценарии deviation для демонстрации тревог по RoR
  const scenario = simState.deviationScenario;
  if (scenario && Date.now() < scenario.endsAt) {
    if (scenario.type === 'ror_drop')  RoR_target -= scenario.value;
    if (scenario.type === 'ror_spike') RoR_target += scenario.value;
  }

  // Тепловая инерция (RoR не прыгает мгновенно)
  const ALPHA_ROR = 0.08;
  const prevRoR = simState.currentValues.get(4) ?? Number(spRoR ?? 0);

  // Шум маленький — гарантированно не вызывает тревог в штатном режиме
  let RoR = prevRoR + (RoR_target - prevRoR) * ALPHA_ROR;

  return Math.max(-10, Math.min(40, RoR));
}

// запись изменений и проверка тревог
async function saveMeasurements(conn, batchId, values, elapsedSec, measurements, newAlarms) {
  for (const pid of ALL_PROCESS_PARAMETER_IDS) {
    const val = values[pid];

    await insertMeasurement(conn, batchId, pid, val);

    const spPoints = simState.setpoints.get(pid) || [];
    let setpoint  = null;
    let tolerance = null;

    if (spPoints.length) {
      const ip = interpolateAt(spPoints, elapsedSec);
      setpoint  = Number(ip.value);
      tolerance = Number(ip.tolerance);

      // Тревоги только для измеряемых параметров
      if (ALARM_PARAMETER_IDS.includes(pid)) {
        const alarm = await createDeviationIfNeeded(conn, {
          batchId,
          parameterId: pid,
          actualValue: val,
          expectedValue: setpoint,
          tolerance,
        });
        if (alarm) newAlarms.push(alarm);
      }
    }

    measurements.push({
      parameter_id: pid,
      value: val,
      setpoint,
      tolerance,
      timestamp: new Date().toISOString(),
    });
  }
}

// запуск и остановка симуляции 
async function startSimulation(batchId) {
  const batch = await loadSimulationContext(batchId);
  if (!batch) throw new Error(`Batch ${batchId} not found`);
  if (simState.timer) clearInterval(simState.timer);
  simState.timer = setInterval(() => { tickSimulation().catch((err) => console.error(err)); }, 1000);
  broadcast({ type: WS_EVENTS.BATCH_STARTED, payload: { batch_id: batchId } });
}

function stopSimulation() {
  if (simState.timer) clearInterval(simState.timer);
  simState.timer = null;
  simState.activeBatchId = null;
  simState.startedAt = null;
  simState.recipeId = null;
  simState.setpoints = new Map();
  simState.stages = [];
  simState.currentValues = new Map();
  simState.activeAlarmKeys = new Set();
  simState.activeAlarmSeverity = new Map();
  simState.manualOverrides = new Map();
  simState.beanTempHistory = [];
  simState.deviationScenario = null;
  simState.autoCtrl = { P_heat: null, V_air: null, tickCount: 0, lastLoggedAt: 0 };
}

// роуты 
app.post('/api/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ ok: false, error: 'BAD_CREDENTIALS' });
  try {
    const [rows] = await pool.query(
      `SELECT id_user AS id, user_name AS name, role, email, password_hash
       FROM users WHERE login=? AND is_active=1 LIMIT 1`,
      [login]
    );
    if (!rows.length) return res.status(401).json({ ok: false, error: 'BAD_CREDENTIALS' });
    const userRow = rows[0];
    const ok = await bcrypt.compare(password, userRow.password_hash || '');
    if (!ok) return res.status(401).json({ ok: false, error: 'BAD_CREDENTIALS' });
    await pool.query(`UPDATE users SET last_login=NOW() WHERE id_user=?`, [userRow.id]);
    const conn = await pool.getConnection();
    await logEvent(conn, {
      eventType: EVENT_TYPES.LOGIN,
      userId: userRow.id,
      description: `Пользователь ${userRow.name} вошёл в систему`
    });
    conn.release();

    const user = { id: userRow.id, name: userRow.name, role: userRow.role, email: userRow.email };
    const session = createSession(user);
    res.json({ ok: true, token: session.token, user });
  } catch (err) { handleDbError(res, err); }
});

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'connected' }); }
  catch (err) { handleDbError(res, err); }
});

app.get('/api/ping-db', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ db: 'ok' }); }
  catch (err) { res.status(500).json({ db: 'error', details: err.message }); }
});

app.get('/api/me', authMiddleware, (req, res) => res.json(req.user));
app.use(authMiddleware);

app.get('/api/parameters', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id_parameters AS id, name, unit,
              0 AS setpoint_default, 0 AS warn_low, 0 AS warn_high,
              0 AS alarm_low, 0 AS alarm_high
       FROM parameters ORDER BY id_parameters`
    );
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

app.get('/api/recipes', async (_req, res) => {
  try {
    const [recipes] = await pool.query(
      `SELECT id_recipe AS id, recipe_name AS name, roast_degree AS category,
              total_duration_sec, target_weight_kg, description,
              created_by, created_at, is_active
       FROM recipes ORDER BY recipe_name`
    );
    const [setpoints] = await pool.query(
      `SELECT id_setpoint, id_recipe AS recipe_id, id_parameters AS parameter_id,
              time_offset_sec, target_value, tolerance
       FROM recipe_setpoints ORDER BY id_recipe, id_parameters, time_offset_sec`
    );
    const [stages] = await pool.query(
      `SELECT rs.id_stage, rs.id_recipe AS recipe_id, rs.id_stage_type,
              st.stage_code,
              COALESCE(rs.stage_name, st.stage_name) AS stage_name,
              rs.start_time_sec, rs.end_time_sec, st.description, st.sort_order
       FROM recipe_stages rs
       JOIN stage_types st ON st.id_stage_type = rs.id_stage_type
       ORDER BY rs.id_recipe, rs.start_time_sec`
    );
    const spByRecipe = new Map();
    const stByRecipe = new Map();
    setpoints.forEach((row) => {
      if (!spByRecipe.has(row.recipe_id)) spByRecipe.set(row.recipe_id, []);
      spByRecipe.get(row.recipe_id).push(row);
    });
    stages.forEach((row) => {
      if (!stByRecipe.has(row.recipe_id)) stByRecipe.set(row.recipe_id, []);
      stByRecipe.get(row.recipe_id).push(row);
    });
    res.json(recipes.map((r) => ({ ...r, setpoints: spByRecipe.get(r.id) || [], stages: stByRecipe.get(r.id) || [] })));
  } catch (err) { handleDbError(res, err); }
});

// CREATE recipe — только technologist
app.post('/api/recipes', async (req, res) => {
  if (req.user?.role !== ROLES.TECHNOLOGIST) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  const parsed = validateRecipePayload(req.body);
  if (parsed.error) return badRequest(res, 'VALIDATION', parsed.error);
  const { name, roast_degree, total_duration_sec, target_weight_kg, description, setpoints, stages } = parsed.value;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO recipes (recipe_name, roast_degree, total_duration_sec, target_weight_kg, description, created_by, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
      [name, roast_degree, total_duration_sec, target_weight_kg, description, req.user?.id || null]
    );
    const recipeId = ins.insertId;

    const stageTypesMap = await getStageTypesMap(conn);
    const insertedStages = [];
    for (const st of stages || []) {
      const stType = stageTypesMap.get(st.stage_code);
      if (!stType) continue;
      const stageName = st.stage_name || stType.stage_name;
      const [stIns] = await conn.query(
        `INSERT INTO recipe_stages (id_recipe, id_stage_type, stage_name, start_time_sec, end_time_sec)
         VALUES (?, ?, ?, ?, ?)`,
        [recipeId, stType.id_stage_type, stageName, st.start_time_sec, st.end_time_sec]
      );
      insertedStages.push({
        id_stage: stIns.insertId,
        id_stage_type: stType.id_stage_type,
        stage_code: stType.stage_code,
        stage_name: stageName,
        start_time_sec: st.start_time_sec,
        end_time_sec: st.end_time_sec,
        description: stType.description,
      });
    }

    for (const sp of setpoints || []) {
      const matchedStage = findStageForSetpoint(insertedStages, sp.time_offset_sec);
      await conn.query(
        `INSERT INTO recipe_setpoints (id_recipe, id_stage, id_parameters, time_offset_sec, target_value, tolerance)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [recipeId, matchedStage?.id_stage || null, sp.parameter_id, sp.time_offset_sec, sp.target_value, sp.tolerance]
      );
    }

    await conn.commit();

    try {
      await logEvent(conn, {
      eventType: EVENT_TYPES.RECIPE_CREATE,
        userId: req.user?.id || null,
        recipeId,
        description: `Создан рецепт ${name}`
      });
    } catch (logErr) { console.error('[LOG_ERROR]', logErr); }

    const [[recipeRow]] = await pool.query(`SELECT id_recipe AS id, recipe_name AS name, roast_degree AS category, total_duration_sec, target_weight_kg, description, created_by, created_at, is_active FROM recipes WHERE id_recipe=? LIMIT 1`, [recipeId]);
    const [spRows] = await pool.query(`SELECT id_setpoint, id_recipe AS recipe_id, id_parameters AS parameter_id, time_offset_sec, target_value, tolerance FROM recipe_setpoints WHERE id_recipe=? ORDER BY id_parameters, time_offset_sec`, [recipeId]);
    const [stRows] = await pool.query(
      `SELECT rs.id_stage, rs.id_recipe AS recipe_id, rs.id_stage_type, st.stage_code,
              COALESCE(rs.stage_name, st.stage_name) AS stage_name,
              rs.start_time_sec, rs.end_time_sec, st.description
       FROM recipe_stages rs
       JOIN stage_types st ON st.id_stage_type = rs.id_stage_type
       WHERE rs.id_recipe=? ORDER BY rs.start_time_sec`,
      [recipeId]
    );

    res.json({ ...recipeRow, setpoints: spRows, stages: stRows });
  } catch (err) { await safeRollback(conn, 'RECIPE_CREATE'); handleDbError(res, err); } finally { conn.release(); }
});

// UPDATE recipe — только technologist
app.put('/api/recipes/:id', async (req, res) => {
  if (req.user?.role !== ROLES.TECHNOLOGIST) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  const recipeId = toPositiveInt(req.params.id);
  const parsed = validateRecipePayload(req.body);
  if (parsed.error) return badRequest(res, 'VALIDATION', parsed.error);
  const { name, roast_degree, total_duration_sec, target_weight_kg, description, setpoints, stages } = parsed.value;
  const recipeName = name;
  const conn = await pool.getConnection();
  try {
    if (!recipeId) {
      return res.status(400).json({ ok: false, error: 'BAD_RECIPE_ID', message: 'Некорректный id рецепта' });
    }

    await conn.beginTransaction();

    const [upd] = await conn.query(
      `UPDATE recipes SET recipe_name=?, roast_degree=?, total_duration_sec=?, target_weight_kg=?, description=? WHERE id_recipe=?`,
      [recipeName, roast_degree, total_duration_sec, target_weight_kg, description, recipeId]
    );
    if (!upd.affectedRows) {
      const err = new Error(`Recipe ${recipeId} not found`);
      err.statusCode = 404;
      err.publicMessage = 'Рецепт не найден';
      throw err;
    }

    await conn.query(`DELETE FROM recipe_setpoints WHERE id_recipe=?`, [recipeId]);
    await conn.query(`DELETE FROM recipe_stages WHERE id_recipe=?`, [recipeId]);

    const stageTypesMap = await getStageTypesMap(conn);
    const insertedStages = [];
    for (const st of stages || []) {
      const stType = stageTypesMap.get(st.stage_code);
      if (!stType) continue;
      const stageName = st.stage_name || stType.stage_name;
      const [stIns] = await conn.query(
        `INSERT INTO recipe_stages (id_recipe, id_stage_type, stage_name, start_time_sec, end_time_sec)
         VALUES (?, ?, ?, ?, ?)`,
        [recipeId, stType.id_stage_type, stageName, st.start_time_sec, st.end_time_sec]
      );
      insertedStages.push({
        id_stage: stIns.insertId,
        id_stage_type: stType.id_stage_type,
        stage_code: stType.stage_code,
        stage_name: stageName,
        start_time_sec: st.start_time_sec,
        end_time_sec: st.end_time_sec,
        description: stType.description,
      });
    }

    for (const sp of setpoints || []) {
      const timeOffsetSec = Number(sp.time_offset_sec ?? 0);
      const parameterId = Number(sp.parameter_id ?? sp.id_parameters ?? 0);
      const matchedStage = findStageForSetpoint(insertedStages, timeOffsetSec);
      await conn.query(
        `INSERT INTO recipe_setpoints (id_recipe, id_stage, id_parameters, time_offset_sec, target_value, tolerance)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [recipeId, matchedStage?.id_stage || null, parameterId, timeOffsetSec, sp.target_value, sp.tolerance]
      );
    }

    await logEvent(conn, {
      eventType: EVENT_TYPES.RECIPE_UPDATE,
      userId: req.user?.id || null,
      recipeId,
      description: `Обновлён рецепт ${recipeName || recipeId}`
    });

    await conn.commit();

    const [[recipeRow]] = await pool.query(`SELECT id_recipe AS id, recipe_name AS name, roast_degree AS category, total_duration_sec, target_weight_kg, description, created_by, created_at, is_active FROM recipes WHERE id_recipe=? LIMIT 1`, [recipeId]);
    const [spRows] = await pool.query(`SELECT id_setpoint, id_recipe AS recipe_id, id_parameters AS parameter_id, time_offset_sec, target_value, tolerance FROM recipe_setpoints WHERE id_recipe=? ORDER BY id_parameters, time_offset_sec`, [recipeId]);
    const [stRows] = await pool.query(
      `SELECT rs.id_stage, rs.id_recipe AS recipe_id, rs.id_stage_type, st.stage_code,
              COALESCE(rs.stage_name, st.stage_name) AS stage_name,
              rs.start_time_sec, rs.end_time_sec, st.description
       FROM recipe_stages rs
       JOIN stage_types st ON st.id_stage_type = rs.id_stage_type
       WHERE rs.id_recipe=? ORDER BY rs.start_time_sec`,
      [recipeId]
    );

    res.json({ ...recipeRow, setpoints: spRows, stages: stRows });
  } catch (err) {
    await safeRollback(conn, 'RECIPE_UPDATE');
    console.error('[RECIPE_UPDATE_ERROR]', err);
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.statusCode === 404 ? 'NOT_FOUND' : 'RECIPE_UPDATE_ERROR',
      message: err.publicMessage || err.message || 'Не удалось обновить рецепт',
    });
  } finally { conn.release(); }
});

// DELETE (logical) recipe — только technologist
app.delete('/api/recipes/:id', async (req, res) => {
  if (req.user?.role !== ROLES.TECHNOLOGIST) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  const recipeId = toPositiveInt(req.params.id);
  if (!recipeId) return badRequest(res, 'BAD_RECIPE_ID', 'Некорректный id рецепта');
  try {
    await pool.query(`UPDATE recipes SET is_active=0 WHERE id_recipe=?`, [recipeId]);
    try {
      const logConn = await pool.getConnection();
      await logEvent(logConn, {
        eventType: EVENT_TYPES.RECIPE_DEACTIVATE,
        userId: req.user?.id || null,
        recipeId,
        description: `Рецепт ${recipeId} деактивирован`
      });
      logConn.release();
    } catch (logErr) { console.error('[LOG_ERROR]', logErr); }
    res.json({ ok: true, id: recipeId });
  } catch (err) { handleDbError(res, err); }
});

app.get('/api/batches', async (_req, res) => {
  try {
	    const [rows] = await pool.query(
	      `SELECT b.id_batches AS id, b.batch_number, b.id_recipe AS recipe_id,
	              r.recipe_name AS recipe, r.roast_degree AS recipe_category,
	              b.id_user AS user_id, u.user_name AS operator,
	              b.green_weight_in, b.coffee_variety, b.target_roast_degree,
	              b.start_time, b.end_time, b.status, b.notes,
	              b.roasted_weight_out AS weight,
	              CASE WHEN b.roasted_weight_out IS NOT NULL THEN b.green_weight_in - b.roasted_weight_out ELSE NULL END AS loss_kg,
	              CASE WHEN b.roasted_weight_out IS NOT NULL AND b.green_weight_in > 0
	                   THEN ((b.green_weight_in - b.roasted_weight_out) / b.green_weight_in) * 100
	                   ELSE NULL END AS loss_percent
	       FROM batches b
       LEFT JOIN recipes r ON r.id_recipe=b.id_recipe
       LEFT JOIN users u ON u.id_user=b.id_user
       ORDER BY b.start_time DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

app.get('/api/batches/:id/measured', async (req, res) => {
  const batchId = toPositiveInt(req.params.id);
  if (!batchId) return badRequest(res, 'BAD_BATCH_ID', 'Некорректный id партии');
  try {
    const [rows] = await pool.query(
      `SELECT m.id_values AS id, m.id_parameters AS parameter_id,
              p.name AS parameter_name, p.unit AS parameter_unit,
              m.value, m.timestamp
       FROM measured_values m
       LEFT JOIN parameters p ON p.id_parameters=m.id_parameters
       WHERE m.id_batches=? ORDER BY m.timestamp ASC LIMIT 5000`,
      [batchId]
    );
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

app.get('/api/process-state', async (_req, res) => {
  try {
    const [[state]] = await pool.query(`SELECT * FROM process_state WHERE id=1 LIMIT 1`);
    let batch = null, stage = null, elapsed_sec = 0;
    if (state?.active_batch_id) {
      const [[b]] = await pool.query(
        `SELECT b.id_batches AS id, b.batch_number, b.start_time, b.status,
                b.id_recipe AS recipe_id, r.recipe_name AS recipe
         FROM batches b LEFT JOIN recipes r ON r.id_recipe=b.id_recipe
         WHERE b.id_batches=? LIMIT 1`,
        [state.active_batch_id]
      );
      batch = b || null;
      if (b?.start_time) {
        elapsed_sec = Math.max(0, Math.floor((Date.now()-new Date(b.start_time).getTime())/1000));
        const [stages] = await pool.query(
          `SELECT rs.id_stage, st.stage_code,
                  COALESCE(rs.stage_name, st.stage_name) AS stage_name,
                  rs.start_time_sec, rs.end_time_sec
           FROM recipe_stages rs
           JOIN stage_types st ON st.id_stage_type = rs.id_stage_type
           WHERE rs.id_recipe=? ORDER BY rs.start_time_sec`,
          [b.recipe_id]
        );
        stage = stages.find((s) => elapsed_sec >= s.start_time_sec && elapsed_sec <= s.end_time_sec) || null;
      }
    }
    res.json({ ok: true, is_running: !!state?.is_running, active_batch_id: state?.active_batch_id || null, batch, elapsed_sec, stage });
  } catch (err) { handleDbError(res, err); }
});


// Запуск демонстрационного перегрева температуры зерна на этапе первого крэка.
app.post('/api/simulation/deviation/first-crack', async (req, res) => {
  try {
    if (req.user?.role !== ROLES.OPERATOR) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Запуск демонстрационного отклонения доступен только оператору',
      });
    }

    if (!simState.activeBatchId || !simState.startedAt) {
      return res.status(409).json({
        ok: false,
        error: 'NO_ACTIVE_BATCH',
        message: 'Нет активной партии',
      });
    }

    simState.testDeviation = {
      enabled: true,
      parameterId: 3,              // Температура зерна
      stageCode: 'first_crack',
      offsetValue: 14,             // +14 °C к фактической температуре
      currentOffset: 14,
      startedAt: Date.now(),
      durationMs: 120_000,         // 2 минуты
    };

    await logEvent(pool, {
      eventType: EVENT_TYPES.SIMULATION_DEVIATION,
      userId: req.user?.id || null,
      batchId: simState.activeBatchId,
      description: 'Запущено демонстрационное отклонение температуры зерна на этапе первого крэка',
    });

    res.json({
      ok: true,
      message: 'Демонстрационное отклонение запущено',
      deviation: simState.testDeviation,
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

app.post('/api/simulation/deviation/drying', async (req, res) => {
  try {
    if (!simState.activeBatchId || !simState.startedAt) {
      return res.status(409).json({
        ok: false,
        error: 'NO_ACTIVE_BATCH'
      });
    }

    simState.testDeviation = {
      enabled: true,

      // Температура входящего воздуха
      parameterId: 1,

      // только на фазе сушки
      stageCode: 'drying',

      // перегрев с тепловой инерцией
      offsetValue: 12,
      currentOffset: 0,
      correctionPerKw: 4,
      thermalTauSec: 8,

      startedAt: Date.now(),

      // 2 минуты
      durationMs: 120000,
    };

    res.json({
      ok: true,
      deviation: simState.testDeviation,
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

app.post('/api/batches/start', async (req, res) => {
  // Only operator may start batches
  if (req.user?.role !== ROLES.OPERATOR) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const { id_recipe, green_weight_in=12, coffee_variety='', target_roast_degree='medium', notes='' } = req.body || {};
  const recipeId = toPositiveInt(id_recipe);
  const greenWeightIn = toNonNegativeNumber(green_weight_in);
  const coffeeVariety = cleanText(coffee_variety, 120);
  const targetRoastDegree = cleanText(target_roast_degree, 30) || 'medium';
  const batchNotes = cleanText(notes, 1000);
  const userId = req.user?.id || 1;
  if (!recipeId) return badRequest(res, 'VALIDATION', 'id_recipe is required');
  if (greenWeightIn == null || greenWeightIn <= 0) return badRequest(res, 'VALIDATION', 'Некорректная масса партии');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[recipe]] = await conn.query(`SELECT id_recipe FROM recipes WHERE id_recipe=? AND is_active=1 LIMIT 1`, [recipeId]);
    if (!recipe) {
      await safeRollback(conn, 'BATCH_START');
      return res.status(404).json({ ok: false, error: 'RECIPE_NOT_FOUND' });
    }
    const [[running]] = await conn.query(`SELECT active_batch_id FROM process_state WHERE id=1 LIMIT 1`);
    if (running?.active_batch_id) {
      await safeRollback(conn, 'BATCH_START');
      return res.status(409).json({ ok: false, error: 'BATCH_ALREADY_RUNNING', active_batch_id: running.active_batch_id });
    }
    const [ins] = await conn.query(
      `INSERT INTO batches (batch_number, id_recipe, id_user, green_weight_in, coffee_variety, target_roast_degree, start_time, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [makeBatchNumber(), recipeId, userId, greenWeightIn, coffeeVariety, targetRoastDegree, BATCH_STATUSES.ACTIVE, batchNotes]
    );
    const batchId = ins.insertId;
    await conn.query(
      `INSERT INTO process_state (id, is_running, active_batch_id) VALUES (1, 1, ?)
       ON DUPLICATE KEY UPDATE is_running=1, active_batch_id=?`,
      [batchId, batchId]
    );
    await conn.commit();
    const [[inserted]] = await pool.query(`SELECT batch_number FROM batches WHERE id_batches=? LIMIT 1`, [batchId]);

    const logConn = await pool.getConnection();
    await logEvent(logConn, {
      eventType: EVENT_TYPES.BATCH_START,
      userId,
      batchId,
      description: `Запущена партия ${inserted?.batch_number || batchId}`
    });
    logConn.release();
    startSimulation(batchId).catch((err) => console.error('[SIM_START_ERROR]', err));
    res.json({ ok: true, batch_id: batchId, batch_number: inserted?.batch_number || null });
  } catch (err) { await safeRollback(conn, 'BATCH_START'); handleDbError(res, err); } finally { conn.release(); }
});

async function stopBatch({ batchId, roastedWeightOut=null, status=BATCH_STATUSES.COMPLETED, userId=1, auto=false }) {
  const normalizedBatchId = toPositiveInt(batchId);
  if (!normalizedBatchId) throw new Error('BAD_BATCH_ID');
  const allowedStatuses = new Set([BATCH_STATUSES.COMPLETED, BATCH_STATUSES.ABORTED]);
  const finalStatus = allowedStatuses.has(status) ? status : BATCH_STATUSES.COMPLETED;
  const requestedWeightOut = roastedWeightOut == null ? null : toNonNegativeNumber(roastedWeightOut);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[currentBatch]] = await conn.query(
      `SELECT batch_number, green_weight_in, roasted_weight_out, target_roast_degree
       FROM batches WHERE id_batches=? LIMIT 1`,
      [normalizedBatchId]
    );
    if (!currentBatch) {
      const err = new Error('Batch not found');
      err.statusCode = 404;
      throw err;
    }
    const calculatedRoastedWeight = finalStatus === BATCH_STATUSES.COMPLETED && currentBatch?.roasted_weight_out == null
      ? calculateRoastedWeight(currentBatch.green_weight_in, currentBatch.target_roast_degree)
      : null;
    const finalRoastedWeight = requestedWeightOut ?? calculatedRoastedWeight;
    await conn.query(
      `UPDATE batches SET end_time=NOW(), roasted_weight_out=COALESCE(?, roasted_weight_out), status=? WHERE id_batches=?`,
      [finalRoastedWeight, finalStatus, normalizedBatchId]
    );
    await conn.query(
      `INSERT INTO process_state (id, is_running, active_batch_id) VALUES (1, 0, NULL)
       ON DUPLICATE KEY UPDATE is_running=0, active_batch_id=NULL`
    );
    const batchNumber = currentBatch?.batch_number || null;
    await conn.commit();
    try {
      await logEvent(conn, {
        eventType: EVENT_TYPES.BATCH_STOP,
        userId,
        batchId: normalizedBatchId,
        description: `Партия ${batchNumber || '—'} остановлена`
      });
    } catch (logErr) { console.error('[LOG_ERROR]', logErr); }
    stopSimulation();
    broadcast({ type: WS_EVENTS.BATCH_STOPPED, payload: { batch_id: normalizedBatchId, batch_number: batchNumber, status: finalStatus } });
    return { ok: true, batch_id: normalizedBatchId, batch_number: batchNumber, status: finalStatus };
  } catch (err) { await safeRollback(conn, 'BATCH_STOP'); throw err; } finally { conn.release(); }
}

app.post('/api/batches/stop', async (req, res) => {
  // Only operator may stop batches
  if (req.user?.role !== ROLES.OPERATOR) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  try {
    const [[state]] = await pool.query(`SELECT active_batch_id FROM process_state WHERE id=1 LIMIT 1`);
    if (!state?.active_batch_id) return res.status(409).json({ ok: false, error: 'NO_ACTIVE_BATCH' });
    const result = await stopBatch({
      batchId: state.active_batch_id,
      roastedWeightOut: req.body?.roasted_weight_out ?? null,
      status: req.body?.status || BATCH_STATUSES.COMPLETED,
      userId: req.user?.id || 1,
    });
    res.json(result);
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    if (err.message === 'BAD_BATCH_ID') return badRequest(res, 'BAD_BATCH_ID', 'Некорректный id партии');
    handleDbError(res, err);
  }
});

app.get('/api/alarms', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.id_error AS id, e.id_parameters AS parameter_id,
              p.name AS parameter_name, p.unit AS parameter_unit,
              e.severity,
              CASE
                WHEN e.is_acknowledged=1 AND e.acknowledged_by IS NULL THEN 'cleared'
                WHEN e.is_acknowledged=1 THEN 'ack'
                ELSE 'active'
              END AS status,
              e.actual_value AS value, e.expected_value AS setpoint,
              e.description, e.id_batches AS batch_id,
              e.timestamp AS created_at, e.acknowledged_at,
              e.acknowledged_by, u.user_name AS acknowledged_by_name
       FROM errors_log e
       LEFT JOIN parameters p ON p.id_parameters=e.id_parameters
       LEFT JOIN users u ON u.id_user=e.acknowledged_by
       ORDER BY e.timestamp DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

app.post('/api/alarms/:id/ack', async (req, res) => {
  const alarmId = toPositiveInt(req.params.id);
  if (!alarmId) return badRequest(res, 'BAD_ALARM_ID', 'Некорректный id тревоги');
  const userId = req.user?.id || 1;
  try {
    const acknowledgedAt = new Date().toISOString();
    await pool.query(
      `UPDATE errors_log SET is_acknowledged=1, acknowledged_by=?, acknowledged_at=NOW() WHERE id_error=?`,
      [userId, alarmId]
    );
    const [[user]] = await pool.query(
      `SELECT user_name AS acknowledged_by_name FROM users WHERE id_user=? LIMIT 1`,
      [userId]
    );
    const acknowledgedByName = user?.acknowledged_by_name || req.user?.name || null;
    broadcast({
      type: WS_EVENTS.ALARM_ACK,
      payload: {
        id: alarmId,
        acknowledged_at: acknowledgedAt,
        acknowledged_by: userId,
        acknowledged_by_name: acknowledgedByName,
      },
    });
    res.json({
      ok: true,
      id: alarmId,
      acknowledged_at: acknowledgedAt,
      acknowledged_by: userId,
      acknowledged_by_name: acknowledgedByName,
    });
  } catch (err) { handleDbError(res, err); }
});

// Ручная коррекция — ТОЛЬКО для управляющих параметров (5 = мощность нагрева, 6 = скорость воздуха)
app.post('/api/parameters/:id/override', async (req, res) => {
  const parameterId = toPositiveInt(req.params.id);
  const { value, batchId } = req.body || {};

  if (!CONTROL_PARAMETER_IDS.includes(parameterId)) {
    return res.status(400).json({
      ok: false,
      error: 'ONLY_CONTROL_PARAMETERS',
      message: 'Ручная коррекция допустима только для параметров 5 (мощность нагрева) и 6 (скорость воздуха)',
    });
  }

  // Роль: только operator может вызывать ручную коррекцию
  if (req.user?.role !== ROLES.OPERATOR) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Only operator can perform manual overrides' });
  }

  const normalizedBatchId = toPositiveInt(batchId);
  const val = toFiniteNumber(value);
  if (!normalizedBatchId) return res.status(400).json({ ok: false, error: 'NO_BATCH' });
  if (val == null) return res.status(400).json({ ok: false, error: 'BAD_VALUE' });
  if (Number(simState.activeBatchId) !== Number(normalizedBatchId)) {
    return res.status(409).json({ ok: false, error: 'NO_ACTIVE_BATCH' });
  }

  const prev = simState.currentValues.get(parameterId) ?? null;

  // Запоминаем override — tickSimulation применит его на следующем тике.
  // Значение НЕ записывается в measured_values здесь — оно попадёт туда через тик.
  simState.manualOverrides.set(parameterId, { value: val, setAt: Date.now() });

  try {
    const logConn = await pool.getConnection();
    await logControlAction(logConn, {
      userId: req.user?.id || null,
      batchId: normalizedBatchId,
      parameterId,
      oldValue: prev,
      newValue: val,
      unit: simState.parameterMeta.get(parameterId)?.unit || '',
      description: `Изменение параметра ${simState.parameterMeta.get(parameterId)?.name || parameterId}: ${prev} → ${val}`
    });
    logConn.release();
  } catch (logErr) { console.error('[LOG_ERROR]', logErr); }

  broadcast({
    type: WS_EVENTS.MANUAL_OVERRIDE,
    payload: { batch_id: normalizedBatchId, parameter_id: parameterId, value: val, old_value: prev, expires_in_sec: MANUAL_OVERRIDE_TTL_MS / 1000 },
  });
  res.json({ ok: true, parameter_id: parameterId, value: val, expires_in_sec: MANUAL_OVERRIDE_TTL_MS / 1000 });
});

// Досрочный сброс ручной коррекции — управление возвращается рецепту
app.delete('/api/parameters/:id/override', async (req, res) => {
  if (req.user?.role !== ROLES.OPERATOR) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Only operator can clear manual overrides' });
  }

  const parameterId = toPositiveInt(req.params.id);
  if (!CONTROL_PARAMETER_IDS.includes(parameterId)) return badRequest(res, 'ONLY_CONTROL_PARAMETERS', 'Некорректный управляющий параметр');

  const prevOverride = simState.manualOverrides.get(parameterId) || null;
  const prev = prevOverride?.value ?? simState.currentValues.get(parameterId) ?? null;
  const setpoint = simState.autoCtrl[parameterId === PARAMETER_IDS.HEAT_POWER ? 'P_heat' : 'V_air'] ?? null;
  simState.manualOverrides.delete(parameterId);

  try {
    const logConn = await pool.getConnection();
    try {
      await logControlAction(logConn, {
        userId: req.user?.id || null,
        batchId: simState.activeBatchId || null,
        parameterId,
        oldValue: prev,
        newValue: setpoint,
        unit: simState.parameterMeta.get(parameterId)?.unit || '',
        description: 'Сброс ручной коррекции параметра',
      });
    } finally {
      logConn.release();
    }
  } catch (logErr) { console.error('[LOG_ERROR]', logErr); }

  broadcast({
    type: WS_EVENTS.MANUAL_OVERRIDE_CLEAR,
    payload: {
      batch_id: simState.activeBatchId || null,
      parameter_id: parameterId,
      value: setpoint,
    },
  });

  res.json({ ok: true, parameter_id: parameterId });
});

// Запуск сценария отклонения для демонстрации работы тревог
app.post('/api/simulation/deviation', async (req, res) => {
  // Only operator may trigger simulation deviation
  if (req.user?.role !== ROLES.OPERATOR) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  if (!simState.activeBatchId) {
    return res.status(409).json({ ok: false, error: 'NO_ACTIVE_BATCH' });
  }
  const { type, value = 10, durationSec = 30 } = req.body || {};
  const deviationValue = toFiniteNumber(value);
  const deviationDurationSec = toPositiveInt(durationSec);
  if (!DEVIATION_SCENARIOS.includes(type)) {
    return res.status(400).json({ ok: false, error: 'BAD_SCENARIO_TYPE' });
  }
  if (deviationValue == null || !deviationDurationSec) {
    return res.status(400).json({ ok: false, error: 'BAD_SCENARIO_VALUE' });
  }
  simState.deviationScenario = {
    type,
    value: deviationValue,
    startedAt: Date.now(),
    endsAt: Date.now() + deviationDurationSec * 1000,
  };

  try {
    const logConn = await pool.getConnection();
    await logEvent(logConn, {
      eventType: EVENT_TYPES.SIMULATION_DEVIATION,
      userId: req.user?.id || null,
      batchId: simState.activeBatchId,
      description: `Запущен сценарий отклонения: ${type}`
    });
    logConn.release();
  } catch (logErr) { console.error('[LOG_ERROR]', logErr); }

  broadcast({ type: WS_EVENTS.SIMULATION_DEVIATION, payload: simState.deviationScenario });
  res.json({ ok: true, scenario: simState.deviationScenario });
});

app.get('/api/batches/:id/report', async (req, res) => {
  const batchId = toPositiveInt(req.params.id);
  if (!batchId) return badRequest(res, 'BAD_BATCH_ID', 'Некорректный id партии');
  try {
    const [[batch]] = await pool.query(
      `SELECT b.id_batches AS id, b.batch_number, b.green_weight_in,
              b.roasted_weight_out, b.coffee_variety, b.target_roast_degree,
              CASE WHEN b.roasted_weight_out IS NOT NULL THEN b.green_weight_in - b.roasted_weight_out ELSE NULL END AS loss_kg,
              CASE WHEN b.roasted_weight_out IS NOT NULL AND b.green_weight_in > 0
                   THEN ((b.green_weight_in - b.roasted_weight_out) / b.green_weight_in) * 100
                   ELSE NULL END AS loss_percent,
              b.start_time, b.end_time, b.status,
              r.recipe_name AS recipe, u.user_name AS operator
       FROM batches b
       LEFT JOIN recipes r ON r.id_recipe=b.id_recipe
       LEFT JOIN users u ON u.id_user=b.id_user
       WHERE b.id_batches=? LIMIT 1`,
      [batchId]
    );
    if (!batch) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    const [stats] = await pool.query(
      `SELECT m.id_parameters AS parameter_id, p.name AS parameter_name, p.unit AS parameter_unit,
              MIN(m.value) AS min_value, MAX(m.value) AS max_value,
              AVG(m.value) AS avg_value, COUNT(*) AS points
       FROM measured_values m
       LEFT JOIN parameters p ON p.id_parameters=m.id_parameters
       WHERE m.id_batches=? GROUP BY m.id_parameters, p.name, p.unit ORDER BY m.id_parameters`,
      [batchId]
    );
    const [alarms] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN is_acknowledged=1 THEN 1 ELSE 0 END) AS acknowledged
       FROM errors_log WHERE id_batches=?`,
      [batchId]
    );
    res.json({ ok: true, batch, statistics: stats, alarms: alarms[0] || { total: 0, acknowledged: 0 } });
  } catch (err) { handleDbError(res, err); }
});

// ─── ЖУРНАЛЫ ─────────────────────────────────────────────────────────────────
app.get('/api/logs/events', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.*, u.user_name, u.role AS user_role, b.batch_number
       FROM system_events_log l
       LEFT JOIN users u ON u.id_user = l.id_user
       LEFT JOIN batches b ON b.id_batches = l.id_batches
       ORDER BY l.created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

app.get('/api/logs/control', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.*,
              u.user_name,
              b.batch_number,
              l.id_batches AS batch_id,
              p.name AS parameter_name,
              p.unit AS parameter_unit,
              l.old_value AS before_value,
              l.new_value AS after_value
       FROM control_actions_log l
       LEFT JOIN users u ON u.id_user = l.id_user
       LEFT JOIN batches b ON b.id_batches = l.id_batches
       LEFT JOIN parameters p ON p.id_parameters = l.id_parameters
       ORDER BY l.created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));

// ─── WEBSOCKET + СЕРВЕР ───────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', async (ws) => {
  safeSend(ws, { type: WS_EVENTS.HELLO, payload: { ok: true, now: new Date().toISOString() } });
  try {
    const [[state]] = await pool.query(`SELECT is_running, active_batch_id FROM process_state WHERE id=1 LIMIT 1`);
    safeSend(ws, { type: WS_EVENTS.PROCESS_STATE, payload: state || { is_running: false, active_batch_id: null } });
  } catch (err) { console.error(err); }
});

async function bootstrapRunningBatch() {
  const [[state]] = await pool.query(`SELECT active_batch_id FROM process_state WHERE id=1 LIMIT 1`);
  if (state?.active_batch_id) {
    console.log('[BOOTSTRAP] Restoring active batch', state.active_batch_id);
    await startSimulation(state.active_batch_id);
  }
}

server.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);
  try { await bootstrapRunningBatch(); } catch (err) { console.error(err); }
});

