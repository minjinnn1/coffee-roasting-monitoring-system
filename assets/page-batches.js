// page-batches.js — архив партий

const BATCH_STATUS_LABELS = {
  completed: 'Завершена',
  aborted: 'Прервана',
  active: 'Активна',
};

const BATCH_STATUS_TONES = {
  completed: 'green',
  aborted: 'red',
  active: 'blue',
};

function renderBatchesTable() {
  const tbody = $('#batchesBody');
  const template = $('#batchRowTemplate');
  if (!tbody || !template) return;

  const status = $('#filterStatus')?.value || 'all';
  const recipe = $('#filterRecipe')?.value || 'all';
  const search = ($('#filterSearch')?.value || '').toLowerCase().trim();

  const batches = (Data.archiveBatches || []).filter((batch) => {
    if (status !== 'all' && batch.status !== status) return false;
    if (recipe !== 'all' && batch.recipe !== recipe) return false;
    if (search && !String(batch.batchNumber || '').toLowerCase().includes(search)) return false;
    return true;
  });

  tbody.innerHTML = '';

  if (!batches.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');

    cell.colSpan = 10;
    cell.textContent = 'Нет партий';
    cell.style.cssText = 'text-align:center;color:var(--muted);padding:24px;';

    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  batches.forEach((batch, index) => {
    const row = template.content.cloneNode(true);
    const recipeClass = batch.recipeCategory === 'light'
      ? 'light'
      : batch.recipeCategory === 'dark'
        ? 'dark'
        : 'medium';

    const statusLabel = BATCH_STATUS_LABELS[batch.status] || batch.status || '—';
    const statusTone = BATCH_STATUS_TONES[batch.status] || 'neutral';

    row.querySelector('[data-field="index"]').textContent = index + 1;
    row.querySelector('[data-field="number"]').textContent = batch.batchNumber || '—';
    row.querySelector('[data-field="variety"]').textContent = batch.coffeeVariety || '—';
    row.querySelector('[data-field="weightIn"]').textContent = batch.greenWeight !== '-' ? batch.greenWeight : '—';
    row.querySelector('[data-field="weightOut"]').textContent = batch.roastedWeight !== '-' ? batch.roastedWeight : '—';
    row.querySelector('[data-field="start"]').textContent = batch.startTime || '—';
    row.querySelector('[data-field="duration"]').textContent = batch.duration || '—';

    const recipeEl = row.querySelector('[data-field="recipe"]');
    recipeEl.textContent = batch.recipe || '—';
    recipeEl.className = `badge recipe-badge--${recipeClass}`;

    const statusEl = row.querySelector('[data-field="status"]');
    statusEl.textContent = statusLabel;
    statusEl.className = `log-event-badge log-event-badge--${statusTone}`;

    const reportBtn = row.querySelector('[data-field="report"]');
    reportBtn.dataset.id = batch.id;
    reportBtn.addEventListener('click', () => downloadBatchReport(batch.id));

    tbody.appendChild(row);
  });
}

async function downloadBatchReport(batchId) {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    showToast('Некорректный номер партии');
    return;
  }
  try {
    const report = await fetchJson(`/api/batches/${normalizedBatchId}/report`);
    const batch = report.batch || {};
    const stats = Array.isArray(report.statistics) ? report.statistics : [];
    const alarms = report.alarms || {};

    const formatDate = (date) => date
      ? new Date(date).toLocaleString('ru', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '—';

    const formatDuration = () => {
      if (!batch.start_time || !batch.end_time) return '—';

      const minutes = Math.round(
        (new Date(batch.end_time) - new Date(batch.start_time)) / 60000
      );

      return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
    };
    const formatNumber = (value, digits = 2) => {
      const num = Number(value);
      return Number.isFinite(num) ? num.toFixed(digits) : '—';
    };

    const rows = [
      csvRow('ОТЧЁТ ПО ПАРТИИ'),
      '',
      csvRow('Параметр', 'Значение'),
      csvRow('Номер партии', batch.batch_number || normalizedBatchId),
      csvRow('Рецепт', batch.recipe || '—'),
      csvRow('Оператор', batch.operator || '—'),
      csvRow('Сорт зерна', batch.coffee_variety || '—'),
      csvRow('Статус', BATCH_STATUS_LABELS[batch.status] || batch.status || '—'),
      csvRow('Начало', formatDate(batch.start_time)),
      csvRow('Конец', formatDate(batch.end_time)),
      csvRow('Длительность', formatDuration()),
      '',
      csvRow('МАССА ПАРТИИ'),
      '',
      csvRow('Параметр', 'Значение'),
      csvRow('Масса на входе', `${formatNumber(batch.green_weight_in)} кг`),
      csvRow('Масса на выходе', `${formatNumber(batch.roasted_weight_out)} кг`),
      csvRow('Потери', `${formatNumber(batch.loss_kg)} кг (${formatNumber(batch.loss_percent)} %)`),
      '',
      csvRow('ТРЕВОГИ'),
      '',
      csvRow('Параметр', 'Значение'),
      csvRow('Всего тревог', alarms.total ?? 0),
      csvRow('Подтверждено', alarms.acknowledged ?? 0),
      csvRow('Не подтверждено', (alarms.total ?? 0) - (alarms.acknowledged ?? 0)),
      '',
      csvRow('СТАТИСТИКА ПАРАМЕТРОВ'),
      '',
      csvRow('Параметр', 'Ед. изм.', 'Мин', 'Макс', 'Среднее', 'Кол-во точек'),
      ...stats.map((item) => csvRow(
        item.parameter_name || 'Параметр',
        item.parameter_unit || '',
        formatNumber(item.min_value),
        formatNumber(item.max_value),
        formatNumber(item.avg_value),
        item.points ?? 0,
      )),
    ];

    const blob = new Blob(['\uFEFF' + rows.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `report_${batch.batch_number || normalizedBatchId}.csv`;
    link.click();

    URL.revokeObjectURL(url);
    showToast('Отчёт скачан');
  } catch (err) {
    console.error(err);
    showToast('Не удалось сформировать отчёт');
  }
}

function initBatchesPage() {
  activeNav('batches');
  setUserBadge();

  const recipeSelect = $('#filterRecipe');
  const recipes = [...new Set((Data.archiveBatches || [])
    .map((batch) => batch.recipe)
    .filter(Boolean))]
    .sort();

  if (recipeSelect) {
    recipes.forEach((recipe) => {
      const option = document.createElement('option');
      option.value = recipe;
      option.textContent = recipe;
      recipeSelect.appendChild(option);
    });
  }

  ['filterStatus', 'filterRecipe', 'filterSearch'].forEach((id) => {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener('input', renderBatchesTable);
    el.addEventListener('change', renderBatchesTable);
  });

  renderBatchesTable();
}
