// page-alarms.js — страница тревог

const SEVERITY_LABEL = {
  Critical: 'Критическая',
  Warning: 'Предупреждение',
};

const STATUS_LABEL = {
  active: 'Активна',
  ack: 'Подтверждена',
  cleared: 'Закрыта',
};

// ── Формат времени
function formatTime(time) {
  if (!time) return '—';

  return new Date(time).toLocaleString('ru', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── Сводный рендер тревог (вызывается с главной страницы и из charts.js)
function renderAlarms(listEl, summaryEl) {
  if (!listEl) return;

  const active  = Data.alarms.filter((a) => a.status !== 'cleared');
  const cleared = Data.alarms.filter((a) => a.status === 'cleared').slice(0, 5);
  const rows    = active.concat(cleared).slice(0, 30);

  listEl.innerHTML = '';

  if (!rows.length) {
    listEl.innerHTML = listEl.tagName === 'TBODY'
      ? '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;">Нет тревог</td></tr>'
      : '<div class="alarms-empty">Нет активных тревог</div>';
    if (summaryEl) summaryEl.textContent = 'Активных: 0';
    return;
  }

  if (listEl.tagName === 'TBODY') {
    rows.forEach((a) => renderAlarmRow(listEl, a, a.status === 'active'));
  } else {
    rows.forEach((a) => {
      const div = document.createElement('div');
      div.textContent = `${a.paramName}: ${Number(a.value ?? 0).toFixed(1)}`;
      listEl.appendChild(div);
    });
  }

  if (summaryEl) {
    const acked = Data.alarms.filter((a) => a.status === 'ack').length;
    summaryEl.textContent = `Активных: ${active.length} · Подтверждено: ${acked}`;
  }
}

// ── Рендер строки таблицы
function renderAlarmRow(tbody, a, showButton) {
  const val = Number(a.value ?? 0);
  const sp = Number(a.setpoint ?? 0);
  const dev = Number(a.deviation ?? val - sp);

  const deltaClass = a.severity === 'Critical' ? 'alarm' : 'warn';
  const sevClass = a.severity === 'Critical' ? 'red' : 'yellow';
  const sevLabel = SEVERITY_LABEL[a.severity] || a.severity;
  const stLabel = STATUS_LABEL[a.status] || a.status;

  const tr = document.createElement('tr');
  const cells = [
    a.id ?? '—',
    formatTime(a.time),
    null,
    Number.isFinite(val) ? val.toFixed(1) : '—',
    Number.isFinite(sp) ? sp.toFixed(1) : '—',
    null,
    null,
    null,
  ];
  cells.forEach((text) => {
    const td = document.createElement('td');
    if (text != null) td.textContent = text;
    tr.appendChild(td);
  });

  const name = document.createElement('strong');
  name.textContent = a.paramName || 'Параметр';
  tr.children[2].appendChild(name);

  const delta = document.createElement('span');
  delta.className = `delta ${deltaClass}`;
  delta.style.fontWeight = '600';
  delta.textContent = Number.isFinite(dev) ? `${dev > 0 ? '+' : ''}${dev.toFixed(1)}` : '—';
  tr.children[5].appendChild(delta);

  const severity = document.createElement('span');
  severity.className = `log-event-badge log-event-badge--${sevClass}`;
  severity.textContent = sevLabel || '—';
  tr.children[6].appendChild(severity);

  const actionCell = tr.children[7];

  if (showButton && a.status === 'active') {
    const btn = document.createElement('button');
    btn.className = 'alarm-action-btn alarm-action-btn--ack';
    btn.textContent = 'Подтвердить';
    btn.onclick = () => ackAlarm(a.id);
    actionCell.appendChild(btn);
  } else if (a.status === 'ack') {
    const badge = document.createElement('span');
    badge.className = 'alarm-ack-badge';

    const status = document.createElement('span');
    status.className = 'alarm-ack-badge__status';
    status.textContent = stLabel;

    const user = document.createElement('span');
    user.className = 'alarm-ack-badge__user';
    user.textContent = a.acknowledgedByName || 'Пользователь не указан';

    badge.append(status, user);
    actionCell.appendChild(badge);
  } else {
    const badge = document.createElement('span');
    badge.className = 'alarm-status-badge';
    badge.textContent = stLabel;
    actionCell.appendChild(badge);
  }

  tbody.appendChild(tr);
}

// ── Рендер страницы
function renderAlarmsPage() {
  const activeBody = $('#alarmsActive');
  const historyBody = $('#alarmsHistory');
  if (!activeBody || !historyBody) return;

  const active = Data.alarms.filter(a => a.status !== 'cleared');
  const history = Data.alarms.filter(a => a.status === 'cleared');

  const countActive = $('#countActive');
  const countHistory = $('#countHistory');
  if (countActive) countActive.textContent = active.length;
  if (countHistory) countHistory.textContent = history.length;

  // Активные
  activeBody.innerHTML = '';
  if (!active.length) {
    activeBody.innerHTML = `<tr>
      <td colspan="8" style="text-align:center;color:var(--muted);padding:24px;">
        Нет активных тревог
      </td>
    </tr>`;
  } else {
    active.forEach(a => renderAlarmRow(activeBody, a, true));
  }

  // История
  historyBody.innerHTML = '';
  if (!history.length) {
    historyBody.innerHTML = `<tr>
      <td colspan="8" style="text-align:center;color:var(--muted);padding:24px;">
        История пуста
      </td>
    </tr>`;
  } else {
    history.slice(0, 50).forEach(a => renderAlarmRow(historyBody, a, false));
  }
}

// ── Подтверждение тревоги
async function ackAlarm(id) {
  const alarm = Data.alarms.find(a => a.id === id);
  if (!alarm) return;

  try {
    const result = await postJson(`/api/alarms/${id}/ack`, {});
    alarm.status = 'ack';
    alarm.ackTime = toMs(result?.acknowledged_at) || Date.now();
    alarm.acknowledgedBy = result?.acknowledged_by || Data.currentUser?.id || alarm.acknowledgedBy || null;
    alarm.acknowledgedByName = result?.acknowledged_by_name || Data.currentUser?.name || alarm.acknowledgedByName || '';

    renderAlarmsPage();
    showToast('Тревога подтверждена');
  } catch (err) {
    console.error(err);
    showToast('Ошибка подтверждения');
  }
}

window.ackAlarm = ackAlarm;

// ── Инициализация
function initAlarmsPage() {
  activeNav('alarms');
  setUserBadge();
  renderAlarmsPage();

  $$('.alarm-tab').forEach(btn => {
    btn.onclick = () => {
      $$('.alarm-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const isActive = btn.dataset.tab === 'active';
      $('#tabActive').style.display = isActive ? '' : 'none';
      $('#tabHistory').style.display = isActive ? 'none' : '';
    };
  });
}
