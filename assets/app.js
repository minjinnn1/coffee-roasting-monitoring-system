document.addEventListener('DOMContentLoaded', async () => {
  const page = document.body.dataset.page;

  if (page === 'login') {
    initLoginPage();
    return;
  }

  if (!ensureAuth()) return;

  await loadAllData();
  connectRealtime();
  if (!wsConnected) startMeasurementsPolling();

  switch (page) {
    case 'dashboard': initDashboard();    break;
    case 'alarms':    initAlarmsPage();   break;
    case 'batches':   initBatchesPage();  break;
    case 'recipes':   initRecipesPage();  break;
    case 'logs':      initLogsPage();     break;
    default:          activeNav(null);    break;
  }
});