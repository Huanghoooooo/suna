#!/usr/bin/env bun
/**
 * kpipedream — Pipedream OAuth integration CLI.
 *
 * Usage:
 *   kpipedream search [--query <text>]              Search Pipedream apps catalog
 *   kpipedream connect --app <slug> [--app <slug>]  Get OAuth connect URL(s)
 *   kpipedream list                                 List connected integrations
 *   kpipedream request --app <slug> --url <url> [--method GET|POST] [--body <json>]  Proxy API request
 *   kpipedream actions --app <slug> [--query <text>] List available actions
 *   kpipedream run --app <slug> --action <key> [--props <json>]  Run a Pipedream action
 *   kpipedream exec --app <slug> --code <code>      Execute custom code with proxyFetch
 *   kpipedream help                                 Show usage
 *
 * Output: JSON always.
 */

import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { spawnSync } from "node:child_process"

// ─── JSON output ─────────────────────────────────────────────────────────────

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

// ─── Argument parsing (same pattern as kchannel.ts) ──────────────────────────
// Extended to collect repeated --app flags into an array

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Record<string, string>; apps: string[] } {
  const all = argv.slice(2)
  const command = all[0] ?? "help"
  const args: string[] = []
  const flags: Record<string, string> = {}
  const apps: string[] = []
  for (let i = 1; i < all.length; i++) {
    const a = all[i]!
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const val = all[i + 1] && !all[i + 1]!.startsWith("--") ? all[++i]! : "true"
      if (key === "app") {
        apps.push(val)
      } else {
        flags[key] = val
      }
    } else {
      args.push(a)
    }
  }
  // Also put first app into flags for convenience
  if (apps.length && !flags.app) flags.app = apps[0]!
  return { command, args, flags, apps }
}

// ─── Env resolution (s6 → process.env → .env file) ──────────────────────────

const S6_ENV_DIR = process.env.S6_ENV_DIR || "/run/s6/container_environment"

