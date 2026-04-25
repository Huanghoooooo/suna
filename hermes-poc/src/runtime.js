const EventEmitter = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertStoreAccess } = require('./auth');
const {
  buildInvoiceConfirmation,
  mapStaDetailToInvoiceDraft,
  mergeInvoiceFields,
  requiredInvoiceFields,
} = require('./shipment-invoice');
const { skillPath } = require('./skill-registry');
const { nowIso } = require('./store');
const { fetchStaInboundPlanDetail, generateInvoiceWithSkill, listInvoiceSheets } = require('./skill-runner');

function id(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickStoreGroup(message, user) {
  if (/欧洲|德国|EU|eu/i.test(message)) {
    return 'EU-DE';
  }
  if (/英国|UK|uk/i.test(message)) {
    return 'UK-LON';
  }
  if (/日本|JP|jp/i.test(message)) {
    return 'JP-TYO';
  }
  if (/美国|US|us|FBA/i.test(message)) {
    return 'US-CA';
  }
  return user.storeGroups[0];
}

function parseInvoiceParams(message, user) {
  const storeGroup = pickStoreGroup(message, user);
  const amountMatch = message.match(/(?:金额|amount|USD|RMB|CNY|¥|\$)\s*[:：]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  const count = /批量|多张|batch/i.test(message) ? 3 : 1;
  const customerMatch = message.match(/(?:客户|公司|customer)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,24})/);
  return {
    storeGroup,
    invoiceCount: count,
    customerName: customerMatch ? customerMatch[1] : 'Amazon FBA Customer',
    amount: amountMatch ? Number(amountMatch[1]).toFixed(2) : '1280.00',
    currency: /人民币|RMB|CNY|¥/.test(message) ? 'CNY' : 'USD',
    template: /盘古/.test(message) ? 'invoice-template-pangu' : 'invoice-template-standard',
    uploadTarget: storeGroup === 'EU-DE' ? 'Amazon EU Seller Central' : 'Amazon US Seller Central',
  };
}

function createStep(kind, label, detail, extra = {}) {
  return {
    id: id('step'),
    kind,
    label,
    detail,
    status: 'running',
    startedAt: nowIso(),
    completedAt: null,
    ...extra,
  };
}

class HermesPocRuntime extends EventEmitter {
  constructor({ store, audit, dataDir, tickMs = 420, staDetailProvider = fetchStaInboundPlanDetail }) {
    super();
    this.store = store;
    this.audit = audit;
    this.dataDir = dataDir;
    this.tickMs = tickMs;
    this.staDetailProvider = staDetailProvider;
    this.activeRuns = new Map();
  }

  status() {
    return {
      name: 'Hermes Runtime Adapter',
      mode: process.env.HERMES_BASE_URL ? 'hermes-openai-compatible' : 'mock-hermes',
      hermesBaseUrl: process.env.HERMES_BASE_URL || null,
      capabilities: [
        'agent.step.stream',
        'tool.call.visualization',
        'human.confirmation.card',
        'append.only.audit.chain',
        'per.user.workspace',
        'sta.invoice.followup',
      ],
      builtInSkills: [
        { name: 'invoice', path: skillPath('invoice') },
        { name: 'lingxing-sta-workflow', path: skillPath('lingxing-sta-workflow') },
        { name: 'lingxing-openapi', path: skillPath('lingxing-openapi') },
      ],
    };
  }

  async waitForIdle(taskId) {
    const run = this.activeRuns.get(taskId);
    if (run) {
      await run;
    }
  }

  async startInvoiceFlow({ user, message, skillId = 'invoice-auto-generate-upload' }) {
    const params = parseInvoiceParams(message, user);
    assertStoreAccess(user, params.storeGroup);

    const task = {
      id: id('task'),
      title: params.invoiceCount > 1 ? '批量发票生成与上传' : '发票生成与上传',
      module: 'invoice',
      skillId,
      ownerId: user.id,
      ownerName: user.name,
      department: user.department,
      storeGroup: params.storeGroup,
      status: 'running',
      message,
      params,
      confirmation: null,
      steps: [],
      files: [],
      retryCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await this.store.upsertTask(task);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'agent.message.created',
      subject: 'task',
      resource: { taskId: task.id, storeGroup: task.storeGroup },
      metadata: { skillId, module: task.module },
    });
    this.emitTask(task);

