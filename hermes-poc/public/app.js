const state = {
  token: localStorage.getItem('wutong.poc.token'),
  user: null,
  users: [],
  tasks: [],
  files: [],
  audit: [],
  metrics: {},
  selectedTaskId: null,
  stream: null,
};

const els = {
  userSelect: document.querySelector('#userSelect'),
  userMeta: document.querySelector('#userMeta'),
  runtimeMode: document.querySelector('#runtimeMode'),
  taskTimeline: document.querySelector('#taskTimeline'),
  messageForm: document.querySelector('#messageForm'),
  messageInput: document.querySelector('#messageInput'),
  taskList: document.querySelector('#taskList'),
  fileList: document.querySelector('#fileList'),
  auditList: document.querySelector('#auditList'),
  metricsGrid: document.querySelector('#metricsGrid'),
  auditHealth: document.querySelector('#auditHealth'),
  themeToggle: document.querySelector('#themeToggle'),
  refreshBtn: document.querySelector('#refreshBtn'),
  activeModuleLabel: document.querySelector('#activeModuleLabel'),
};

const moduleLabels = {
  workbench: '发票闭环任务',
  invoice: '发票生成、归档与上传',
  shipment: 'FBA 货件流程预留',
  files: '文件归档',
  tasks: '任务状态',
  audit: '审计追踪',
};

function clsStatus(status) {
  return `status-${String(status || '').replaceAll(' ', '_')}`;
}

function formatStatus(status) {
  return {
    running: '执行中',
    needs_confirmation: '待确认',
    completed: '已完成',
    canceled: '已取消',
    failed: '失败',
    done: '完成',
    warning: '重试',
  }[status] || status;
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return response.json();
}

async function login(userId) {
  const payload = await api('/api/auth/login', {
    method: 'POST',
    body: { userId },
  });
  state.token = payload.token;
  state.user = payload.user;
  localStorage.setItem('wutong.poc.token', state.token);
  localStorage.setItem('wutong.poc.userId', state.user.id);
  connectStream();
  await refreshAll();
}

async function loadUsers() {
  const payload = await api('/api/users');
  state.users = payload.users;
  els.userSelect.innerHTML = state.users
    .map((user) => `<option value="${user.id}">${user.name} · ${user.role}</option>`)
    .join('');
  if (!state.token) {
    await login(state.users[0].id);
  } else {
    const savedUserId = localStorage.getItem('wutong.poc.userId');
    state.user = state.users.find((user) => user.id === savedUserId) || state.users[0];
    try {
      await refreshAll();
    } catch {
      await login(state.user.id);
    }
  }
}

function connectStream() {
  if (state.stream) {
    state.stream.close();
  }
  if (!state.token) {
    return;
  }
  state.stream = new EventSource(`/api/stream?token=${encodeURIComponent(state.token)}`);
  state.stream.addEventListener('task.updated', (event) => {
    const payload = JSON.parse(event.data);
    upsertTask(payload.task);
    render();
    refreshSidePanels();
  });
}

function upsertTask(task) {
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) {
    state.tasks[index] = task;
  } else {
    state.tasks.unshift(task);
  }
  state.selectedTaskId = task.id;
}

async function refreshAll() {
  const [runtime, tasks, files, audit, verify, metrics] = await Promise.all([
    api('/api/runtime'),
    api('/api/tasks'),
    api('/api/files'),
    api('/api/audit'),
    api('/api/audit/verify'),
    api('/api/metrics'),
  ]);
  state.tasks = tasks.tasks;
  state.files = files.files;
  state.audit = audit.events;
  state.metrics = metrics.metrics;
  if (!state.selectedTaskId && state.tasks[0]) {
    state.selectedTaskId = state.tasks[0].id;
  }
  els.runtimeMode.textContent = runtime.mode;
  els.auditHealth.textContent = verify.ok ? `审计链 ${verify.count}` : '审计异常';
  els.auditHealth.className = `status-pill ${verify.ok ? 'status-completed' : 'status-failed'}`;
  render();
}

async function refreshSidePanels() {
  const [tasks, files, audit, verify, metrics] = await Promise.all([
    api('/api/tasks'),
    api('/api/files'),
    api('/api/audit'),
    api('/api/audit/verify'),
    api('/api/metrics'),
  ]);
  state.tasks = tasks.tasks;
  state.files = files.files;
  state.audit = audit.events;
  state.metrics = metrics.metrics;
  els.auditHealth.textContent = verify.ok ? `审计链 ${verify.count}` : '审计异常';
  els.auditHealth.className = `status-pill ${verify.ok ? 'status-completed' : 'status-failed'}`;
  render();
}

