const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { skillPath } = require('./skill-registry');

const execFileAsync = promisify(execFile);

const DEFAULT_PYTHON = 'C:\\Users\\Jiach\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
let invoiceStoresCache = null;
let invoiceSheetCache = null;

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePython() {
  const configured = process.env.WUTONG_PYTHON;
  if (configured) {
    return configured;
  }
  if (await fileExists(DEFAULT_PYTHON)) {
    return DEFAULT_PYTHON;
  }
  return 'python';
}

function normalizeConsoleText(text) {
  if (Buffer.isBuffer(text)) {
    return text.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '').trim();
  }
  return text.replace(/\u001b\[[0-9;]*m/g, '').trim();
}

function parseGeneratedPath(stdout) {
  const clean = normalizeConsoleText(stdout);
  const line = clean
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.includes('Generated:'));
  if (!line) {
    throw new Error(`Invoice skill did not report generated path: ${clean}`);
  }
  return line.replace(/^.*Generated:\s*/, '').trim();
}

async function generateInvoiceWithSkill(input) {
  const skillDir = skillPath('invoice');
  const script = path.join(skillDir, 'generate.py');
  if (!(await fileExists(script))) {
    throw new Error(`Invoice skill script not found: ${script}`);
  }

  const python = await resolvePython();
  const args = [
    script,
    '--store',
    input.store,
    input.sheet ? '--sheet' : '--country',
    input.sheet || input.country,
    '--order',
    input.orderNumber,
    '--invoice-num',
    input.invoiceNumber,
    '--date',
    input.invoiceDate,
    '--delivery',
    input.deliveryDate,
    '--customer',
    input.customerInfo,
    '--product',
    input.productDescription,
    '--qty',
    String(input.quantity),
    '--price',
    String(input.unitPrice),
    '--currency',
    input.currency || 'EUR',
  ];

  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
  const { stdout, stderr } = await execFileAsync(python, args, {
    cwd: skillDir,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });

  const generatedPath = parseGeneratedPath(stdout);
  const stat = await fs.stat(generatedPath);
  return {
    generatedPath,
    size: stat.size,
    stdout: normalizeConsoleText(stdout),
    stderr: normalizeConsoleText(stderr || ''),
  };
}

async function runStaDryRun(input = {}) {
  const skillDir = skillPath('lingxing-sta-workflow');
  const script = path.join(skillDir, 'scripts', 'sta_api_caller.py');
  if (!(await fileExists(script))) {
    throw new Error(`STA skill script not found: ${script}`);
  }

  const python = await resolvePython();
  const params = input.params || {
    sid: 18426,
    inboundPlanId: 'wf-test',
    packageGroupings: [
      {
        packingGroupId: 'pg-test',
        boxes: [
          {
            dimensions: { height: 30, length: 40, width: 35, unitOfMeasurement: 'CM' },
            items: [
              { labelOwner: 'SELLER', msku: 'Q9-CH', prepOwner: 'SELLER', quantity: 1 },
            ],
            weight: { unit: 'KG', value: 6 },
          },
        ],
      },
    ],
  };

  const { stdout, stderr } = await execFileAsync(
    python,
    [
      script,
      '--api-path',
      input.apiPath || '/amzStaServer/openapi/inbound-packing/setPackingInformation',
      '--app-id',
      input.appId || '1234567890abcdef',
      '--access-token',
      input.accessToken || 'token-test',
      '--params',
      JSON.stringify(params),
      '--dry-run',
    ],
    {
      cwd: skillDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    }
  );

  return {
    result: JSON.parse(stdout),
    stdout: normalizeConsoleText(stdout),
    stderr: normalizeConsoleText(stderr || ''),
  };
}

