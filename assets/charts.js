//Классификация значений параметров
function getParamRule(param) {
  const id   = String(param.id || '').toLowerCase();
  const name = normalizeLabel(param.name);
  const match = (...tokens) => tokens.some((t) => id === t || name.includes(t));
  if (match('1', 'вход', 'inlet'))              return { kind: 'band',    ok: 7,  alarm: 12 };
  if (match('2', 'выход', 'out', 'exhaust', 'дым')) return { kind: 'band', ok: 10, alarm: 18 };
  if (match('3', 'зерн', 'bean'))               return { kind: 'band',    ok: 6,  alarm: 10 };
  if (match('4', 'ror', 'рост'))                return { kind: 'range', okMin: 6, okMax: 18, alarmMin: 4, alarmMax: 22 };
  if (match('5', 'power', 'нагрев', 'heater'))  return { kind: 'percent', ok: 0.15, alarm: 0.25 };
  if (match('6', 'flow', 'возду', 'air'))       return { kind: 'percent', ok: 0.15, alarm: 0.25 };
  return null;
}

function classifyValue(param, val) {
  const rule = getParamRule(param);
  const sp   = getSetpoint(param.id);
  if (!rule) {
    if (val < param.alarmLow || val > param.alarmHigh) return { status: 'alarm', severity: 'Critical', setpoint: sp, deviation: val - sp };
    if (val < param.warnLow  || val > param.warnHigh)  return { status: 'warn',  severity: 'Warning',  setpoint: sp, deviation: val - sp };
    return { status: 'ok', severity: null, setpoint: sp, deviation: val - sp };
  }
  if (rule.kind === 'band') {
    const diff = Math.abs(val - sp);
    if (diff > rule.alarm) return { status: 'alarm', severity: 'Critical', setpoint: sp, deviation: val - sp };
    if (diff > rule.ok)    return { status: 'warn',  severity: 'Warning',  setpoint: sp, deviation: val - sp };
    return { status: 'ok', severity: null, setpoint: sp, deviation: val - sp };
  }
  if (rule.kind === 'percent') {
    const base    = Math.max(Math.abs(sp), 1);
    const diffPct = Math.abs(val - sp) / base;
    if (diffPct > rule.alarm) return { status: 'alarm', severity: 'Critical', setpoint: sp, deviation: val - sp };
    if (diffPct > rule.ok)    return { status: 'warn',  severity: 'Warning',  setpoint: sp, deviation: val - sp };
    return { status: 'ok', severity: null, setpoint: sp, deviation: val - sp };
  }
  if (rule.kind === 'range') {
    const center = (rule.okMin + rule.okMax) / 2;
    if (val < rule.alarmMin || val > rule.alarmMax) return { status: 'alarm', severity: 'Critical', setpoint: center, deviation: val - center };
    if (val < rule.okMin    || val > rule.okMax)    return { status: 'warn',  severity: 'Warning',  setpoint: center, deviation: val - center };
    return { status: 'ok', severity: null, setpoint: center, deviation: val - center };
  }
  return { status: 'ok', severity: null, setpoint: sp, deviation: val - sp };
}

function statusClass(val, param) {
  const tol = (Data.tolerances && Data.tolerances[param.id] != null)
    ? Number(Data.tolerances[param.id]) : null;
  const sp = (Data.currentSetpoints && Data.currentSetpoints[param.id] != null)
    ? Number(Data.currentSetpoints[param.id]) : getSetpoint(param.id);
  if (tol != null) {
    const diff = Math.abs(val - sp);
    if (diff <= tol)     return 'ok';
    if (diff <= tol * 1.5) return 'warn';
    return 'alarm';
  }
  return classifyValue(param, val).status;
}

