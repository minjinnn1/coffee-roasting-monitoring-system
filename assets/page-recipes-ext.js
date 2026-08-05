(function(){
  window.openRecipeEditor = openRecipeEditor;
  window.closeRecipeEditor = closeRecipeEditor;

  function openRecipeEditor(mode, recipe) {
    const modal = document.getElementById('recipeEditor');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('recipeEditorTitle').textContent = mode === 'create' ? 'Создать рецепт' : 'Редактирование рецепта';

    document.querySelector('#setpointsTableEditor tbody').innerHTML = '';
    document.querySelector('#stagesTableEditor tbody').innerHTML = '';

    document.getElementById('r_name').value = recipe?.name || '';
    document.getElementById('r_degree').value = recipe?.category || recipe?.roast_degree || 'medium';
    document.getElementById('r_total_duration_sec').value = recipe?.total_duration_sec || '';
    document.getElementById('r_target_weight_kg').value = recipe?.target_weight_kg || '';
    document.getElementById('r_description').value = recipe?.description || '';
    modal.dataset.mode = mode;
    modal.dataset.recipeId = recipe?.id || '';

    (recipe?.setpoints || []).forEach(addSetpointEditorRow);
    (recipe?.stages || []).forEach(addStageEditorRow);
  }

  function closeRecipeEditor() {
    const modal = document.getElementById('recipeEditor');
    if (!modal) return;
    modal.style.display = 'none';
  }

  function addSetpointEditorRow(sp = {}) {
    const tbody = document.querySelector('#setpointsTableEditor tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <select class="sp-param">
          <option value="1">1 - T входящего воздуха</option>
          <option value="2">2 - T выходящего воздуха</option>
          <option value="3">3 - T зерна</option>
          <option value="4">4 - RoR</option>
          <option value="5">5 - Мощность нагрева</option>
          <option value="6">6 - Скорость воздуха</option>
        </select>
      </td>
      <td><input class="sp-time" type="number" value="${sp.time_offset_sec || 0}" /></td>
      <td><input class="sp-value" type="number" value="${sp.target_value || 0}" /></td>
      <td><input class="sp-tol" type="number" value="${sp.tolerance || 0}" /></td>
      <td><button class="danger sp-remove">Удалить</button></td>
    `;
    tbody.appendChild(tr);
    tr.querySelector('.sp-remove').addEventListener('click', () => tr.remove());
    if (sp.parameter_id) tr.querySelector('.sp-param').value = sp.parameter_id;
  }

  function addStageEditorRow(st = {}) {
    const tbody = document.querySelector('#stagesTableEditor tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="st-code" type="text" value="${st.stage_code || ''}"/></td>
      <td><input class="st-name" type="text" value="${st.stage_name || ''}"/></td>
      <td><input class="st-start" type="number" value="${st.start_time_sec || 0}"/></td>
      <td><input class="st-end" type="number" value="${st.end_time_sec || 0}"/></td>
      <td><input class="st-desc" type="text" value="${st.description || ''}"/></td>
      <td><button class="danger st-remove">Удалить</button></td>
    `;
    tbody.appendChild(tr);
    tr.querySelector('.st-remove').addEventListener('click', () => tr.remove());
  }

  async function saveRecipeFromEditor() {
    const modal = document.getElementById('recipeEditor');
    if (!modal) return;
    const mode = modal.dataset.mode;
    const id = modal.dataset.recipeId;
    const body = {
      name: document.getElementById('r_name').value,
      roast_degree: document.getElementById('r_degree').value,
      total_duration_sec: Number(document.getElementById('r_total_duration_sec').value || 0),
      target_weight_kg: Number(document.getElementById('r_target_weight_kg').value || 0),
      description: document.getElementById('r_description').value,
      setpoints: [],
      stages: [],
    };

    document.querySelectorAll('#setpointsTableEditor tbody tr').forEach((tr) => {
      const param = Number(tr.querySelector('.sp-param').value || 0);
      const time = Number(tr.querySelector('.sp-time').value || 0);
      const value = Number(tr.querySelector('.sp-value').value || 0);
      const tol = Number(tr.querySelector('.sp-tol').value || 0);
      body.setpoints.push({ parameter_id: param, time_offset_sec: time, target_value: value, tolerance: tol });
    });

    document.querySelectorAll('#stagesTableEditor tbody tr').forEach((tr) => {
      const code = tr.querySelector('.st-code').value || '';
      const name = tr.querySelector('.st-name').value || '';
      const start = Number(tr.querySelector('.st-start').value || 0);
      const end = Number(tr.querySelector('.st-end').value || 0);
      const desc = tr.querySelector('.st-desc').value || '';
      body.stages.push({ stage_code: code, stage_name: name, start_time_sec: start, end_time_sec: end, description: desc });
    });

    try {
      if (mode === 'create') {
        await window.postJson('/api/recipes', body);
      } else {
        await window.putJson(`/api/recipes/${id}`, body);
      }
      window.showToast('Рецепт сохранён');
      closeRecipeEditor();
      await window.loadAllData();
      if (typeof window.initRecipesPage === 'function') window.initRecipesPage();
    } catch (err) {
      console.error(err);
      window.showToast('Не удалось сохранить рецепт');
    }
  }

  async function deactivateCurrentRecipe() {
    const id = document.getElementById('recipeSelect').value;
    if (!id) return;
    try {
      await window.deleteJson(`/api/recipes/${id}`);
      window.showToast('Рецепт деактивирован');
      await window.loadAllData();
      if (typeof window.initRecipesPage === 'function') window.initRecipesPage();
    } catch (err) {
      console.error(err);
      window.showToast('Не удалось деактивировать рецепт');
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'recipeEditorCancel') closeRecipeEditor();
    if (e.target && e.target.id === 'recipeEditorSave') saveRecipeFromEditor();
    if (e.target && e.target.id === 'addSetpoint') addSetpointEditorRow();
    if (e.target && e.target.id === 'addStage') addStageEditorRow();
    if (e.target && e.target.id === 'deactivateRecipeBtn') deactivateCurrentRecipe();
    if (e.target === document.getElementById('recipeEditor')) closeRecipeEditor();
  });

  window.addSetpointEditorRow = addSetpointEditorRow;
  window.addStageEditorRow = addStageEditorRow;
  window.saveRecipeFromEditor = saveRecipeFromEditor;
  window.deactivateCurrentRecipe = deactivateCurrentRecipe;
})();
