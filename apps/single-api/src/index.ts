import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config } from './config';
import { compose, sandboxHealth, sandboxLogs } from './sandbox';
import { createSession, getSession, listSessions, updateSession } from './store';
import { getMessages, proxyToSandbox, sendPrompt } from './opencode';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: [config.webUrl, config.publicApiUrl, 'http://localhost:13000', 'http://127.0.0.1:13000'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({
  ok: true,
  mode: 'single-user-single-sandbox',
  api: config.publicApiUrl,
  sandbox: config.sandboxBaseUrl,
}));

app.get('/api/sandbox/status', async (c) => c.json({ success: true, data: await sandboxHealth() }));

app.post('/api/sandbox/start', async (c) => {
  compose(['up', '-d']);
  return c.json({ success: true, data: await sandboxHealth() });
});

app.post('/api/sandbox/restart', async (c) => {
  compose(['restart'], 60_000);
  return c.json({ success: true, data: await sandboxHealth() });
});

app.post('/api/sandbox/stop', (c) => {
  compose(['stop'], 60_000);
  return c.json({ success: true });
});

app.get('/api/sandbox/logs', (c) => {
  const lines = Number(c.req.query('lines') || '160');
  return c.text(sandboxLogs(Number.isFinite(lines) ? lines : 160));
});

app.get('/api/sessions', (c) => c.json({ success: true, data: listSessions() }));

app.post('/api/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const session = createSession(body.title);
  return c.json({ success: true, data: session }, 201);
});

app.get('/api/sessions/:id', (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ success: false, error: 'Session not found' }, 404);
  return c.json({ success: true, data: session });
});

app.post('/api/sessions/:id/prompt', async (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ success: false, error: 'Session not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  if (!text) return c.json({ success: false, error: 'text is required' }, 400);
  try {
    const result = await sendPrompt(session, text);
    updateSession(session.id, { opencodeSessionId: result.opencodeSessionId });
    return c.json({ success: true, data: { ...session, opencodeSessionId: result.opencodeSessionId } });
  } catch (err: any) {
    return c.json({ success: false, error: err?.message || String(err) }, 502);
  }
});

app.get('/api/sessions/:id/messages', async (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ success: false, error: 'Session not found' }, 404);
  return c.json({ success: true, data: await getMessages(session) });
});

app.all('/api/opencode/*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/opencode/, '') + url.search;
  return proxyToSandbox(path || '/', c.req.raw);
});

app.all('/api/preview/:port/*', async (c) => {
  const port = c.req.param('port');
  const url = new URL(c.req.url);
  const prefix = `/api/preview/${port}`;
  const remaining = url.pathname.slice(prefix.length) || '/';
  return proxyToSandbox(`/proxy/${port}${remaining}${url.search}`, c.req.raw);
});

console.log(`[single-api] listening on ${config.host}:${config.port}`);
console.log(`[single-api] sandbox=${config.sandboxBaseUrl} container=${config.sandboxContainer}`);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};