//Тревоги (вычисляются локально)
function evaluateAlarm(p, val, time) {
  const cls      = classifyValue(p, val);
  const severity = cls.status === 'alarm' ? 'Critical' : cls.status === 'warn' ? 'Warning' : null;
  const batchId = Data.batch ? Data.batch.id : null;
  const activeForParam = Data.alarms.filter((a) => (
    a.paramId === p.id &&
    a.status !== 'cleared' &&
    (batchId == null || Number(a.batchId) === Number(batchId))
  ));
  const existing = activeForParam[0] || null;
  if (severity) {
    if (existing && existing.severity === severity) {
      existing.value    = val;
      existing.severity = severity;
      existing.time     = time;
      existing.deviation = cls.deviation;
      existing.setpoint  = cls.setpoint;
    } else {
      Data.alarms.unshift({
        id: Data.alarmId++,
        paramId:   p.id,
        paramName: p.name,
        value: val,
        setpoint: cls.setpoint,
	        deviation: cls.deviation,
	        severity,
	        status: 'active',
	        time,
	        batchId,
	      });
	    }
  } else if (activeForParam.length) {
    activeForParam.forEach((alarm) => {
      alarm.status    = 'cleared';
      alarm.clearTime = time;
    });
  }
}

function evaluateAllParameters() {
  const now = Date.now();
  Data.parameters.forEach((p) => {
    const history = Data.histories[p.id] || [];
    const last    = history[history.length - 1];
    const val     = last ? last.v : Data.current[p.id] ?? getSetpoint(p.id);
    const t       = last ? last.t : now;
    Data.current[p.id] = val;
    evaluateAlarm(p, val, t);
  });
  renderAlarms($('#alarmsList'), $('#alarmsSummary'));
}

//Вспомогательные функции данных графиков
function normalizeLabel(str) {
  return (str || '').toString().toLowerCase();
}

const chartParamHints = {
  inletAir:   { ids: ['temp_in','air_in','t_in'],           keywords: ['вх','вход','подач','inlet','supply'] },
  exhaustAir: { ids: ['temp_out','air_out','exhaust_temp','t_out'], keywords: ['вых','выход','exhaust','дым','stack'] },
  beanTemp:   { ids: ['bean_temp','t_bean','temp_bean'],    keywords: ['зерн','bean','product'] },
  ror:        { ids: ['4','ror','rate_of_rise'],             keywords: ['ror','рост температуры','rate of rise'] },
  heatPower:  { ids: ['power','heat_power','heater_power','burner_power'], keywords: ['мощ','power','нагрев','heater','burner','газ'] },
};

function resolveParamByHint(hint) {
  if (!hint) return null;
  const ids      = (hint.ids      || []).map(normalizeLabel);
  const keywords = (hint.keywords || []).map(normalizeLabel);
  return (
    Data.parameters.find((p) => ids.includes(normalizeLabel(p.id))) ||
    Data.parameters.find((p) => {
      const name = normalizeLabel(p.name);
      const id   = normalizeLabel(p.id);
      return keywords.some((k) => name.includes(k) || id.includes(k));
    }) || null
  );
}

function limitHistory(id, max = 240) {
  return (Data.histories[id] || []).slice(-max);
}

function clampRorData(data, maxAbs = 200) {
  const clean = (data || []).filter((p) => Number.isFinite(p.v) && Math.abs(p.v) <= maxAbs);
  return clean.length ? clean : data || [];
}

function medianSmooth(data, window = 3) {
  if (!data || data.length === 0 || window < 3) return data || [];
  const half = Math.floor(window / 2);
  return data.map((pt, idx) => {
    const slice  = data.slice(Math.max(0, idx - half), Math.min(data.length, idx + half + 1));
    const median = slice.map((x) => x.v).sort((a, b) => a - b)[Math.floor(slice.length / 2)];
    return { ...pt, v: median };
  });
}

