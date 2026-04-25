const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { AuditLog } = require('./src/audit');
const {
  USERS,
  canReadAudit,
  canReadFile,
  canReadTask,
  extractBearer,
  publicUser,
  signJwt,
  verifyJwt,
} = require('./src/auth');
const { HermesPocRuntime } = require('./src/runtime');
const { listBuiltInSkills } = require('./src/skill-registry');
const { Store } = require('./src/store');

const ROOT = __dirname;
const DATA_DIR = process.env.WUTONG_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4188);

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendError(res, error) {
  sendJson(res, error.statusCode || 500, {
    error: error.message || 'Internal server error',
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function tokenFromRequest(req, url) {
  return extractBearer(req) || url.searchParams.get('token');
}

function authenticate(req, url) {
  return verifyJwt(tokenFromRequest(req, url));
}

function createApp() {
  const store = new Store(DATA_DIR);
  const audit = new AuditLog(path.join(DATA_DIR, 'audit.jsonl'));
  const runtime = new HermesPocRuntime({ store, audit, dataDir: DATA_DIR });

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/users') {
      sendJson(res, 200, { users: USERS.map(publicUser) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJson(req);
      const token = signJwt(body.userId);
      const user = verifyJwt(token);
      await audit.append({
        actorId: user.id,
        actorRole: user.role,
        department: user.department,
        action: 'user.login',
        subject: 'user',
        resource: { userId: user.id },
        metadata: { demo: true },
      });
      sendJson(res, 200, { token, user });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const user = authenticate(req, url);
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      const write = (event) => {
        if (event.task && canReadTask(user, event.task)) {
          res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };
      runtime.on('task', write);
      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      req.on('close', () => runtime.off('task', write));
      return;
    }

    const user = authenticate(req, url);

    if (req.method === 'GET' && url.pathname === '/api/runtime') {
      sendJson(res, 200, runtime.status());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/skills') {
      sendJson(res, 200, { skills: await listBuiltInSkills() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/metrics') {
      const state = await store.read();
      const tasks = state.tasks.filter((task) => canReadTask(user, task));
      sendJson(res, 200, {
        metrics: {
          ...state.metrics,
          activeTasks: tasks.filter((task) => task.status === 'running').length,
          waitingConfirmations: tasks.filter((task) => task.status === 'needs_confirmation').length,
          completedToday: tasks.filter((task) => task.status === 'completed').length,
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/agent/message') {
      const body = await readJson(req);
      const message = body.message || '';
      const inboundPlanId = body.inboundPlanId || message.match(/\bwf[0-9a-f-]{8,}(?:-[0-9a-f-]+)*\b/i)?.[0];
      const sidMatch = message.match(/\bsid\s*[:=]?\s*(\d+)/i);
      const sid = body.sid || (sidMatch ? Number(sidMatch[1]) : Number(process.env.WUTONG_DEMO_LINGXING_SID || 18426));
      const wantsShipmentFollowup = inboundPlanId && /sta|fba|货件|发货|发票/i.test(message);
      const task = wantsShipmentFollowup
        ? await runtime.startShipmentInvoiceSuggestion({
            user,
            sid,
            inboundPlanId,
            shipmentId: body.shipmentId,
          })
        : await runtime.startInvoiceFlow({
            user,
            message,
            skillId: body.skillId,
          });
      sendJson(res, 202, { task });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/shipments/invoice-suggestion') {
      const body = await readJson(req);
      const task = await runtime.startShipmentInvoiceSuggestion({
        user,
        sid: Number(body.sid),
        inboundPlanId: body.inboundPlanId,
        shipmentId: body.shipmentId,
        staDetail: body.staDetail,
      });
      sendJson(res, 202, { task });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tasks') {
      const state = await store.read();
      sendJson(res, 200, {
        tasks: state.tasks.filter((task) => canReadTask(user, task)),
      });
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && taskMatch) {
      const task = await store.getTask(taskMatch[1]);
      if (!task || !canReadTask(user, task)) {
        sendJson(res, 404, { error: 'Task not found' });
        return;
      }
      sendJson(res, 200, { task });
      return;
    }

    const confirmMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/confirm$/);
    if (req.method === 'POST' && confirmMatch) {
      const body = await readJson(req);
      const task = await runtime.confirmTask({
        user,
        taskId: confirmMatch[1],
        confirmationId: body.confirmationId,
        fields: body.fields || {},
      });
      sendJson(res, 202, { task });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const task = await runtime.cancelTask({ user, taskId: cancelMatch[1] });
      sendJson(res, 200, { task });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/files') {
      const state = await store.read();
      sendJson(res, 200, {
        files: state.files.filter((file) => canReadFile(user, file)),
      });
      return;
    }

    const downloadMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/download$/);
    if (req.method === 'GET' && downloadMatch) {
      const state = await store.read();
      const file = state.files.find((item) => item.id === downloadMatch[1]);
      if (!file || !canReadFile(user, file)) {
        sendJson(res, 404, { error: 'File not found' });
        return;
      }
      await audit.append({
        actorId: user.id,
        actorRole: user.role,
        department: user.department,
        action: 'file.downloaded',
        subject: 'file',
        resource: { fileId: file.id, taskId: file.taskId },
        metadata: { name: file.name },
      });
      const absolutePath = path.join(store.fileRoot, file.relativePath);
      res.writeHead(200, {
        'content-type': file.mimeType,
        'content-disposition': `attachment; filename="${file.name}"`,
      });
      fs.createReadStream(absolutePath).pipe(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const events = await audit.list();
      sendJson(res, 200, {
        events: events.filter((event) => canReadAudit(user, event)).slice(-80).reverse(),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/audit/verify') {
      sendJson(res, 200, await audit.verify());
      return;
    }

    sendJson(res, 404, { error: 'API route not found' });
  }

  async function serveStatic(req, res, url) {
    const publicRoot = path.join(ROOT, 'public');
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.normalize(path.join(publicRoot, requested));
    if (!filePath.startsWith(publicRoot)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    try {
      const body = await fsp.readFile(filePath);
      res.writeHead(200, { 'content-type': contentType(filePath) });
      res.end(body);
    } catch {
      sendJson(res, 404, { error: 'Not found' });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      await serveStatic(req, res, url);
    } catch (error) {
      sendError(res, error);
    }
  });

  return { server, store, audit, runtime };
}

if (require.main === module) {
  const { server } = createApp();
  server.listen(PORT, () => {
    console.log(`Wutong Hermes POC listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  createApp,
};
