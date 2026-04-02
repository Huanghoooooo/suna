#!/usr/bin/env bun
/**
 * Integration CLI — all OAuth integration operations in one script.
 *
 * Usage: bun run integration.ts <command> [args as JSON]
 *
 * Commands:
 *   search   '{"q":"gmail"}'
 *   connect  '{"app":"gmail"}'
 *   list
 *   request  '{"app":"gmail","method":"GET","url":"https://..."}'
 *   actions  '{"app":"gmail","q":"send"}'
 *   run      '{"app":"gmail","action_key":"gmail-send-email","props":{...}}'
 *   exec     '{"app":"gmail","code":"const r = await proxyFetch(...); console.log(await r.json())"}'
 */

import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

// ── Env resolution (s6 → process.env → .env file) ─────────────────────────

const S6_ENV_DIR = process.env.S6_ENV_DIR || "/run/s6/container_environment";

function getEnv(key: string): string | undefined {
  try {
    const val = readFileSync(`${S6_ENV_DIR}/${key}`, "utf-8").trim();
    if (val) return val;
  } catch {}
  return process.env[key];
}

// ── Shared helpers ─────────────────────────────────────────────────────────

const masterUrl = (getEnv("KORTIX_MASTER_URL") || "http://localhost:8000").trim();

function authHeaders(): Record<string, string> {
  const key = getEnv("INTERNAL_SERVICE_KEY");
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ── Commands ───────────────────────────────────────────────────────────────

async function search(q?: string) {
  const params = new URLSearchParams({ limit: "20" });
  if (q) params.set("q", q);
  const res = await fetch(`${masterUrl}/api/pipedream/search-apps?${params}`, { headers: authHeaders() });
  if (!res.ok) return out({ success: false, error: `${res.status}: ${await res.text()}` });
  const data = await res.json() as { apps: Array<{ slug: string; name: string; description?: string }>; pageInfo: { totalCount: number } };
  if (!data.apps?.length) return out({ success: true, apps: [], message: `No apps found${q ? ` matching "${q}"` : ""}` });
  out({ success: true, apps: data.apps.map(a => ({ slug: a.slug, name: a.name, description: a.description })), totalCount: data.pageInfo.totalCount });
}

async function connect(apps: string | string[]) {
  const list = Array.isArray(apps) ? apps : [apps];
  const results: Array<{ app: string; connectUrl?: string; error?: string }> = [];
  await Promise.all(list.map(async (app) => {
    try {
      const res = await fetch(`${masterUrl}/api/pipedream/connect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ app }),
      });
      if (!res.ok) { results.push({ app, error: `${res.status}: ${await res.text()}` }); return; }
      const data = await res.json() as { connectUrl?: string; app: string };
      results.push({ app: data.app || app, connectUrl: data.connectUrl });
    } catch (e: any) {
      results.push({ app, error: e.message });
    }
  }));
	const ok = results.filter(r => r.connectUrl);
	const failed = results.filter(r => r.error);
	const singleConnectUrl = ok.length === 1 ? ok[0]?.connectUrl : undefined;
	out({
		success: ok.length > 0,
		connectUrl: singleConnectUrl,
		connections: ok.map(r => ({ app: r.app, connectUrl: r.connectUrl })),
		errors: failed.length > 0 ? failed : undefined,
		message: `${ok.length} connect URL(s) generated${failed.length ? `, ${failed.length} failed` : ""}`,
	});
}

async function list() {
  const res = await fetch(`${masterUrl}/api/pipedream/list`, { headers: authHeaders() });
  if (!res.ok) return out({ success: false, error: `${res.status}: ${await res.text()}` });
  const data = await res.json() as { integrations: Array<{ app: string; appName: string; status: string }> };
  out({ success: true, integrations: data.integrations ?? [], message: `${data.integrations?.length ?? 0} integration(s) available.` });
}

async function request(app: string, method: string, url: string, headers?: Record<string,string>, body?: unknown) {
  const res = await fetch(`${masterUrl}/api/pipedream/proxy`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ app, method: method || "GET", url, headers, body }),
  });
  if (!res.ok) return out({ success: false, error: `${res.status}: ${await res.text()}` });
  const data = await res.json() as { status: number; body: unknown };
  out({ success: data.status >= 200 && data.status < 400, status: data.status, body: data.body });
}

async function actions(app: string, q?: string) {
  const params = new URLSearchParams({ app });
  if (q) params.set("q", q);
  const res = await fetch(`${masterUrl}/api/pipedream/actions?${params}`, { headers: authHeaders() });
  if (!res.ok) return out({ success: false, error: `${res.status}: ${await res.text()}` });
  const data = await res.json() as { actions: Array<{ key: string; name: string; description?: string; params: Array<{ name: string; type: string; required: boolean }> }> };
  if (!data.actions?.length && q) {
    // retry without filter
    const res2 = await fetch(`${masterUrl}/api/pipedream/actions?app=${app}`, { headers: authHeaders() });
    const data2 = await res2.json() as typeof data;
    data.actions = data2.actions ?? [];
  }
  if (!data.actions?.length) return out({ success: true, app, actions: [], message: `No actions for "${app}". Check slug with search command.` });
  out({
    success: true, app, actions: data.actions.map(a => ({
      key: a.key, name: a.name, description: a.description,
      required_params: a.params.filter(p => p.required).map(p => `${p.name} (${p.type})`),
      optional_params: a.params.filter(p => !p.required).map(p => `${p.name} (${p.type})`),
    })),
  });
}

async function run(app: string, action_key: string, props: Record<string, unknown> = {}) {
  const res = await fetch(`${masterUrl}/api/pipedream/run-action`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ app, action_key, props }),
  });
  if (!res.ok) return out({ success: false, error: `${res.status}: ${await res.text()}` });
  const data = await res.json() as { success: boolean; result?: unknown; error?: string };
  out(data.success ? { success: true, result: data.result } : { success: false, error: data.error });
}

async function exec(app: string, code: string) {
  const proxyUrl = `${masterUrl}/api/pipedream/proxy`;
  const internalKey = getEnv("INTERNAL_SERVICE_KEY") || "";

  const preamble = `
const __PROXY_URL__ = process.env.__PROXY_URL__;
const __APP_SLUG__ = process.env.__APP_SLUG__;
globalThis.proxyFetch = async function proxyFetch(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = {};
  if (init.headers) {
    const h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
    for (const [k, v] of Object.entries(h)) { if (k.toLowerCase() !== 'authorization') headers[k] = v; }
  }
  let body;
  if (init.body != null) { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  const r = await fetch(__PROXY_URL__, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.__INTERNAL_SERVICE_KEY__ ? { Authorization: 'Bearer ' + process.env.__INTERNAL_SERVICE_KEY__ } : {}) },
    body: JSON.stringify({ app: __APP_SLUG__, method, url, headers: Object.keys(headers).length ? headers : undefined, body }),
  });
  if (!r.ok) throw new Error('Proxy error (' + r.status + '): ' + await r.text());
  const d = await r.json();
  const s = d.status || 200;
  return { ok: s >= 200 && s < 400, status: s, statusText: s < 400 ? 'OK' : 'Error', headers: new Map(Object.entries(d.headers || {})), json: async () => d.body, text: async () => typeof d.body === 'string' ? d.body : JSON.stringify(d.body) };
};
`;

  const tmpFile = `/tmp/.intexec_${Date.now()}.mjs`;
  writeFileSync(tmpFile, preamble + "\n" + code, "utf-8");
  try {
    const result = spawnSync("node", [tmpFile], {
      env: { ...process.env, __PROXY_URL__: proxyUrl, __APP_SLUG__: app, __INTERNAL_SERVICE_KEY__: internalKey },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
    });
    console.log(JSON.stringify({ success: result.status === 0, exit_code: result.status, stdout: (result.stdout || "").slice(0, 10_000), stderr: (result.stderr || "").slice(0, 5_000) }, null, 2));
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ── Dispatch ───────────────────────────────────────────────────────────────

const [cmd, rawArgs] = process.argv.slice(2);
const args = rawArgs ? JSON.parse(rawArgs) : {};

switch (cmd) {
  case "search":  await search(args.q); break;
  case "connect": await connect(args.apps || args.app); break;
  case "list":    await list(); break;
  case "request": await request(args.app, args.method, args.url, args.headers, args.body); break;
  case "actions": await actions(args.app, args.q); break;
  case "run":     await run(args.app, args.action_key, args.props); break;
  case "exec":    await exec(args.app, args.code); break;
  default:
    console.error(`Unknown command: ${cmd}. Use: search | connect | list | request | actions | run | exec`);
    process.exit(1);
}