function buildTempSeries() {
  const bean  = resolveParamByHint(chartParamHints.beanTemp);
  const inlet = resolveParamByHint(chartParamHints.inletAir);
  const exh   = resolveParamByHint(chartParamHints.exhaustAir);
  const series = [];
  if (bean)  series.push({ id: bean.id,  name: bean.name  || PARAM_CHART_META.beanTemp.name,   color: PARAM_CHART_META.beanTemp.color, backgroundColor: PARAM_CHART_META.beanTemp.backgroundColor, data: limitHistory(bean.id),  style: PARAM_CHART_META.beanTemp });
  if (inlet) series.push({ id: inlet.id, name: inlet.name || PARAM_CHART_META.inletAir.name,   color: PARAM_CHART_META.inletAir.color, backgroundColor: PARAM_CHART_META.inletAir.backgroundColor, data: limitHistory(inlet.id), style: PARAM_CHART_META.inletAir });
  if (exh)   series.push({ id: exh.id,   name: exh.name   || PARAM_CHART_META.exhaustAir.name, color: PARAM_CHART_META.exhaustAir.color, backgroundColor: PARAM_CHART_META.exhaustAir.backgroundColor, data: limitHistory(exh.id), style: PARAM_CHART_META.exhaustAir });
  return series;
}

function buildRorSeries() {
  const rorParam = resolveParamByHint(chartParamHints.ror);
  if (rorParam) {
    const data = medianSmooth(clampRorData(limitHistory(rorParam.id)));
    if (!data.length) return [];
    return [{ id: rorParam.id, name: rorParam.name || PARAM_CHART_META.ror.name, color: PARAM_CHART_META.ror.color, backgroundColor: PARAM_CHART_META.ror.backgroundColor, data, style: PARAM_CHART_META.ror }];
  }
  const bean = resolveParamByHint(chartParamHints.beanTemp);
  if (!bean) return [];
  const source  = limitHistory(bean.id);
  const derived = [];
  for (let i = 1; i < source.length; i++) {
    const prev  = source[i - 1];
    const cur   = source[i];
    const dtMin = (cur.t - prev.t) / 60000;
    if (!dtMin || dtMin <= 0) continue;
    derived.push({ t: cur.t, v: (cur.v - prev.v) / dtMin });
  }
  const data = medianSmooth(clampRorData(derived));
  return data.length ? [{ id: 'ror-derived', name: 'Рост темп. зерна (расч.)', color: PARAM_CHART_META.ror.color, backgroundColor: PARAM_CHART_META.ror.backgroundColor, data, style: PARAM_CHART_META.ror }] : [];
}

function buildPowerSeries() {
  const power = resolveParamByHint(chartParamHints.heatPower);
  if (!power) return [];
  return [{ id: power.id, name: power.name || PARAM_CHART_META.heatPower.name, color: PARAM_CHART_META.heatPower.color, backgroundColor: PARAM_CHART_META.heatPower.backgroundColor, data: limitHistory(power.id), style: PARAM_CHART_META.heatPower }];
}

const chartGroups = [
  { canvasId: 'chartTemps', legendId: 'legendTemps', builder: buildTempSeries,  placeholder: 'Нет данных по температурам воздуха/зерна' },
  { canvasId: 'chartRor',   legendId: 'legendRor',   builder: buildRorSeries,   placeholder: 'Нет данных для расчета скорости роста' },
];

//Легенда
const _legendCache = {};
function renderLegend(targetId, series) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const key = series.map((s) => `${s.id}:${s.color}`).join(',');
  if (_legendCache[targetId] === key) return;
  _legendCache[targetId] = key;
  target.innerHTML = '';
  if (!series.length) {
    const span = document.createElement('span');
    span.className   = 'legend-empty';
    span.textContent = 'Нет подходящих параметров';
    target.appendChild(span);
    return;
  }
  series.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'item';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = s.color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(s.name || 'Параметр'));
    target.appendChild(item);
  });
}

