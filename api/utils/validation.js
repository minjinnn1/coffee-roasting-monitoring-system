function toPositiveInt(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNonNegativeNumber(value) {
  const num = toFiniteNumber(value);
  return num != null && num >= 0 ? num : null;
}

function cleanText(value, maxLength = 255) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validateRecipePayload(body = {}) {
  const name = cleanText(body.name, 120);
  const roastDegree = cleanText(body.roast_degree, 30);
  const totalDurationSec = toPositiveInt(body.total_duration_sec);
  const targetWeightKg = toNonNegativeNumber(body.target_weight_kg);
  const description = cleanText(body.description, 1000);
  const setpoints = Array.isArray(body.setpoints) ? body.setpoints : [];
  const stages = Array.isArray(body.stages) ? body.stages : [];

  if (!name) return { error: 'Название рецепта обязательно' };
  if (!roastDegree) return { error: 'Степень обжарки обязательна' };
  if (!totalDurationSec) return { error: 'Некорректная длительность рецепта' };
  if (targetWeightKg == null) return { error: 'Некорректная целевая масса' };

  const cleanStages = [];
  for (const stage of stages) {
    const stageCode = cleanText(stage.stage_code, 60);
    const startTimeSec = toNonNegativeNumber(stage.start_time_sec);
    const endTimeSec = toNonNegativeNumber(stage.end_time_sec);
    if (!stageCode || startTimeSec == null || endTimeSec == null || endTimeSec < startTimeSec) {
      return { error: 'Некорректные этапы рецепта' };
    }
    cleanStages.push({
      stage_code: stageCode,
      stage_name: cleanText(stage.stage_name, 120),
      start_time_sec: startTimeSec,
      end_time_sec: endTimeSec,
    });
  }

  const cleanSetpoints = [];
  for (const setpoint of setpoints) {
    const parameterId = toPositiveInt(setpoint.parameter_id ?? setpoint.id_parameters);
    const timeOffsetSec = toNonNegativeNumber(setpoint.time_offset_sec);
    const targetValue = toFiniteNumber(setpoint.target_value);
    const tolerance = toNonNegativeNumber(setpoint.tolerance ?? 0);
    if (!parameterId || timeOffsetSec == null || targetValue == null || tolerance == null) {
      return { error: 'Некорректные уставки рецепта' };
    }
    cleanSetpoints.push({
      parameter_id: parameterId,
      time_offset_sec: timeOffsetSec,
      target_value: targetValue,
      tolerance,
    });
  }

  return {
    value: {
      name,
      roast_degree: roastDegree,
      total_duration_sec: totalDurationSec,
      target_weight_kg: targetWeightKg,
      description,
      setpoints: cleanSetpoints,
      stages: cleanStages,
    },
  };
}

module.exports = {
  toPositiveInt,
  toFiniteNumber,
  toNonNegativeNumber,
  cleanText,
  validateRecipePayload,
};
