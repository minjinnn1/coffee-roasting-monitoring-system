const ROLES = Object.freeze({
  OPERATOR: 'operator',
  TECHNOLOGIST: 'technologist',
});

const PARAMETER_IDS = Object.freeze({
  INLET_AIR_TEMP: 1,
  EXHAUST_AIR_TEMP: 2,
  BEAN_TEMP: 3,
  ROR: 4,
  HEAT_POWER: 5,
  AIR_FLOW: 6,
});

const ALL_PROCESS_PARAMETER_IDS = Object.freeze(Object.values(PARAMETER_IDS));
const ALARM_PARAMETER_IDS = Object.freeze([
  PARAMETER_IDS.INLET_AIR_TEMP,
  PARAMETER_IDS.EXHAUST_AIR_TEMP,
  PARAMETER_IDS.BEAN_TEMP,
  PARAMETER_IDS.ROR,
]);
const CONTROL_PARAMETER_IDS = Object.freeze([
  PARAMETER_IDS.HEAT_POWER,
  PARAMETER_IDS.AIR_FLOW,
]);

const BATCH_STATUSES = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ABORTED: 'aborted',
});

const EVENT_TYPES = Object.freeze({
  LOGIN: 'login',
  RECIPE_CREATE: 'recipe_create',
  RECIPE_UPDATE: 'recipe_update',
  RECIPE_DEACTIVATE: 'recipe_deactivate',
  BATCH_START: 'batch_start',
  BATCH_STOP: 'batch_stop',
  SIMULATION_DEVIATION: 'simulation_deviation',
});

const WS_EVENTS = Object.freeze({
  HELLO: 'hello',
  PROCESS_STATE: 'process-state',
  MEASUREMENTS: 'measurements',
  BATCH_STARTED: 'batch:started',
  BATCH_STOPPED: 'batch:stopped',
  ALARM_NEW: 'alarm:new',
  ALARM_ACK: 'alarm:ack',
  ALARM_CLEAR: 'alarm:clear',
  MANUAL_OVERRIDE: 'manual:override',
  MANUAL_OVERRIDE_CLEAR: 'manual:override:clear',
  SIMULATION_DEVIATION: 'simulation:deviation',
});

const DEVIATION_SCENARIOS = Object.freeze([
  'grain_overheat',
  'grain_underheat',
  'air_overheat',
  'airflow_problem',
  'ror_drop',
  'ror_spike',
]);

const MANUAL_OVERRIDE_TTL_MS = 60_000;

module.exports = {
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
};