    const run = this.runPlanning(task.id, user).finally(() => this.activeRuns.delete(task.id));
    this.activeRuns.set(task.id, run);
    return task;
  }

  async startShipmentInvoiceSuggestion({
    user,
    sid,
    inboundPlanId,
    shipmentId = '',
    staDetail = null,
    skillId = 'sta-shipment-invoice-followup',
  }) {
    if (!sid || !inboundPlanId) {
      const error = new Error('sid and inboundPlanId are required');
      error.statusCode = 400;
      throw error;
    }

    const detailResponse =
      staDetail ||
      (await this.staDetailProvider({
        sid,
        inboundPlanId,
        shipmentId,
      }));
    const { detail, draft } = mapStaDetailToInvoiceDraft(detailResponse);
    draft.invoiceSheetOptions = await listInvoiceSheets();
    const requiredFields = requiredInvoiceFields(draft).map((field) =>
      field.name === 'sheet' ? { ...field, options: draft.invoiceSheetOptions } : field
    );
    const shipment = draft.shipment || {};
    shipment.sid = sid;
    const storeGroup = draft.storeGroup;
    assertStoreAccess(user, storeGroup);

    const task = {
      id: id('task'),
      title: `货件 ${shipment.shipmentConfirmationId || inboundPlanId} 发票跟进`,
      module: 'shipment_invoice',
      skillId,
      ownerId: user.id,
      ownerName: user.name,
      department: user.department,
      storeGroup,
      status: 'needs_confirmation',
      message: `STA ${inboundPlanId} 已生成 FBA 货件，等待确认是否开发票`,
      params: {
        sid,
        inboundPlanId,
        shipmentId: shipment.shipmentId || shipmentId,
        shipmentConfirmationId: shipment.shipmentConfirmationId,
        staDetail: detail,
        invoiceDraft: draft,
        missingInvoiceFields: requiredFields.map((item) => item.name),
      },
      confirmation: {
        id: id('confirm'),
        createdAt: nowIso(),
        ...buildInvoiceConfirmation({ draft, requiredFields }),
      },
      steps: [
        {
          id: id('step'),
          kind: 'tool',
          label: '读取 STA 详情',
          detail: `调用 inbound-plan/detail 读取 ${inboundPlanId}`,
          status: 'done',
          startedAt: nowIso(),
          completedAt: nowIso(),
          toolName: 'lingxing.sta.inbound_plan.detail',
        },
        {
          id: id('step'),
          kind: 'tool',
          label: '识别货件完成点',
          detail: `已获得 FBA 号 ${shipment.shipmentConfirmationId || '-'}`,
          status: 'done',
          startedAt: nowIso(),
          completedAt: nowIso(),
        },
        {
          id: id('step'),
          kind: 'reasoning',
          label: '生成发票建议',
          detail:
            requiredFields.length > 0
              ? `需补齐 ${requiredFields.map((item) => item.label).join('、')}`
              : 'STA 数据已足够生成发票',
          status: requiredFields.length > 0 ? 'warning' : 'done',
          startedAt: nowIso(),
          completedAt: nowIso(),
        },
      ],
      files: [],
      retryCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await this.store.upsertTask(task);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'sta.detail.read',
      subject: 'tool',
      resource: {
        taskId: task.id,
        inboundPlanId,
        shipmentId: task.params.shipmentId,
      },
      metadata: {
        storeGroup,
        sid,
        shipmentConfirmationId: shipment.shipmentConfirmationId,
      },
    });
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'confirmation.required',
      subject: 'task',
      resource: { taskId: task.id, confirmationId: task.confirmation.id },
      metadata: {
        riskLevel: task.confirmation.riskLevel,
        type: task.confirmation.type,
        missingInvoiceFields: task.params.missingInvoiceFields,
      },
    });
    this.emitTask(task);
    return task;
  }

  async addStep(taskId, step) {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    task.steps.push(step);
    task.updatedAt = nowIso();
    await this.store.upsertTask(task);
    this.emitTask(task);
    return step;
  }

  async finishStep(taskId, stepId, detail, status = 'done') {
    const task = await this.store.getTask(taskId);
    const step = task.steps.find((item) => item.id === stepId);
    step.status = status;
    step.detail = detail || step.detail;
    step.completedAt = nowIso();
    task.updatedAt = nowIso();
    await this.store.upsertTask(task);
    this.emitTask(task);
    return step;
  }

  async runPlanning(taskId, user) {
    const task = await this.store.getTask(taskId);
    const intentStep = await this.addStep(
      taskId,
      createStep('reasoning', '意图识别', '识别发票生成、归档与上传任务')
    );
    await delay(this.tickMs);
    await this.finishStep(taskId, intentStep.id, '已路由到发票闭环 Skill');

    const paramStep = await this.addStep(
      taskId,
      createStep('extract', '参数提取', `店铺组 ${task.storeGroup}，发票数量 ${task.params.invoiceCount}`)
    );
    await delay(this.tickMs);
    await this.finishStep(taskId, paramStep.id, '关键参数已结构化');

    const validateStep = await this.addStep(
      taskId,
      createStep('tool', 'ERP 参数校验', '调用 lingxing.erp.validate_invoice_context', {
        toolName: 'lingxing.erp.validate_invoice_context',
      })
    );
    await delay(this.tickMs);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'tool.call.completed',
      subject: 'tool',
      resource: { taskId, toolName: validateStep.toolName },
      metadata: { storeGroup: task.storeGroup, dryRun: true },
    });
    await this.finishStep(taskId, validateStep.id, 'ERP 校验通过，等待人工确认');

    const latest = await this.store.getTask(taskId);
    latest.status = 'needs_confirmation';
    latest.confirmation = {
      id: id('confirm'),
      title: '确认生成并上传发票',
      riskLevel: 'high',
      createdAt: nowIso(),
      parameters: [
        { label: '店铺组', value: latest.params.storeGroup },
        { label: '模板', value: latest.params.template },
        { label: '数量', value: `${latest.params.invoiceCount}` },
        { label: '金额', value: `${latest.params.currency} ${latest.params.amount}` },
        { label: '上传目标', value: latest.params.uploadTarget },
      ],
    };
    latest.updatedAt = nowIso();
    await this.store.upsertTask(latest);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'confirmation.required',
      subject: 'task',
      resource: { taskId, confirmationId: latest.confirmation.id },
      metadata: { riskLevel: latest.confirmation.riskLevel },
    });
    this.emitTask(latest);
  }

  async confirmTask({ user, taskId, confirmationId, fields = {} }) {
    const task = await this.store.getTask(taskId);
    if (!task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }
    if (task.ownerId !== user.id && user.role !== 'Meta') {
      const error = new Error('Only the owner or Meta can confirm this write operation');
      error.statusCode = 403;
      throw error;
    }
    if (task.status !== 'needs_confirmation' || !task.confirmation) {
      const error = new Error('Task is not waiting for confirmation');
      error.statusCode = 409;
      throw error;
    }
    if (confirmationId && confirmationId !== task.confirmation.id) {
      const error = new Error('Confirmation id mismatch');
      error.statusCode = 409;
      throw error;
    }
    assertStoreAccess(user, task.storeGroup);

    let invoiceInput = null;
    if (task.confirmation.type === 'shipment_invoice_followup') {
      invoiceInput = mergeInvoiceFields(task.params.invoiceDraft, fields);
    }

    task.status = 'running';
    task.confirmation.confirmedAt = nowIso();
    task.confirmation.confirmedBy = user.id;
    if (invoiceInput) {
      task.params.invoiceInput = invoiceInput;
    }
    task.updatedAt = nowIso();
    await this.store.upsertTask(task);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'user.confirmed.write',
      subject: 'task',
      resource: { taskId, confirmationId: task.confirmation.id },
      metadata: { riskLevel: task.confirmation.riskLevel },
    });
    this.emitTask(task);

    const run =
      task.confirmation.type === 'shipment_invoice_followup'
        ? this.runShipmentInvoiceCommit(taskId, user).finally(() => this.activeRuns.delete(taskId))
        : this.runCommit(taskId, user).finally(() => this.activeRuns.delete(taskId));
    this.activeRuns.set(taskId, run);
    return task;
  }

  async cancelTask({ user, taskId }) {
    const task = await this.store.getTask(taskId);
    if (!task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }
    if (task.ownerId !== user.id && user.role !== 'Meta') {
      const error = new Error('Only the owner or Meta can cancel this task');
      error.statusCode = 403;
      throw error;
    }
    task.status = 'canceled';
    task.updatedAt = nowIso();
    await this.store.upsertTask(task);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'task.canceled',
      subject: 'task',
      resource: { taskId },
      metadata: {},
    });
    this.emitTask(task);
    return task;
  }

  async runShipmentInvoiceCommit(taskId, user) {
    const task = await this.store.getTask(taskId);
    const invoiceInput = task.params.invoiceInput;
    const invoiceStep = await this.addStep(
      taskId,
      createStep('tool', '生成发票 XLSX', '调用 GENERAL-KNOWLEDGE-WORKER/invoice/generate.py', {
        toolName: 'invoice.generate_xlsx',
      })
    );
    await delay(this.tickMs);

    const generated = await generateInvoiceWithSkill({
      store: invoiceInput.store,
      country: invoiceInput.country,
      sheet: invoiceInput.sheet,
      orderNumber: invoiceInput.orderNumber,
      invoiceNumber: invoiceInput.invoiceNumber,
      invoiceDate: invoiceInput.invoiceDate,
      deliveryDate: invoiceInput.deliveryDate,
      customerInfo: invoiceInput.customerInfo,
      productDescription: invoiceInput.productDescription,
      quantity: invoiceInput.quantity,
      unitPrice: invoiceInput.unitPrice,
      currency: invoiceInput.currency,
    });
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'tool.call.completed',
      subject: 'tool',
      resource: { taskId, toolName: invoiceStep.toolName },
      metadata: {
        skill: 'GENERAL-KNOWLEDGE-WORKER/invoice',
        inboundPlanId: task.params.inboundPlanId,
        shipmentConfirmationId: task.params.shipmentConfirmationId,
      },
    });

    const safeInvoiceNo = invoiceInput.invoiceNumber.replace(/[<>:"/\\|?*]/g, '-');
    const relativePath = path.join(user.id, task.id, `${safeInvoiceNo}.xlsx`);
    const absolutePath = path.join(this.store.fileRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.copyFile(generated.generatedPath, absolutePath);
    const stat = await fs.stat(absolutePath);
    const file = {
      id: id('file'),
      taskId,
      ownerId: task.ownerId,
      department: task.department,
      storeGroup: task.storeGroup,
      name: `${safeInvoiceNo}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      relativePath,
      size: stat.size,
      createdAt: nowIso(),
      source: {
        skill: 'GENERAL-KNOWLEDGE-WORKER/invoice',
        generatedPath: generated.generatedPath,
        inboundPlanId: task.params.inboundPlanId,
        shipmentId: task.params.shipmentId,
        shipmentConfirmationId: task.params.shipmentConfirmationId,
      },
    };
    await this.store.addFile(file);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'file.created',
      subject: 'file',
      resource: { taskId, fileId: file.id, name: file.name },
      metadata: {
        storeGroup: task.storeGroup,
        skill: file.source.skill,
        inboundPlanId: task.params.inboundPlanId,
        shipmentConfirmationId: task.params.shipmentConfirmationId,
      },
    });
    await this.finishStep(taskId, invoiceStep.id, `已为 ${task.params.shipmentConfirmationId} 生成并归档 ${file.name}`);

    const completed = await this.store.getTask(taskId);
    completed.status = 'completed';
    completed.updatedAt = nowIso();
    await this.store.upsertTask(completed);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'task.completed',
      subject: 'task',
      resource: { taskId },
      metadata: {
        module: completed.module,
        inboundPlanId: completed.params.inboundPlanId,
        shipmentConfirmationId: completed.params.shipmentConfirmationId,
      },
    });
    this.emitTask(completed);
  }

  async runCommit(taskId, user) {
    const task = await this.store.getTask(taskId);
    const invoiceStep = await this.addStep(
      taskId,
      createStep('tool', '生成发票 XLSX', '调用 GENERAL-KNOWLEDGE-WORKER/invoice/generate.py', {
        toolName: 'invoice.generate_xlsx',
      })
    );
    await delay(this.tickMs);

    const invoiceNo = `RO-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${task.id.slice(-6)}`;
    const orderNo = `TEST-${task.id.slice(-12)}`;
    const generated = await generateInvoiceWithSkill({
      store: '崔佳佳',
      country: '德国',
      orderNumber: orderNo,
      invoiceNumber: invoiceNo,
      invoiceDate: new Date().toISOString().slice(0, 10),
      deliveryDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customerInfo: `${task.params.customerName}\nStreet 1\nBerlin\n10115\nGermany`,
      productDescription: 'Hermes POC invoice validation item',
      quantity: task.params.invoiceCount,
      unitPrice: task.params.amount,
      currency: task.params.currency === 'CNY' ? 'EUR' : task.params.currency,
    });

    const relativePath = path.join(user.id, task.id, `${invoiceNo}.xlsx`);
    const absolutePath = path.join(this.store.fileRoot, relativePath);
    await require('node:fs/promises').mkdir(path.dirname(absolutePath), { recursive: true });
    await require('node:fs/promises').copyFile(generated.generatedPath, absolutePath);
    const stat = await require('node:fs/promises').stat(absolutePath);
    const file = {
      id: id('file'),
      taskId,
      ownerId: task.ownerId,
      department: task.department,
      storeGroup: task.storeGroup,
      name: `${invoiceNo}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      relativePath,
      size: stat.size,
      createdAt: nowIso(),
      source: {
        skill: 'GENERAL-KNOWLEDGE-WORKER/invoice',
        generatedPath: generated.generatedPath,
      },
    };
    await this.store.addFile(file);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'file.created',
      subject: 'file',
      resource: { taskId, fileId: file.id, name: file.name },
      metadata: {
        storeGroup: task.storeGroup,
        skill: file.source.skill,
        generatedPath: generated.generatedPath,
      },
    });
    await this.finishStep(taskId, invoiceStep.id, `已由 invoice skill 生成并归档 ${file.name}`);

    const apiStep = await this.addStep(
      taskId,
      createStep('tool', '上传至平台 API', '调用 seller.invoice.upload', {
        toolName: 'seller.invoice.upload',
      })
    );
    await delay(this.tickMs);
    const latest = await this.store.getTask(taskId);
    latest.retryCount += 1;
    await this.store.upsertTask(latest);
    await this.finishStep(taskId, apiStep.id, 'API 返回临时限流，进入浏览器自动化兜底', 'warning');

    const browserStep = await this.addStep(
      taskId,
      createStep('tool', '浏览器自动化兜底上传', '调用 browser.use.upload_invoice', {
        toolName: 'browser.use.upload_invoice',
      })
    );
    await delay(this.tickMs);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'tool.call.completed',
      subject: 'tool',
      resource: { taskId, toolName: browserStep.toolName },
      metadata: { fallback: true, retryCount: 1 },
    });
    await this.finishStep(taskId, browserStep.id, '上传完成，平台状态已回写');

    const completed = await this.store.getTask(taskId);
    completed.status = 'completed';
    completed.updatedAt = nowIso();
    await this.store.upsertTask(completed);
    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      department: user.department,
      action: 'task.completed',
      subject: 'task',
      resource: { taskId },
      metadata: { module: completed.module, retryCount: completed.retryCount },
    });
    this.emitTask(completed);
  }

  emitTask(task) {
    this.emit('task', {
      type: 'task.updated',
      task,
    });
  }
}

module.exports = {
  HermesPocRuntime,
  parseInvoiceParams,
};
