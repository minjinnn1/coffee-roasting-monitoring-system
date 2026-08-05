// page-recipes.js — страница рецептов

const STAGE_LABELS = Object.fromEntries(
  Object.entries(STAGE_META).map(([code, meta]) => [code, meta.label])
);

const STAGE_OPTIONS = Object.entries(STAGE_META).map(([code, meta]) => ({ code, label: meta.label }));

const DEGREE_LABELS = {
  light: 'Светлая',
  medium: 'Средняя',
  dark: 'Тёмная',
};

const PARAM_LABELS = {
  1: ['T входящего воздуха', '°C'],
  2: ['T выходящего воздуха', '°C'],
  3: ['T зерна', '°C'],
  4: ['RoR', '°C/мин'],
  5: ['Мощность нагрева', 'кВт'],
  6: ['Скорость воздуха', 'м/с'],
};

function fmtTime(sec) {
  if (!sec) return '0 мин';
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${min} мин` : `${min}:${String(s).padStart(2, '0')}`;
}

function emptyRow(text) {
  return `<tr><td colspan="3" style="color:var(--muted);text-align:center;">${text}</td></tr>`;
}
const RECIPE_PARAM_CONFIG = {
  1: { name: PARAM_CHART_META.inletAir.name, unit: '°C', color: PARAM_CHART_META.inletAir.color, style: PARAM_CHART_META.inletAir },
  2: { name: PARAM_CHART_META.exhaustAir.name, unit: '°C', color: PARAM_CHART_META.exhaustAir.color, style: PARAM_CHART_META.exhaustAir },
  3: { name: PARAM_CHART_META.beanTemp.name, unit: '°C', color: PARAM_CHART_META.beanTemp.color, style: PARAM_CHART_META.beanTemp },
  4: { name: PARAM_CHART_META.ror.name, unit: '°C/мин', color: PARAM_CHART_META.ror.color, style: PARAM_CHART_META.ror },
  5: { name: PARAM_CHART_META.heatPower.name, unit: 'кВт', color: PARAM_CHART_META.heatPower.color, style: PARAM_CHART_META.heatPower },
  6: { name: PARAM_CHART_META.airFlow.name, unit: 'м/с', color: PARAM_CHART_META.airFlow.color, style: PARAM_CHART_META.airFlow },
};

const RECIPE_TEMP_PARAMS = [3, 1, 2];
const RECIPE_CONTROL_PARAMS = [4, 5, 6];
const RECIPE_PARAM_ORDER = [3, 1, 2, 4, 5, 6];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtClock(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const min = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const min = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  if (safe < 60) return `${safe} сек`;
  if (s === 0) return `${min} мин`;
  return `${min} мин ${s} сек`;
}

function getStageTitle(stage) {
  if (!stage) return '-';
  return STAGE_LABELS[stage.stage_code] || stage.stage_name || '-';
}

function getStageForSetpoint(sp, stages) {
  const stageId = sp.id_stage ?? sp.stage_id ?? sp.recipe_stage_id;
  if (stageId != null) {
    const byId = stages.find((stage) => String(stage.id_stage ?? stage.stage_id ?? stage.id) === String(stageId));
    if (byId) return byId;
  }

  const time = Number(sp.time_offset_sec ?? 0);
  return stages.find((stage) => {
    const start = Number(stage.start_time_sec ?? 0);
    const end = Number(stage.end_time_sec ?? 0);
    return time >= start && time <= end;
  }) || null;
}

function getRecipeTotalDuration(recipe) {
  const total = Number(recipe?.total_duration_sec || 0);
  if (total > 0) return total;
  const stageEnd = Math.max(0, ...(recipe?.stages || []).map((stage) => Number(stage.end_time_sec || 0)));
  const spEnd = Math.max(0, ...(recipe?.setpoints || []).map((sp) => Number(sp.time_offset_sec || 0)));
  return Math.max(stageEnd, spEnd, 1);
}

function buildRecipeSeries(recipe, paramIds) {
  return paramIds.map((paramId) => {
    const cfg = RECIPE_PARAM_CONFIG[paramId];
    const data = (recipe.setpoints || [])
      .filter((sp) => Number(sp.parameter_id) === paramId)
      .map((sp) => ({ t: Number(sp.time_offset_sec || 0), v: Number(sp.target_value || 0) }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
      .sort((a, b) => a.t - b.t);
    return { id: paramId, name: cfg.name, unit: cfg.unit, color: cfg.color, backgroundColor: cfg.style.backgroundColor, style: cfg.style, data };
  }).filter((series) => series.data.length);
}

function renderRecipeLegend(legendId, series) {
  const legend = document.getElementById(legendId);
  if (!legend) return;
  if (!series.length) {
    legend.innerHTML = '<span class="legend-empty">Нет данных</span>';
    return;
  }
  legend.innerHTML = series.map((item) => `
    <span class="item"><span class="dot" style="background:${item.color}"></span>${escapeHtml(item.name)}</span>
  `).join('');
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

function drawRecipeProfileChart(canvasId, series, stages, totalDuration, placeholder) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const padding = { left: 58, right: 16, top: 34, bottom: 32 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(10,16,24,0.85)';
  ctx.fillRect(0, 0, width, height);

  const maxTime = Math.max(1, Number(totalDuration || 0));
  const xOf = (sec) => padding.left + (Math.max(0, Math.min(maxTime, sec)) / maxTime) * plotWidth;

  (stages || []).forEach((stage) => {
    const meta = getStageMeta(stage.stage_code) || {};
    const start = Number(stage.start_time_sec || 0);
    const end = Number(stage.end_time_sec || 0);
    if (end < 0 || start > maxTime) return;
    const xStart = xOf(start);
    const xEnd = xOf(end);
    const widthPx = Math.max(1, xEnd - xStart);
    ctx.fillStyle = meta.bg || 'rgba(255,255,255,0.05)';
    ctx.fillRect(xStart, padding.top, widthPx, plotHeight);
    ctx.strokeStyle = meta.border || 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xStart, padding.top);
    ctx.lineTo(xStart, height - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    if (widthPx > 82) {
      ctx.font = '11px "Space Grotesk", sans-serif';
      ctx.fillStyle = meta.color || 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(meta.label || getStageTitle(stage), xStart + 6, 9);
    }
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.font = '11px "Space Grotesk", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.70)';

  const allPoints = series.flatMap((item) => item.data || []);
  if (!allPoints.length) {
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (plotWidth / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(fmtClock((maxTime / 4) * i), x, height - padding.bottom + 6);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(placeholder || 'Нет данных', padding.left + 12, padding.top + plotHeight / 2);
    return;
  }

  const values = allPoints.map((point) => point.v);
  const yScale = getChartYAxisScale(values);
  const { minVal, maxVal, spanVal, ticks } = yScale;
  const yOf = (value) => padding.top + plotHeight - ((value - minVal) / spanVal) * plotHeight;

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ticks.slice().reverse().forEach((val) => {
    const y = yOf(val);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Number.isInteger(val) ? String(val) : val.toFixed(1), padding.left - 8, y);
  });

  for (let i = 0; i <= 4; i++) {
    const x = padding.left + (plotWidth / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtClock((maxTime / 4) * i), x, height - padding.bottom + 6);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  series.forEach((item) => {
    const data = item.data || [];
    if (!data.length) return;
    const style = item.style || PARAM_CHART_STYLE;
    const points = data.map((point) => ({
      x: xOf(point.t),
      y: yOf(point.v),
    }));
    ctx.strokeStyle = item.color;
    ctx.lineWidth = style.borderWidth || 3;
    ctx.setLineDash([]);
    drawSmoothedPath(ctx, points, style.tension ?? 0.3);
    ctx.stroke();

    points.forEach((point) => {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, style.pointRadius || 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function renderRecipeProfiles(recipe) {
  const stages = recipe?.stages || [];
  const totalDuration = getRecipeTotalDuration(recipe);
  const tempSeries = buildRecipeSeries(recipe, RECIPE_TEMP_PARAMS);
  const controlSeries = buildRecipeSeries(recipe, RECIPE_CONTROL_PARAMS);
  renderRecipeLegend('recipeTempProfileLegend', tempSeries);
  renderRecipeLegend('recipeControlProfileLegend', controlSeries);
  drawRecipeProfileChart('recipeTempProfileChart', tempSeries, stages, totalDuration, 'Нет температурных уставок');
  drawRecipeProfileChart('recipeControlProfileChart', controlSeries, stages, totalDuration, 'Нет управляющих уставок');
}

function renderRecipeStages(stages) {
  const target = document.getElementById('recipeStagesBody');
  if (!target) return;
  if (!stages.length) {
    target.innerHTML = '<div class="recipe-empty">Нет данных</div>';
    return;
  }

  target.innerHTML = stages.map((stage) => {
    const meta = getStageMeta(stage.stage_code) || {};
    const start = Number(stage.start_time_sec || 0);
    const end = Number(stage.end_time_sec || 0);
    return `
      <div class="recipe-stage-card" style="background:${meta.bg || 'rgba(255,255,255,0.03)'};border-color:${meta.border || 'var(--border)'}">
        <div class="recipe-stage-card__bar" style="background:${meta.color || 'rgba(255,255,255,0.35)'}"></div>
        <div class="recipe-stage-card__content">
          <div class="recipe-stage-card__name">${escapeHtml(getStageTitle(stage))}</div>
          <div class="recipe-stage-card__time">${fmtClock(start)} - ${fmtClock(end)}</div>
          <div class="recipe-stage-card__duration">Длительность: ${fmtDuration(Math.max(0, end - start))}</div>
          <div class="recipe-stage-card__desc">${escapeHtml(stage.description || '')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecipeSetpoints(recipe) {
  const target = document.getElementById('recipeSetpointsBody');
  if (!target) return;
  const stages = recipe.stages || [];
  const grouped = {};
  (recipe.setpoints || []).forEach((sp) => {
    const pid = Number(sp.parameter_id);
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push(sp);
  });

  const groups = RECIPE_PARAM_ORDER.map((pid) => {
    const cfg = RECIPE_PARAM_CONFIG[pid];
    const points = (grouped[pid] || []).slice().sort((a, b) => Number(a.time_offset_sec || 0) - Number(b.time_offset_sec || 0));
    if (!points.length) return '';
    const rows = points.map((sp) => {
      const stage = getStageForSetpoint(sp, stages);
      const tolerance = sp.tolerance === null || sp.tolerance === undefined || sp.tolerance === '' ? '-' : `±${sp.tolerance}`;
      return `
        <tr>
          <td>${fmtClock(sp.time_offset_sec)}</td>
          <td><strong>${escapeHtml(sp.target_value)}</strong></td>
          <td>${escapeHtml(tolerance)}</td>
          <td>${escapeHtml(getStageTitle(stage))}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="recipe-setpoint-group">
        <div class="recipe-setpoint-group__title">
          <span class="recipe-setpoint-color" style="background:${cfg.color}"></span>
          ${escapeHtml(cfg.name)}, ${escapeHtml(cfg.unit)}
        </div>
        <div class="table-grid">
          <table class="recipe-view-table recipe-view-table--setpoints">
            <thead>
              <tr>
                <th>Время</th>
                <th>Уставка</th>
                <th>Допуск</th>
                <th>Этап</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).filter(Boolean);

  target.innerHTML = groups.length ? groups.join('') : '<div class="recipe-empty">Нет данных</div>';
}// Generate stage templates based on roast degree and total duration
function getTemplateProportions(degree) {
  const templates = {
    light: [
      { code: 'drying', start: 0.00, end: 0.50 },
      { code: 'maillard', start: 0.50, end: 0.80 },
      { code: 'first_crack', start: 0.80, end: 0.87 },
      { code: 'development', start: 0.87, end: 0.95 },
      { code: 'discharge', start: 0.95, end: 1.00 },
    ],
    medium: [
      { code: 'drying', start: 0.00, end: 0.50 },
      { code: 'maillard', start: 0.50, end: 0.79 },
      { code: 'first_crack', start: 0.79, end: 0.86 },
      { code: 'development', start: 0.86, end: 0.96 },
      { code: 'discharge', start: 0.96, end: 1.00 },
    ],
    dark: [
      { code: 'drying', start: 0.00, end: 0.50 },
      { code: 'maillard', start: 0.50, end: 0.79 },
      { code: 'first_crack', start: 0.79, end: 0.84 },
      { code: 'development', start: 0.84, end: 0.93 },
      { code: 'second_crack', start: 0.93, end: 0.96 },
      { code: 'pyrolysis', start: 0.96, end: 0.99 },
      { code: 'discharge', start: 0.99, end: 1.00 },
    ],
  };
  return templates[degree] || templates.medium;
}

function generateStageTemplate(degree, totalDurationSec) {
  const total = Number(totalDurationSec) > 0 ? Number(totalDurationSec) : 600; // default 10 min
  const props = getTemplateProportions(degree);
  const stages = props.map((p, idx) => {
    const start = Math.round(p.start * total);
    // ensure last stage ends exactly at total
    const end = idx === props.length - 1 ? total : Math.round(p.end * total);
    const name = (p.code === 'development' && degree === 'light') ? 'Короткая стадия развития' : (STAGE_LABELS[p.code] || p.code);
    return { stage_code: p.code, stage_name: name, start_time_sec: start, end_time_sec: end, description: '' };
  });
  // Fix potential overlaps/gaps due to rounding
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i-1];
    const cur = stages[i];
    if (cur.start_time_sec > prev.end_time_sec) cur.start_time_sec = prev.end_time_sec;
    if (cur.start_time_sec < prev.end_time_sec && cur.start_time_sec !== prev.end_time_sec) {
      // ensure monotonicity
      cur.start_time_sec = prev.end_time_sec;
    }
    if (cur.end_time_sec < cur.start_time_sec) cur.end_time_sec = cur.start_time_sec + 1;
  }
  // ensure first starts at 0
  if (stages.length) stages[0].start_time_sec = 0;
  // ensure last ends at total
  if (stages.length) stages[stages.length-1].end_time_sec = total;
  return stages;
}

function applyStageTemplateToEditor(stages) {
  const stagesContainer = $('#stagesEditorList');
  stagesContainer.innerHTML = '';
  stages.forEach(s => addStageEditorRow(s));
  attachStageChangeHandlers();
}

function attachStageChangeHandlers() {
  const list = document.getElementById('stagesEditorList');
  if (!list) return;
  const modal = document.getElementById('recipeEditor');
  if (!modal) return;
  // remove previous listeners by cloning
  const clone = list.cloneNode(true);
  list.parentNode.replaceChild(clone, list);
  // reattach handler for new nodes
  clone.querySelectorAll('.stage-item input, .stage-item select').forEach(el => {
    el.addEventListener('input', () => { modal.dataset.stagesEdited = 'true'; });
    el.addEventListener('change', () => { modal.dataset.stagesEdited = 'true'; });
  });
}

function markStagesEdited(flag) {
  const modal = document.getElementById('recipeEditor');
  if (!modal) return;
  modal.dataset.stagesEdited = flag ? 'true' : 'false';
}

function renderRecipe(recipe) {
  if (!recipe) {
    if ($('#recipeName')) $('#recipeName').textContent = '-';
    if ($('#recipeDegree')) $('#recipeDegree').textContent = '-';
    if ($('#recipeDuration')) $('#recipeDuration').textContent = '-';
    const desc = $('#recipeDescription');
    if (desc) {
      desc.textContent = 'Рецепты не найдены';
      desc.style.display = '';
    }
    renderRecipeProfiles({ setpoints: [], stages: [], total_duration_sec: 0 });
    renderRecipeStages([]);
    renderRecipeSetpoints({ setpoints: [], stages: [] });
    return;
  }

  const degree = DEGREE_LABELS[recipe.category] || recipe.category || '-';

  $('#recipeName').textContent = recipe.name || '-';
  $('#recipeDegree').textContent = `${degree} обжарка`;
  $('#recipeDegree').className = `badge recipe-badge--${recipe.category || 'medium'}`;
  $('#recipeDuration').textContent = `Длительность: ${recipe.total_duration_sec ? fmtDuration(recipe.total_duration_sec) : '-'}`;

  const desc = $('#recipeDescription');
  if (desc) {
    desc.textContent = recipe.description || '';
    desc.style.display = recipe.description ? '' : 'none';
  }

  renderRecipeProfiles(recipe);
  renderRecipeStages(recipe.stages || []);
  renderRecipeSetpoints(recipe);
}
function openRecipeEditor(mode, recipe) {
  const modal = $('#recipeEditor');
  if (!modal) return;
  modal.style.display = 'flex';
  $('#recipeEditorTitle').textContent = mode === 'create' ? 'Создать рецепт' : 'Редактирование рецепта';
  $('#recipeEditorError').style.display = 'none';

  $('#r_name').value = recipe?.name || '';
  $('#r_degree').value = recipe?.category || recipe?.roast_degree || 'medium';
  $('#r_total_duration_sec').value = recipe?.total_duration_sec || '';
  $('#r_target_weight_kg').value = recipe?.target_weight_kg || '';
  $('#r_description').value = recipe?.description || '';
  modal.dataset.mode = mode;
  modal.dataset.recipeId = recipe?.id || '';
  modal.dataset.stagesEdited = 'false';
  modal.dataset.lastDegree = $('#r_degree').value;

  // For create mode, if total duration not provided, set default 600s so template shows predictable times
  if (mode === 'create') {
    const totalEl = $('#r_total_duration_sec');
    if (totalEl && (!totalEl.value || Number(totalEl.value) <= 0)) {
      totalEl.value = 600; // default 10 minutes
    }
  }

  // Build setpoint groups
  const groupsContainer = $('#setpointsGroups');
  groupsContainer.innerHTML = '';
  const grouped = {};
  (recipe?.setpoints || []).forEach(sp => {
    const pid = Number(sp.parameter_id);
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push(sp);
  });

  for (let pid = 1; pid <= 6; pid++) {
    const points = grouped[pid] || [];
    renderSetpointGroup(pid, points);
  }

  // Build stages list
  const stagesContainer = $('#stagesEditorList');
  stagesContainer.innerHTML = '';
  const stages = recipe?.stages || [];
  if ((mode === 'create' && stages.length === 0) || (!stages.length && $('#r_total_duration_sec').value)) {
    // create template based on degree and total duration
    const total = Number($('#r_total_duration_sec').value) || 600;
    const tpl = generateStageTemplate($('#r_degree').value, total);
    applyStageTemplateToEditor(tpl);
    markStagesEdited(false);
  } else if (stages.length) {
    // use provided stages from backend (edit mode)
    stages.forEach(st => addStageEditorRow(st));
    attachStageChangeHandlers();
    markStagesEdited(false);
  }

  // react to degree change
  const degreeSelect = $('#r_degree');
  if (degreeSelect) {
    degreeSelect.onchange = () => {
      const newDeg = degreeSelect.value;
      const last = modal.dataset.lastDegree || '';
      const wasEdited = modal.dataset.stagesEdited === 'true';
      const apply = () => {
        const total = Number($('#r_total_duration_sec').value) || 600;
        const tpl = generateStageTemplate(newDeg, total);
        applyStageTemplateToEditor(tpl);
        modal.dataset.lastDegree = newDeg;
        markStagesEdited(false);
      };
      if (wasEdited) {
        if (confirm('Этапы были изменены вручную. Заменить шаблон этапов и потерять незанесённые изменения?')) {
          apply();
        } else {
          // revert selection
          degreeSelect.value = last;
        }
      } else {
        // if in edit mode, ask confirmation before replacing backend stages
        if (modal.dataset.mode === 'edit') {
          if (confirm('Заменить этапы шаблоном для новой степени обжарки?')) apply(); else degreeSelect.value = last;
        } else {
          apply();
        }
      }
    };
  }

  // react to total duration change — regenerate template only if user hasn't edited stages
  const totalInput = $('#r_total_duration_sec');
  if (totalInput) {
    totalInput.onchange = () => {
      const wasEdited = modal.dataset.stagesEdited === 'true';
      if (wasEdited) return; // don't overwrite user's edits
      const deg = $('#r_degree').value;
      const total = Number(totalInput.value) || 600;
      const tpl = generateStageTemplate(deg, total);
      applyStageTemplateToEditor(tpl);
    };
  }
}

function closeRecipeEditor() {
  const modal = $('#recipeEditor');
  if (!modal) return;
  modal.style.display = 'none';
}

function renderSetpointGroup(paramId, points=[]) {
  const groups = $('#setpointsGroups');
  if (!groups) return;
  const [label, unit=''] = PARAM_LABELS[paramId] || [`Параметр ${paramId}`, ''];

  const group = document.createElement('div');
  group.className = 'sp-group';
  group.dataset.paramId = String(paramId);
  group.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong>${label}</strong>
      <button class="small add-sp-point">+ Добавить точку</button>
    </div>
    <div class="sp-points" style="display:flex; flex-direction:column; gap:6px; margin-top:8px;"></div>
  `;

  groups.appendChild(group);

  const pointsWrap = group.querySelector('.sp-points');
  function addPointRow(pt={}) {
    const row = document.createElement('div');
    row.className = 'sp-point-row';
    row.style.display = 'flex';
    row.style.gap = '8px';
    // Use placeholders and show units. Do not prefill with 0 unless backend provided 0.
    const timeVal = (pt.time_offset_sec === null || pt.time_offset_sec === undefined) ? '' : String(pt.time_offset_sec);
    const valueVal = (pt.target_value === null || pt.target_value === undefined) ? '' : String(pt.target_value);
    const tolVal = (pt.tolerance === null || pt.tolerance === undefined) ? '' : String(pt.tolerance);

    row.innerHTML = `
      <input class="sp-time" type="number" placeholder="введите время" value="${timeVal}" style="width:120px;" />
      <span style="align-self:center; color:var(--muted);">сек</span>

      <input class="sp-value" type="number" placeholder="введите значение" value="${valueVal}" style="width:120px;" />
      <span style="align-self:center; color:var(--muted);">${unit}</span>

      <span style="align-self:center; color:var(--muted);">±</span>
      <input class="sp-tol" type="number" placeholder="отклонение" value="${tolVal}" style="width:100px;" />
      <span style="align-self:center; color:var(--muted);">${unit}</span>

      <div style="flex:1"></div>
      <button class="danger sp-remove">Удалить</button>
    `;
    pointsWrap.appendChild(row);
    row.querySelector('.sp-remove').addEventListener('click', () => row.remove());
  }

  // populate existing points or add one empty row (placeholders)
  if (points.length) {
    points.forEach(p => addPointRow({ time_offset_sec: p.time_offset_sec, target_value: p.target_value, tolerance: p.tolerance }));
  } else {
    addPointRow({});
  }

  group.querySelector('.add-sp-point').addEventListener('click', () => addPointRow({}));
}

function addStageEditorRow(st = {}) {
  const list = $('#stagesEditorList');
  if (!list) return;
  const item = document.createElement('div');
  item.className = 'stage-item';
  item.style.display = 'flex';
  item.style.gap = '8px';
  item.style.alignItems = 'center';

  // stage name (readonly) — show Russian label; store english code in data-code
  const nameInput = document.createElement('input');
  nameInput.className = 'st-name';
  nameInput.type = 'text';
  nameInput.placeholder = 'название';
  nameInput.style.width = '220px';
  nameInput.readOnly = true;

  const startInput = document.createElement('input');
  startInput.className = 'st-start';
  startInput.type = 'number';
  startInput.placeholder = 'start сек';
  startInput.style.width = '100px';
  startInput.value = st.start_time_sec ?? 0;

  const endInput = document.createElement('input');
  endInput.className = 'st-end';
  endInput.type = 'number';
  endInput.placeholder = 'end сек';
  endInput.style.width = '100px';
  endInput.value = st.end_time_sec ?? 0;

  const descInput = document.createElement('input');
  descInput.className = 'st-desc';
  descInput.type = 'text';
  descInput.placeholder = 'описание';
  descInput.style.flex = '1';
  descInput.value = st.description || '';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'danger st-remove';
  removeBtn.textContent = 'Удалить';

  // assemble — do not include select column
  item.appendChild(nameInput);
  item.appendChild(startInput);
  item.appendChild(endInput);
  item.appendChild(descInput);
  item.appendChild(removeBtn);
  list.appendChild(item);

  // set initial code/name
  const codeFromSt = st.stage_code || '';
  let label = st.stage_name || '';
  if (!label && codeFromSt) label = STAGE_LABELS[codeFromSt] || '';
  if (!label) {
    // default to first option
    label = STAGE_OPTIONS[0].label;
  }
  nameInput.value = label;
  // store english code for submission (prefer st.stage_code, otherwise find by label)
  const codeToStore = codeFromSt || (STAGE_OPTIONS.find(o => o.label === label) || {}).code || '';
  nameInput.dataset.code = codeToStore;

  removeBtn.addEventListener('click', () => item.remove());
}

async function saveRecipeFromEditor() {
  const modal = $('#recipeEditor');
  if (!modal) return;
  const mode = modal.dataset.mode;
  const id = modal.dataset.recipeId;
  const errEl = $('#recipeEditorError');
  function showError(msg) { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } }
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

  const body = {
    name: $('#r_name').value,
    roast_degree: $('#r_degree').value,
    total_duration_sec: Number($('#r_total_duration_sec').value || 0),
    target_weight_kg: Number($('#r_target_weight_kg').value || 0),
    description: $('#r_description').value,
    setpoints: [],
    stages: [],
  };
  if (mode === 'edit') body.id_recipe = Number(id);

  // collect setpoints from groups
  let hasEmptySetpoint = false;
  for (let pid = 1; pid <= 6; pid++) {
    const group = document.querySelector(`.sp-group[data-param-id="${pid}"]`);
    if (!group) continue;
    const rows = group.querySelectorAll('.sp-point-row');
    rows.forEach((row) => {
      const timeRaw = String(row.querySelector('.sp-time').value ?? '');
      const valueRaw = String(row.querySelector('.sp-value').value ?? '');
      const tolRaw = String(row.querySelector('.sp-tol').value ?? '');

      if (timeRaw.trim() === '' || valueRaw.trim() === '' || tolRaw.trim() === '') {
        hasEmptySetpoint = true;
        return; // skip adding
      }

      const time = Number(timeRaw);
      const value = Number(valueRaw);
      const tol = Number(tolRaw);
      body.setpoints.push({ parameter_id: pid, time_offset_sec: time, target_value: value, tolerance: tol });
    });
  }

  if (hasEmptySetpoint) return showError('Заполните все поля уставок');

  // collect stages
  const stageItems = document.querySelectorAll('#stagesEditorList .stage-item');
  stageItems.forEach((item) => {
    // stage code stored on the readonly name input dataset.code
    const nameEl = item.querySelector('.st-name');
    const code = (nameEl && nameEl.dataset && nameEl.dataset.code) ? nameEl.dataset.code : '';
    const name = nameEl ? nameEl.value || '' : '';
    const start = Number(item.querySelector('.st-start').value || 0);
    const end = Number(item.querySelector('.st-end').value || 0);
    const desc = item.querySelector('.st-desc').value || '';
    body.stages.push({ stage_code: code, stage_name: name, start_time_sec: start, end_time_sec: end, description: desc });
  });

  // validation
  if (!body.name || !body.name.trim()) return showError('Название рецепта не может быть пустым');
  if (mode === 'edit' && (!body.id_recipe || !Number.isFinite(body.id_recipe))) return showError('Не найден id редактируемого рецепта');
  if (!Number.isFinite(body.total_duration_sec) || body.total_duration_sec <= 0) return showError('Общая длительность должна быть больше 0');

  // setpoints presence and numeric checks
  const spByParam = {};
  body.setpoints.forEach(sp => {
    if (!spByParam[sp.parameter_id]) spByParam[sp.parameter_id] = [];
    spByParam[sp.parameter_id].push(sp);
  });
  for (let pid=1; pid<=6; pid++) {
    const arr = spByParam[pid] || [];
    if (!arr.length) return showError(`Требуется хотя бы одна уставка для параметра ${pid}`);
    for (const sp of arr) {
      if (!Number.isFinite(sp.time_offset_sec) || sp.time_offset_sec < 0) return showError('time_offset_sec должен быть числом >= 0');
      if (!Number.isFinite(sp.target_value)) return showError('target_value должен быть числом');
      if (!Number.isFinite(sp.tolerance) || sp.tolerance < 0) return showError('tolerance должен быть числом >= 0');
    }
  }

  // stages validation
  if (!body.stages.length) return showError('Добавьте хотя бы один этап');
  for (const st of body.stages) {
    if (!st.stage_code || !st.stage_name) return showError('Этап должен иметь код и название');
    if (!Number.isFinite(st.start_time_sec) || !Number.isFinite(st.end_time_sec)) return showError('Временные поля этапа должны быть числами');
    if (st.start_time_sec >= st.end_time_sec) return showError('start_time_sec должен быть меньше end_time_sec');
    if (st.start_time_sec < 0 || st.end_time_sec < 0) return showError('Временные значения этапов не могут быть отрицательными');
    if (st.end_time_sec > body.total_duration_sec) return showError('Этапы не должны выходить за общую длительность рецепта');
  }

  try {
    let savedRecipe;
    if (mode === 'create') {
      savedRecipe = await postJson('/api/recipes', body);
    } else {
      savedRecipe = await putJson(`/api/recipes/${id}`, body);
    }
    showToast('Рецепт сохранён');
    closeRecipeEditor();
    await loadAllData();
    initRecipesPage(savedRecipe?.id || body.id_recipe || id);
  } catch (err) {
    console.error(err);
    showError(err.message || 'Не удалось сохранить рецепт');
    alert(err.message || 'Не удалось сохранить рецепт');
    showToast('Не удалось сохранить рецепт');
  }
}

async function deactivateCurrentRecipe() {
  const id = $('#recipeSelect').value;
  if (!id) return;
  try {
    await deleteJson(`/api/recipes/${id}`);
    showToast('Рецепт деактивирован');
    await loadAllData();
    initRecipesPage();
  } catch (err) {
    console.error(err);
    showToast('Не удалось деактивировать рецепт');
  }
}

function initRecipesPage(selectedRecipeId = null) {
  activeNav('recipes');
  setUserBadge();

  const recipes = Data.recipes || [];
  const select = $('#recipeSelect');
  const selectedId = selectedRecipeId != null
    ? String(selectedRecipeId)
    : String(select?.value || recipes[0]?.id || '');

  select.innerHTML = recipes.map((recipe, index) => `
    <option value="${recipe.id}" ${String(recipe.id) === selectedId || (!selectedId && index === 0) ? 'selected' : ''}>
      ${recipe.name || `Рецепт ${recipe.id}`}
    </option>
  `).join('');
  if (selectedId && recipes.some((recipe) => String(recipe.id) === selectedId)) select.value = selectedId;

  select.onchange = () => {
    const recipe = recipes.find(item => String(item.id) === select.value);
    renderRecipe(recipe || null);
  };

  // Actions area: show/Create/Edit/Deactivate only for technologist
  const actions = $('#recipeActions');
  if (actions) {
    actions.innerHTML = '';
    if (Data.currentUser?.role === 'technologist') {
      actions.innerHTML = `
        <button id="createRecipeBtn" class="success">Создать рецепт</button>
        <button id="editRecipeBtn" class="secondary">Редактировать</button>
        <button id="deactivateRecipeBtn" class="danger">Деактивировать</button>
      `;

      $('#createRecipeBtn').onclick = () => openRecipeEditor('create', {});
      $('#editRecipeBtn').onclick = () => {
        const recipe = recipes.find(item => String(item.id) === select.value);
        if (!recipe) return showToast('Выберите рецепт');
        openRecipeEditor('edit', recipe);
      };
      $('#deactivateRecipeBtn').onclick = () => {
        const recipe = recipes.find(item => String(item.id) === select.value);
        if (!recipe) return showToast('Выберите рецепт');
        openModal('Деактивировать рецепт', `Деактивировать рецепт «${recipe.name}»?`, async () => { await deactivateCurrentRecipe(); });
      };
    }
  }

  // Editor bindings
  const cancelBtn = $('#recipeEditorCancel');
  const saveBtn = $('#recipeEditorSave');
  const addSpBtn = $('#addSetpoint');
  const addStBtn = $('#addStage');

  if (cancelBtn) cancelBtn.onclick = closeRecipeEditor;
  if (saveBtn) saveBtn.onclick = saveRecipeFromEditor;
  if (addSpBtn) addSpBtn.onclick = () => addSetpointEditorRow({});
  if (addStBtn) addStBtn.onclick = () => addStageEditorRow({});

  // Close modal when clicking outside
  const modal = $('#recipeEditor');
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeRecipeEditor();
    };
  }

  renderRecipe(recipes.find(item => String(item.id) === select.value) || recipes[0] || null);
}