async function listInvoiceStores() {
  if (invoiceStoresCache) {
    return [...invoiceStoresCache];
  }
  const skillDir = skillPath('invoice');
  const script = path.join(skillDir, 'generate.py');
  const python = await resolvePython();
  const { stdout } = await execFileAsync(python, [script, '--list-stores'], {
    cwd: skillDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  invoiceStoresCache = normalizeConsoleText(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^-\s*/, ''))
    .filter((line) => line && !line.endsWith('stores:'));
  return [...invoiceStoresCache];
}

async function listInvoiceSheets(input = {}) {
  const cacheKey = input.store || '*';
  if (invoiceSheetCache && invoiceSheetCache[cacheKey]) {
    return [...invoiceSheetCache[cacheKey]];
  }
  const skillDir = skillPath('invoice');
  const script = path.join(skillDir, 'generate.py');
  const python = await resolvePython();
  const stores = input.store ? [input.store] : await listInvoiceStores();
  const sheetSet = new Set();
  for (const store of stores) {
    const { stdout } = await execFileAsync(python, [script, '--store', store, '--list-sheets'], {
      cwd: skillDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    normalizeConsoleText(stdout)
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^-\s*/, ''))
      .filter((line) => line && !line.startsWith('Available sheets for'))
      .forEach((sheet) => sheetSet.add(sheet));
  }
  invoiceSheetCache = invoiceSheetCache || {};
  invoiceSheetCache[cacheKey] = [...sheetSet].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return [...invoiceSheetCache[cacheKey]];
}

function isLingxingSuccess(response) {
  return response && (response.code === 0 || response.code === '0');
}

function isTokenExpired(response) {
  return response && String(response.code) === '2001003';
}

async function getLingxingAccessToken(input = {}) {
  const appId = input.appId || process.env.LINGXING_APP_ID;
  const appSecret = input.appSecret || process.env.LINGXING_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('LINGXING_APP_ID and LINGXING_APP_SECRET are required to refresh access_token');
  }

  const skillDir = skillPath('lingxing-openapi');
  const script = path.join(skillDir, 'scripts', 'get_access_token.py');
  if (!(await fileExists(script))) {
    throw new Error(`LingXing token script not found: ${script}`);
  }

  const python = await resolvePython();
  const { stdout } = await execFileAsync(
    python,
    [script, '--app-id', appId, '--app-secret', appSecret],
    {
      cwd: skillDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    }
  );
  const payload = JSON.parse(stdout);
  const token = payload?.data?.access_token;
  if (!token) {
    throw new Error(`LingXing access_token refresh failed: ${normalizeConsoleText(stdout)}`);
  }
  return token;
}

async function callStaApi(input) {
  const skillDir = skillPath('lingxing-sta-workflow');
  const script = path.join(skillDir, 'scripts', 'sta_api_caller.py');
  if (!(await fileExists(script))) {
    throw new Error(`STA skill script not found: ${script}`);
  }

  const appId = input.appId || process.env.LINGXING_APP_ID;
  const accessToken = input.accessToken || process.env.LINGXING_ACCESS_TOKEN;
  if (!appId || !accessToken) {
    throw new Error('LINGXING_APP_ID and LINGXING_ACCESS_TOKEN are required for STA API calls');
  }

  const python = await resolvePython();
  const args = [
    script,
    '--api-path',
    input.apiPath,
    '--app-id',
    appId,
    '--access-token',
    accessToken,
    '--params',
    JSON.stringify(input.params || {}),
    '--timeout',
    String(input.timeoutSeconds || 45),
  ];
  if (input.baseUrl) {
    args.push('--base-url', input.baseUrl);
  }

  const { stdout, stderr } = await execFileAsync(python, args, {
    cwd: skillDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: input.timeoutMs || 90_000,
    maxBuffer: 1024 * 1024 * 4,
  });

  const result = JSON.parse(stdout);
  return {
    ...result,
    stdout: normalizeConsoleText(stdout),
    stderr: normalizeConsoleText(stderr || ''),
  };
}

async function fetchStaInboundPlanDetail(input) {
  const appId = input.appId || process.env.LINGXING_APP_ID;
  const appSecret = input.appSecret || process.env.LINGXING_APP_SECRET;
  let accessToken = input.accessToken || process.env.LINGXING_ACCESS_TOKEN;
  if (!accessToken && appSecret) {
    accessToken = await getLingxingAccessToken({ appId, appSecret });
  }

  const params = {
    sid: input.sid,
    inboundPlanId: input.inboundPlanId,
  };
  let result = await callStaApi({
    apiPath: '/amzStaServer/openapi/inbound-plan/detail',
    params,
    appId,
    accessToken,
    baseUrl: input.baseUrl,
  });

  if (isTokenExpired(result.response) && appSecret) {
    accessToken = await getLingxingAccessToken({ appId, appSecret });
    result = await callStaApi({
      apiPath: '/amzStaServer/openapi/inbound-plan/detail',
      params,
      appId,
      accessToken,
      baseUrl: input.baseUrl,
    });
  }

  if (!isLingxingSuccess(result.response)) {
    const message = result.response?.message || result.response?.msg || 'Unknown LingXing API error';
    throw new Error(`LingXing STA detail query failed: ${message}`);
  }
  return result.response;
}

module.exports = {
  callStaApi,
  fetchStaInboundPlanDetail,
  generateInvoiceWithSkill,
  getLingxingAccessToken,
  listInvoiceSheets,
  listInvoiceStores,
  runStaDryRun,
};