function getEnv(key: string): string | undefined {
  try {
    const val = readFileSync(`${S6_ENV_DIR}/${key}`, "utf-8").trim()
    if (val) return val
  } catch {}
  return process.env[key]
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const masterUrl = (getEnv("KORTIX_MASTER_URL") || "http://localhost:8000").trim()

function authHeaders(): Record<string, string> {
  const key = getEnv("INTERNAL_SERVICE_KEY")
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function search(q?: string) {
  const params = new URLSearchParams({ limit: "20" })
  if (q) params.set("q", q)
  const res = await fetch(`${masterUrl}/api/pipedream/search-apps?${params}`, { headers: authHeaders() })
  if (!res.ok) return out({ ok: false, error: `${res.status}: ${await res.text()}` })
  const data = await res.json() as { apps: Array<{ slug: string; name: string; description?: string }>; pageInfo: { totalCount: number } }
  if (!data.apps?.length) return out({ ok: true, apps: [], message: `No apps found${q ? ` matching "${q}"` : ""}` })
  out({ ok: true, apps: data.apps.map(a => ({ slug: a.slug, name: a.name, description: a.description })), totalCount: data.pageInfo.totalCount })
}

async function connect(appSlugs: string[]) {
  if (!appSlugs.length) {
    out({ ok: false, error: "At least one --app required" })
    process.exit(1)
  }
  const results: Array<{ app: string; connectUrl?: string; error?: string }> = []
  await Promise.all(appSlugs.map(async (app) => {
    try {
      const res = await fetch(`${masterUrl}/api/pipedream/connect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ app }),
      })
      if (!res.ok) { results.push({ app, error: `${res.status}: ${await res.text()}` }); return }
      const data = await res.json() as { connectUrl?: string; app: string }
      results.push({ app: data.app || app, connectUrl: data.connectUrl })
    } catch (e: any) {
      results.push({ app, error: e.message })
    }
  }))
  const ok = results.filter(r => r.connectUrl)
  const failed = results.filter(r => r.error)
  const singleConnectUrl = ok.length === 1 ? ok[0]?.connectUrl : undefined
  out({
    ok: ok.length > 0,
    connectUrl: singleConnectUrl,
    connections: ok.map(r => ({ app: r.app, connectUrl: r.connectUrl })),
    errors: failed.length > 0 ? failed : undefined,
    message: `${ok.length} connect URL(s) generated${failed.length ? `, ${failed.length} failed` : ""}`,
  })
}

async function listIntegrations() {
  const res = await fetch(`${masterUrl}/api/pipedream/list`, { headers: authHeaders() })
  if (!res.ok) return out({ ok: false, error: `${res.status}: ${await res.text()}` })
  const data = await res.json() as { integrations: Array<{ app: string; appName: string; status: string }> }
  out({ ok: true, integrations: data.integrations ?? [], message: `${data.integrations?.length ?? 0} integration(s) available.` })
}

async function request(app: string, method: string, url: string, headers?: Record<string, string>, body?: unknown) {
  if (!app) { out({ ok: false, error: "--app required" }); process.exit(1) }
  if (!url) { out({ ok: false, error: "--url required" }); process.exit(1) }
  const res = await fetch(`${masterUrl}/api/pipedream/proxy`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ app, method: method || "GET", url, headers, body }),
  })
  if (!res.ok) return out({ ok: false, error: `${res.status}: ${await res.text()}` })
  const data = await res.json() as { status: number; body: unknown }
  out({ ok: data.status >= 200 && data.status < 400, status: data.status, body: data.body })
}

async function actions(app: string, q?: string) {
  if (!app) { out({ ok: false, error: "--app required" }); process.exit(1) }
  const params = new URLSearchParams({ app })
  if (q) params.set("q", q)
  const res = await fetch(`${masterUrl}/api/pipedream/actions?${params}`, { headers: authHeaders() })
  if (!res.ok) return out({ ok: false, error: `${res.status}: ${await res.text()}` })
  const data = await res.json() as { actions: Array<{ key: string; name: string; description?: string; params: Array<{ name: string; type: string; required: boolean }> }> }
  if (!data.actions?.length && q) {
    // Retry without filter
    const res2 = await fetch(`${masterUrl}/api/pipedream/actions?app=${app}`, { headers: authHeaders() })
    const data2 = await res2.json() as typeof data
    data.actions = data2.actions ?? []
  }
  if (!data.actions?.length) return out({ ok: true, app, actions: [], message: `No actions for "${app}". Check slug with search command.` })
  out({
    ok: true, app, actions: data.actions.map(a => ({
      key: a.key, name: a.name, description: a.description,
      required_params: a.params.filter(p => p.required).map(p => `${p.name} (${p.type})`),
      optional_params: a.params.filter(p => !p.required).map(p => `${p.name} (${p.type})`),
    })),
  })
}

async function run(app: string, actionKey: string, props: Record<string, unknown> = {}) {
  if (!app) { out({ ok: false, error: "--app required" }); process.exit(1) }
  if (!actionKey) { out({ ok: false, error: "--action required" }); process.exit(1) }
  const res = await fetch(`${masterUrl}/api/pipedream/run-action`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ app, action_key: actionKey, props }),
  })
  if (!res.ok) return out({ ok: false, error: `${res.status}: ${await res.text()}` })
  const data = await res.json() as { success: boolean; result?: unknown; error?: string }
  out(data.success ? { ok: true, result: data.result } : { ok: false, error: data.error })
}

async function exec(app: string, code: string) {
  if (!app) { out({ ok: false, error: "--app required" }); process.exit(1) }
  if (!code) { out({ ok: false, error: "--code required" }); process.exit(1) }

  const proxyUrl = `${masterUrl}/api/pipedream/proxy`
  const internalKey = getEnv("INTERNAL_SERVICE_KEY") || ""

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
`

  const tmpFile = `/tmp/.kpipedream_exec_${Date.now()}.mjs`
  writeFileSync(tmpFile, preamble + "\n" + code, "utf-8")
  try {
    const result = spawnSync("node", [tmpFile], {
      env: { ...process.env, __PROXY_URL__: proxyUrl, __APP_SLUG__: app, __INTERNAL_SERVICE_KEY__: internalKey },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
    })
    out({ ok: result.status === 0, exit_code: result.status, stdout: (result.stdout || "").slice(0, 10_000), stderr: (result.stderr || "").slice(0, 5_000) })
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, flags, apps } = parseArgs(process.argv)

  switch (command) {
    case "search": {
      await search(flags.query)
      break
    }

    case "connect": {
      await connect(apps)
      break
    }

    case "list": case "ls": {
      await listIntegrations()
      break
    }

    case "request": case "proxy": {
      let bodyParsed: unknown
      if (flags.body) {
        try { bodyParsed = JSON.parse(flags.body) } catch { bodyParsed = flags.body }
      }
      let headersParsed: Record<string, string> | undefined
      if (flags.headers) {
        try { headersParsed = JSON.parse(flags.headers) } catch {}
      }
      await request(flags.app!, flags.method || "GET", flags.url!, headersParsed, bodyParsed)
      break
    }

    case "actions": {
      await actions(flags.app!, flags.query)
      break
    }

    case "run": {
      let propsParsed: Record<string, unknown> = {}
      if (flags.props) {
        try { propsParsed = JSON.parse(flags.props) } catch { out({ ok: false, error: "Invalid --props JSON" }); process.exit(1) }
      }
      await run(flags.app!, flags.action!, propsParsed)
      break
    }

    case "exec": {
      await exec(flags.app!, flags.code!)
      break
    }

    case "help":
    default:
      console.log(`
kpipedream — Pipedream OAuth Integration CLI

Commands:
  search [--query <text>]              Search Pipedream apps catalog (2000+ apps)
  connect --app <slug> [--app <slug>]  Get OAuth connect URL(s)
  list                                 List connected integrations
  request --app <slug> --url <url> [--method GET|POST] [--body <json>]
                                       Proxy API request through Pipedream auth
  actions --app <slug> [--query <text>] List available actions for an app
  run --app <slug> --action <key> [--props <json>]
                                       Run a Pipedream action
  exec --app <slug> --code <code>      Execute custom code with proxyFetch
  help                                 Show this help

Examples:
  kpipedream search --query gmail
  kpipedream connect --app gmail --app slack
  kpipedream list
  kpipedream actions --app gmail --query send
  kpipedream run --app gmail --action gmail-send-email --props '{"to":"x@y.com","subject":"Hi"}'
  kpipedream request --app gmail --url https://gmail.googleapis.com/gmail/v1/users/me/messages
  kpipedream exec --app gmail --code 'const r = await proxyFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages"); console.log(await r.json())'
`)
      break
  }
}

main().catch((err) => {
  out({ ok: false, error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