function drawSmoothedPath(ctx, points, tension) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  if (!tension || points.length < 3) {
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 6;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 6;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 6;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

//Отрисовка графика
function drawSeriesChart(canvasId, series, placeholder) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  series = Array.isArray(series) ? series.filter(Boolean) : [];
  const ctx     = canvas.getContext('2d');
  const width   = canvas.width;
  const height  = canvas.height;
  const padding = { left: 58, right: 10, top: 10, bottom: 30 };
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(10,16,24,0.85)';
  ctx.fillRect(0, 0, width, height);

  const allPoints = series.flatMap((s) => s.data || []);
  if (!allPoints.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px "DM Mono", monospace';
    ctx.fillText(placeholder || 'Нет данных', padding.left + 12, height / 2);
    return;
  }

  const values   = allPoints.map((d) => d.v);
  const times    = allPoints.map((d) => d.t);
  const yScale   = getChartYAxisScale(values);
  const { minVal, maxVal, spanVal, ticks } = yScale;
  const minTime  = Math.min(...times);
  let maxTime    = Math.max(...times);
  if (maxTime === minTime) maxTime = minTime + 1;
  const spanTime  = maxTime - minTime || 1;
  const plotWidth = width  - padding.left - padding.right;
  const plotHeight= height - padding.top  - padding.bottom;

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 1;
  ctx.font        = '11px "DM Mono", monospace';
  ctx.fillStyle   = 'rgba(255,255,255,0.7)';

  ticks.slice().reverse().forEach((val) => {
    const y = padding.top + (plotHeight - ((val - minVal) / spanVal) * plotHeight);
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(Number.isInteger(val) ? String(val) : val.toFixed(1), padding.left - 6, y);
  });

  const formatTime = (ts) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };
  for (let i = 0; i <= 4; i++) {
    const x  = padding.left + (plotWidth / 4) * i;
    const ts = minTime + (spanTime * i) / 4;
    ctx.beginPath(); ctx.moveTo(x, padding.top); ctx.lineTo(x, height - padding.bottom); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(formatTime(ts), x, height - padding.bottom + 4);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  //Полосы этапов обжарки
  if (Data.stages && Data.stages.length && Data.batchStartTime) {
    Data.stages.forEach((stage) => {
      const meta = getStageMeta(stage.stage_code) || {};
      const stageStartMs = Data.batchStartTime + stage.start_time_sec * 1000;
      const stageEndMs   = Data.batchStartTime + stage.end_time_sec   * 1000;
      if (stageEndMs < minTime || stageStartMs > maxTime) return;
      const xStart = padding.left + ((Math.max(stageStartMs, minTime) - minTime) / spanTime) * plotWidth;
      const xEnd   = padding.left + ((Math.min(stageEndMs,   maxTime) - minTime) / spanTime) * plotWidth;
      ctx.fillStyle = meta.bg || 'rgba(255,255,255,0.05)';
      ctx.fillRect(xStart, padding.top, xEnd - xStart, plotHeight);
      ctx.strokeStyle = meta.border || 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(xStart, padding.top); ctx.lineTo(xStart, height - padding.bottom); ctx.stroke();
      ctx.setLineDash([]);
      if (xEnd - xStart > 30) {
        ctx.font = '10px "DM Mono", monospace';
        ctx.fillStyle = meta.color || 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(meta.label || stage.stage_name || stage.stage_code, xStart + 4, padding.top + 3);
      }
    });
  }

  series.forEach((s) => {
    const data = (s.data || []).slice().sort((a, b) => a.t - b.t);
    if (!data.length) return;
    const style = s.style || PARAM_CHART_STYLE;
    const points = data.map((pt) => ({
      x: padding.left + ((pt.t - minTime) / spanTime) * plotWidth,
      y: padding.top + (plotHeight - ((pt.v - minVal) / spanVal) * plotHeight),
    }));
    ctx.strokeStyle = s.color;
    ctx.lineWidth   = style.borderWidth || 3;
    ctx.setLineDash([]);
    drawSmoothedPath(ctx, points, style.tension ?? 0.3);
    ctx.stroke();

    ctx.fillStyle = s.color;
    points.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, style.pointRadius || 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

//Публичные функции 
function clearChartData() {
  Data.histories       = {};
  Data.current         = {};
  Data.tolerances      = {};
  Data.currentSetpoints= {};
  Data.stages          = [];
  Data.batchStartTime  = null;
  Data.parameters.forEach((p) => { Data.histories[p.id] = []; Data.current[p.id] = null; });
  drawCharts();
}

function drawCharts() {
  chartGroups.forEach((group) => {
    const series = group.builder();
    renderLegend(group.legendId, series);
    drawSeriesChart(group.canvasId, series, group.placeholder);
  });
}