function selectedTask() {
  return state.tasks.find((task) => task.id === state.selectedTaskId) || state.tasks[0] || null;
}

function renderUser() {
  if (!state.user) return;
  els.userSelect.value = state.user.id;
  els.userMeta.textContent = `${state.user.department} · ${state.user.storeGroups.join(', ')}`;
}

function renderTimeline() {
  const task = selectedTask();
  if (!task) {
    els.taskTimeline.innerHTML = '<div class="empty-state">暂无任务</div>';
    return;
  }

  const steps = task.steps
    .map(
      (step, index) => `
        <div class="step-row">
          <div class="step-dot">${index + 1}</div>
          <div>
            <div class="step-title">${step.label}</div>
            <div class="step-detail">
              ${step.detail}
              ${step.toolName ? `<span class="tool-name"> · ${step.toolName}</span>` : ''}
            </div>
          </div>
          <span class="status-pill ${clsStatus(step.status)}">${formatStatus(step.status)}</span>
        </div>
      `
    )
    .join('');

  const confirmation =
    task.status === 'needs_confirmation' && task.confirmation
      ? `
        <div class="confirmation-card">
          <h3>${task.confirmation.title}</h3>
          <div class="confirm-grid">
            ${task.confirmation.parameters
              .map(
                (param) => `
                  <div class="confirm-param">
                    <span>${param.label}</span>
                    <strong>${param.value}</strong>
                  </div>
                `
              )
              .join('')}
          </div>
          ${renderConfirmationFields(task.confirmation.fields || [])}
          <div class="confirm-actions">
            <button class="primary-btn" type="button" data-confirm="${task.id}">确认执行</button>
            <button class="danger-btn" type="button" data-cancel="${task.id}">拒绝</button>
          </div>
        </div>
      `
      : '';

  els.taskTimeline.innerHTML = `
    <article class="task-card">
      <div class="task-head">
        <div>
          <h2>${task.title}</h2>
          <div class="task-meta">
            ${task.ownerName} · ${task.storeGroup} · ${formatTime(task.createdAt)}
          </div>
        </div>
        <span class="status-pill ${clsStatus(task.status)}">${formatStatus(task.status)}</span>
      </div>
      <div class="steps">${steps || '<div class="step-detail">等待 Runtime 状态流</div>'}</div>
      ${confirmation}
    </article>
  `;
}

function renderConfirmationFields(fields) {
  if (!fields.length) {
    return '';
  }
  return `
    <div class="confirm-fields">
      ${fields.map(renderConfirmationField).join('')}
    </div>
  `;
}

function renderConfirmationField(field) {
  const required = field.required ? 'required' : '';
  const placeholder = field.reason || field.label;
  if (field.inputType === 'select') {
    return `
      <label class="confirm-field">
        <span>${field.label}</span>
        <select data-confirm-field="${field.name}" ${required}>
          <option value="">请选择</option>
          ${(field.options || []).map((option) => `<option value="${option}">${option}</option>`).join('')}
        </select>
      </label>
    `;
  }
  if (field.inputType === 'textarea') {
    return `
      <label class="confirm-field">
        <span>${field.label}</span>
        <textarea rows="3" data-confirm-field="${field.name}" placeholder="${placeholder}" ${required}></textarea>
      </label>
    `;
  }
  return `
    <label class="confirm-field">
      <span>${field.label}</span>
      <input type="${field.inputType || 'text'}" data-confirm-field="${field.name}" placeholder="${placeholder}" ${required} />
    </label>
  `;
}

