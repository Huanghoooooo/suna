const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const { AuditLog } = require('../src/audit');
const { publicUser, signJwt, verifyJwt } = require('../src/auth');
const { HermesPocRuntime } = require('../src/runtime');
const { listInvoiceSheets, listInvoiceStores, runStaDryRun } = require('../src/skill-runner');
const { listBuiltInSkills, skillPath } = require('../src/skill-registry');
const { Store } = require('../src/store');

const execFileAsync = promisify(execFile);
const PYTHON = process.env.WUTONG_PYTHON || 'C:\\Users\\Jiach\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';

const STA_DETAIL_FIXTURE = {
  code: 0,
  message: '操作成功',
  data: {
    inboundPlanId: 'wf8b30779b-5ee9-40f4-8b07-76aab53790c8',
    planName: 'FBA STA(Q9-CH-1-US-WZ)-20260425',
    status: 'ACTIVE',
    gmtModified: '2026-04-26 01:01',
    shipmentList: [
      {
        shipmentId: 'sh4f351596-1555-473e-afd2-f23db87deeb6',
        shipmentConfirmationId: 'FBA19C7FVTJF',
        status: 'WORKING',
      },
    ],
    addressVO: {
      countryCode: 'US',
      city: 'Los Angeles',
      stateOrProvinceCode: 'CA',
      postalCode: '90001',
      shipperName: 'Test Sender',
    },
    productList: [
      {
        msku: 'Q9-CH',
        fnsku: 'X004HUQFDV',
        asin: 'B0DQ15JY88',
        title: '6-Sheet Super Micro Cut Paper Shredder',
        quantity: 1,
      },
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function makeRuntime(runtimeOptions = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wutong-hermes-poc-'));
  const store = new Store(dataDir);
  const audit = new AuditLog(path.join(dataDir, 'audit.jsonl'));
  const runtime = new HermesPocRuntime({ store, audit, dataDir, tickMs: 0, ...runtimeOptions });
  return { dataDir, store, audit, runtime };
}

test('JWT demo token carries role and store scope', () => {
  const token = signJwt('employee-li', 'test-secret');
  const user = verifyJwt(token, 'test-secret');
  assert.equal(user.id, 'employee-li');
  assert.equal(user.role, 'Employee');
  assert.deepEqual(user.storeGroups, ['US-CA']);
});

test('audit log is append-only and hash-chain verifiable', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wutong-audit-'));
  const audit = new AuditLog(path.join(dataDir, 'audit.jsonl'));
  await audit.append({
    actorId: 'meta-001',
    actorRole: 'Meta',
    department: 'Platform',
    action: 'user.login',
    subject: 'user',
  });
  await audit.append({
    actorId: 'meta-001',
    actorRole: 'Meta',
    department: 'Platform',
    action: 'task.completed',
    subject: 'task',
  });
  const result = await audit.verify();
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
});

test('built-in skills are self-contained under hermes-poc', async () => {
  const skills = await listBuiltInSkills();
  assert.deepEqual(
    skills.map((skill) => skill.name).sort(),
    ['invoice', 'lingxing-openapi', 'lingxing-sta-workflow']
  );
  for (const skill of skills) {
    assert.equal(skill.path.includes(`${path.sep}hermes-poc${path.sep}skills${path.sep}`), true);
    assert.equal(skill.path.includes(`${path.sep}core${path.sep}kortix-master${path.sep}opencode${path.sep}skills${path.sep}`), false);
  }

  await fs.access(path.join(skillPath('invoice'), 'generate.py'));
  await fs.access(path.join(skillPath('lingxing-sta-workflow'), 'scripts', 'sta_api_caller.py'));
  await fs.access(path.join(skillPath('lingxing-openapi'), 'data', 'api_registry.json'));
});

test('invoice skill lists stores and all business sheets', async () => {
  const stores = await listInvoiceStores();
  assert.equal(stores.length, 17);
  assert.equal(stores.includes('崔佳佳'), true);
  const mirajSheets = await listInvoiceSheets({ store: 'MIRAJ' });
  assert.equal(mirajSheets.includes('波兰'), true);
  assert.equal(mirajSheets.includes('德语发票'), true);
  assert.equal(mirajSheets.includes('税率计算'), false);
});

test('source code no longer depends on suna skill paths', async () => {
  const files = [
    path.join(__dirname, '..', 'server.js'),
    path.join(__dirname, '..', 'src', 'skill-runner.js'),
    path.join(__dirname, '..', 'src', 'runtime.js'),
    path.join(__dirname, '..', 'tests', 'poc.test.js'),
  ];
  const forbiddenPaths = [
    ['suna', 'core', 'kortix-master', 'opencode', 'skills'].join('\\'),
    ['suna', 'core', 'kortix-master', 'opencode', 'skills'].join('/'),
  ];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    for (const forbiddenPath of forbiddenPaths) {
      assert.equal(text.includes(forbiddenPath), false);
    }
  }
});

test('LingXing OpenAPI bundled search and dry-run tools work', async () => {
  const openapiDir = skillPath('lingxing-openapi');
  const search = await execFileAsync(PYTHON, ['scripts/search_api.py', '店铺列表', '--json'], {
    cwd: openapiDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  const results = JSON.parse(search.stdout);
  assert.equal(results.length > 0, true);
  assert.equal(results.some((item) => item.api_path === '/erp/sc/data/seller/lists'), true);

  const details = await execFileAsync(
    PYTHON,
    ['scripts/search_api_details.py', '店铺列表', '--api-path', '/erp/sc/data/seller/lists'],
    {
      cwd: openapiDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    }
  );
  assert.match(details.stdout, /\/erp\/sc\/data\/seller\/lists/);

  const dryRun = await execFileAsync(
    PYTHON,
    ['scripts/call_api.py', '--api-path', '/erp/sc/data/seller/lists', '--params', '{}', '--dry-run'],
    {
      cwd: openapiDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        LINGXING_APP_ID: '1234567890abcdef',
        LINGXING_ACCESS_TOKEN: 'token-test',
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    }
  );
  const request = JSON.parse(dryRun.stdout);
  assert.equal(request.request.url, 'https://openapi.lingxingerp.com/erp/sc/data/seller/lists');
  assert.equal(Boolean(request.request.query.sign), true);
});

test('invoice write cannot run before explicit confirmation', async () => {
  const { store, runtime } = await makeRuntime();
  const user = publicUser({
    id: 'employee-li',
    name: '李运营',
    role: 'Employee',
    department: 'FBA',
    storeGroups: ['US-CA'],
  });

  const task = await runtime.startInvoiceFlow({
    user,
    message: '生成美国店铺 1 张金额 1280 的发票并上传',
  });
  await runtime.waitForIdle(task.id);
  const waiting = await store.getTask(task.id);
  assert.equal(waiting.status, 'needs_confirmation');
  assert.equal(waiting.files.length, 0);

  await runtime.confirmTask({
    user,
    taskId: task.id,
    confirmationId: waiting.confirmation.id,
  });
  await runtime.waitForIdle(task.id);
  const completed = await store.getTask(task.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.files.length, 1);
});

test('employee store scope blocks cross-store invoice task', async () => {
  const { runtime } = await makeRuntime();
  const user = publicUser({
    id: 'employee-li',
    name: '李运营',
    role: 'Employee',
    department: 'FBA',
    storeGroups: ['US-CA'],
  });

  await assert.rejects(
    () =>
      runtime.startInvoiceFlow({
        user,
        message: '生成欧洲店铺 1 张发票并上传',
      }),
    /cannot access store group EU-DE/
  );
});

test('Hermes POC can invoke STA skill entrypoint in dry-run mode', async () => {
  const { result } = await runStaDryRun();
  assert.equal(result.dry_run, true);
  assert.equal(
    result.request.url,
    'https://openapi.lingxingerp.com/amzStaServer/openapi/inbound-packing/setPackingInformation'
  );
  assert.equal(Boolean(result.request.query.sign), true);
  assert.equal(result.request.body.packageGroupings[0].boxes[0].items[0].msku, 'Q9-CH');
});

test('STA completion suggests invoice and requires missing US invoice fields', async () => {
  const { store, audit, runtime } = await makeRuntime({
    staDetailProvider: async () => clone(STA_DETAIL_FIXTURE),
  });
  const user = publicUser({
    id: 'employee-li',
    name: '李运营',
    role: 'Employee',
    department: 'FBA',
    storeGroups: ['US-CA'],
  });

  const task = await runtime.startShipmentInvoiceSuggestion({
    user,
    sid: 18426,
    inboundPlanId: 'wf8b30779b-5ee9-40f4-8b07-76aab53790c8',
  });
  assert.equal(task.status, 'needs_confirmation');
  assert.equal(task.params.shipmentConfirmationId, 'FBA19C7FVTJF');
  assert.equal(task.confirmation.type, 'shipment_invoice_followup');
  const sheetField = task.confirmation.fields.find((item) => item.name === 'sheet');
  assert.equal(Boolean(sheetField), true);
  assert.equal(sheetField.options.includes('德语发票'), true);
  assert.equal(task.confirmation.fields.some((item) => item.name === 'unitPrice'), true);

  await assert.rejects(
    () =>
      runtime.confirmTask({
        user,
        taskId: task.id,
        confirmationId: task.confirmation.id,
      }),
    /Missing invoice fields/
  );
  const stillWaiting = await store.getTask(task.id);
  assert.equal(stillWaiting.status, 'needs_confirmation');
  assert.equal(stillWaiting.files.length, 0);

  await runtime.confirmTask({
    user,
    taskId: task.id,
    confirmationId: task.confirmation.id,
    fields: {
      store: '崔佳佳',
      sheet: '德国',
      customerInfo: 'Amazon Business Customer\nStreet 1\nBerlin\n10115\nGermany',
      unitPrice: '89.99',
      currency: 'EUR',
    },
  });
  await runtime.waitForIdle(task.id);
  const completed = await store.getTask(task.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.files.length, 1);
  assert.equal(completed.params.invoiceInput.sheet, '德国');
  assert.equal(completed.params.invoiceInput.orderNumber, 'FBA19C7FVTJF');
  assert.equal(completed.params.invoiceInput.country, '德国');
  assert.equal((await audit.verify()).ok, true);
});

test('canceling STA invoice suggestion does not generate files', async () => {
  const { store, runtime } = await makeRuntime({
    staDetailProvider: async () => clone(STA_DETAIL_FIXTURE),
  });
  const user = publicUser({
    id: 'employee-li',
    name: '李运营',
    role: 'Employee',
    department: 'FBA',
    storeGroups: ['US-CA'],
  });

  const task = await runtime.startShipmentInvoiceSuggestion({
    user,
    sid: 18426,
    inboundPlanId: 'wf8b30779b-5ee9-40f4-8b07-76aab53790c8',
  });
  await runtime.cancelTask({ user, taskId: task.id });
  const canceled = await store.getTask(task.id);
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.files.length, 0);
});

test('invoice generator handles representative sheet layouts', async () => {
  const script = path.join(skillPath('invoice'), 'generate.py');
  const cases = [
    ['崔佳佳', '德国', 'TEST-STANDARD-8', 'EUR'],
    ['盘古', '英国', 'TEST-PANGU-7', 'GBP'],
    ['珍有钱', '西班牙', 'TEST-ZYQ-5', 'EUR'],
    ['MIRAJ', '波兰', 'TEST-POLAND', 'EUR'],
    ['MIRAJ', '德语发票', 'TEST-GERMAN-SHEET', 'EUR'],
    ['ROB', '贷记单', 'TEST-CREDIT', 'EUR', '--credit-note'],
  ];

  for (const [store, sheet, order, currency, extra] of cases) {
    const args = [
      script,
      '--store',
      store,
      '--sheet',
      sheet,
      '--order',
      order,
      '--invoice-num',
      `INV-${order}`,
      '--date',
      '2026-04-26',
      '--delivery',
      '2026-04-25',
      '--customer',
      'Test Customer GmbH\\nStreet 1\\nBerlin\\n10115',
      '--product',
      'Template validation item',
      '--qty',
      '2',
      '--price',
      '12.34',
      '--currency',
      currency,
    ];
    if (extra) {
      args.push(extra);
    }
    const { stdout } = await execFileAsync(PYTHON, args, {
      cwd: skillPath('invoice'),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    });
    assert.match(stdout, /Generated:/);
  }
});