function renderMetrics() {
  const metrics = [
    ['今日利润', `¥${Number(state.metrics.profitToday || 0).toLocaleString('zh-CN')}`],
    ['费用概览', `¥${Number(state.metrics.expenseToday || 0).toLocaleString('zh-CN')}`],
    ['汇率', state.metrics.exchangeRate || '-'],
    ['待确认', state.metrics.waitingConfirmations || 0],
    ['发票任务', state.metrics.pendingInvoices || 0],
    ['异常预警', state.metrics.shipmentWarnings || 0],
  ];
  els.metricsGrid.innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <div class="compact-meta">${label}</div>
          <div class="metric-value">${value}</div>
        </div>
      `
    )
    .join('');
}

function renderTaskList() {
  els.taskList.innerHTML =
    state.tasks
      .map(
        (task) => `
          <button class="compact-item ${task.id === state.selectedTaskId ? 'active' : ''}" data-select-task="${task.id}">
            <div class="compact-title">${task.title}</div>
            <div class="compact-meta">${task.storeGroup} · ${formatStatus(task.status)} · ${formatTime(task.updatedAt)}</div>
          </button>
        `
      )
      .join('') || '<div class="compact-meta">暂无任务</div>';
}

function renderFiles() {
  els.fileList.innerHTML =
    state.files
      .map(
        (file) => `
          <div class="compact-item">
            <div class="compact-title">${file.name}</div>
            <div class="compact-meta">${file.storeGroup} · ${formatTime(file.createdAt)}</div>
            <div class="file-actions">
              <button class="link-button" type="button" data-download="${file.id}">下载</button>
            </div>
          </div>
        `
      )
      .join('') || '<div class="compact-meta">暂无文件</div>';
}

function renderAudit() {
  els.auditList.innerHTML =
    state.audit
      .slice(0, 10)
      .map(
        (event) => `
          <div class="audit-item">
            <div class="audit-action">${event.action}</div>
            <div class="audit-meta">${event.actorId} · ${formatTime(event.timestamp)}</div>
          </div>
        `
      )
      .join('') || '<div class="audit-meta">暂无审计事件</div>';
}

function render() {
  renderUser();
  renderTimeline();
  renderMetrics();
  renderTaskList();
  renderFiles();
  renderAudit();
}

async function downloadFile(fileId) {
  const response = await fetch(`/api/files/${fileId}/download`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!response.ok) {
    throw new Error('文件下载失败');
  }
  const blob = await response.blob();
  const file = state.files.find((item) => item.id === fileId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file ? file.name : 'wutong-file.pdf';
  anchor.click();
  URL.revokeObjectURL(url);
  await refreshSidePanels();
}

function collectConfirmationFields(container) {
  const fields = {};
  container.querySelectorAll('[data-confirm-field]').forEach((input) => {
    fields[input.dataset.confirmField] = input.value;
  });
  return fields;
}

document.body.addEventListener('click', async (event) => {
  const confirmId = event.target.dataset.confirm;
  const cancelId = event.target.dataset.cancel;
  const selectTaskId = event.target.closest('[data-select-task]')?.dataset.selectTask;
  const downloadId = event.target.dataset.download;

  try {
    if (confirmId) {
      const task = state.tasks.find((item) => item.id === confirmId);
      const card = event.target.closest('.confirmation-card');
      await api(`/api/tasks/${confirmId}/confirm`, {
        method: 'POST',
        body: {
          confirmationId: task.confirmation.id,
          fields: card ? collectConfirmationFields(card) : {},
        },
      });
      await refreshSidePanels();
    } else if (cancelId) {
      await api(`/api/tasks/${cancelId}/cancel`, { method: 'POST' });
      await refreshSidePanels();
    } else if (selectTaskId) {
      state.selectedTaskId = selectTaskId;
      render();
    } else if (downloadId) {
      await downloadFile(downloadId);
    }
  } catch (error) {
    alert(error.message);
  }
});

els.messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = els.messageInput.value.trim();
  if (!message) return;
  els.messageInput.value = '';
  try {
    const payload = await api('/api/agent/message', {
      method: 'POST',
      body: { message },
    });
    upsertTask(payload.task);
    render();
  } catch (error) {
    alert(error.message);
  }
});

els.userSelect.addEventListener('change', async () => {
  await login(els.userSelect.value);
});

els.refreshBtn.addEventListener('click', refreshAll);

els.themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('wutong.poc.theme', isDark ? 'dark' : 'light');
  els.themeToggle.textContent = isDark ? '浅色模式' : '深色模式';
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    els.activeModuleLabel.textContent = moduleLabels[button.dataset.module] || moduleLabels.workbench;
  });
});

if (localStorage.getItem('wutong.poc.theme') === 'dark') {
  document.body.classList.add('dark');
  els.themeToggle.textContent = '浅色模式';
}

loadUsers().catch((error) => {
  els.taskTimeline.innerHTML = `<div class="empty-state">${error.message}</div>`;
});
