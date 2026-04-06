import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { cleanupRuntimeFixture, createRuntimeFixture, startDummyOpenCode, startKortixMaster, waitForHttp, type RuntimeFixture, type StartedServer } from "./helpers"

const scriptPath = "/Users/markokraemer/Projects/heyagi/computer/core/kortix-master/opencode/skills/KORTIX-system/connectors/integration.ts"
const pluginPath = "/Users/markokraemer/Projects/heyagi/computer/core/kortix-master/opencode/plugin/connectors/connectors.ts"

describe("connectors plugin + pipedream script e2e", () => {
  let dir = ""

  beforeEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), "kortix-connectors-"))
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("plugin discovers example connector from workspace and scaffolded connectors batch", async () => {
    const root = dir
    const cfg = join(root, ".opencode")
    const base = join(cfg, "connectors")
    mkdirSync(join(base, "example"), { recursive: true })
    writeFileSync(
      join(base, "example", "CONNECTOR.md"),
      [
        "---",
        'name: example',
        'description: "example connector"',
        'source: custom',
        'status: disconnected',
        "---",
      ].join("\n"),
      "utf8",
    )

    process.env.OPENCODE_CONFIG_DIR = cfg
    process.env.KORTIX_WORKSPACE = ""

    const mod = await import(pluginPath)
    const plugin = await mod.default()
    const ctx = {} as any

    const first = await plugin.tool.connector_list.execute({ filter: "" }, ctx)
    expect(first).toContain("example")

    const setup = await plugin.tool.connector_setup.execute({
      connectors: JSON.stringify([
        { name: "github", description: "kortix-ai org", source: "cli", status: "pending" },
        { name: "gmail-work", description: "work gmail", source: "pipedream", pipedream_slug: "gmail", status: "pending" },
      ]),
    }, ctx)
    expect(setup).toContain("github")
    expect(setup).toContain("gmail-work")

    const second = await plugin.tool.connector_list.execute({ filter: "" }, ctx)
    expect(second).toContain("github")
    expect(second).toContain("gmail-work")

    const one = await plugin.tool.connector_get.execute({ name: "gmail-work" }, ctx)
    expect(one).toContain("source: pipedream")
    expect(one).toContain("pipedream_slug: gmail")
  })
})

describe("integration.ts end-to-end through kortix-master", () => {
  let api: ReturnType<typeof Bun.serve>
  let open: { stop: () => Promise<void> }
  let master: StartedServer
  let fx: RuntimeFixture
  const apiPort = 18123
  const masterPort = 18100
  const key = "test-internal-key"

  beforeAll(async () => {
    // Legacy cleanup — old trigger system stored cron state here
    rmSync("/tmp/kortix-agent-triggers/cron-state.json", { force: true })

    const app = new Hono()

    app.use("*", async (c, next) => {
      const auth = c.req.header("authorization")
      if (auth && auth !== "Bearer test-kortix-token") {
        return c.text("bad auth", 401)
      }
      await next()
    })

    app.get("/v1/pipedream/search-apps", (c) => {
      const q = c.req.query("q") || ""
      return c.json({
        apps: [
          { slug: q || "gmail", name: `${q || "gmail"} app`, description: "demo" },
        ],
        pageInfo: { totalCount: 1 },
      })
    })

    app.post("/v1/pipedream/connect", async (c) => {
      const body = await c.req.json()
      return c.json({ app: body.app, connectUrl: `https://connect.example/${body.app}` })
    })

    app.get("/v1/pipedream/list", (c) => {
      return c.json({ integrations: [{ app: "gmail", appName: "Gmail", status: "connected" }] })
    })

    app.post("/v1/pipedream/proxy", async (c) => {
      const body = await c.req.json()
      return c.json({ status: 200, body: { ok: true, app: body.app, method: body.method, url: body.url } })
    })

    app.get("/v1/pipedream/actions", (c) => {
      return c.json({
        actions: [
          {
            key: "gmail-send-email",
            name: "Send Email",
            description: "send",
            params: [{ name: "to", type: "string", required: true }],
          },
        ],
      })
    })

    app.post("/v1/pipedream/run-action", async (c) => {
      const body = await c.req.json()
      return c.json({ success: true, result: { action: body.action_key, props: body.props } })
    })

    app.put("/v1/pipedream/credentials", () => Response.json({ success: true }))
    app.get("/v1/pipedream/credentials", () => Response.json({ configured: true, source: "default", provider: "pipedream" }))

    api = Bun.serve({ port: apiPort, hostname: "127.0.0.1", fetch: app.fetch })
    await waitForHttp(`http://127.0.0.1:${apiPort}/v1/pipedream/list`)

    fx = createRuntimeFixture("km-connectors-")
    open = await startDummyOpenCode(masterPort + 1000)
    master = await startKortixMaster(masterPort, fx, {
      INTERNAL_SERVICE_KEY: key,
      KORTIX_TOKEN: "test-kortix-token",
      KORTIX_API_URL: `http://127.0.0.1:${apiPort}`,
      PIPEDREAM_CLIENT_ID: "pd-client",
      PIPEDREAM_CLIENT_SECRET: "pd-secret",
      PIPEDREAM_PROJECT_ID: "proj_test",
      PIPEDREAM_ENVIRONMENT: "production",
    })
  })

  afterAll(async () => {
    await master?.stop()
    await open?.stop()
    await cleanupRuntimeFixture(fx)
    await api?.stop(true)
  })

  async function run(cmd: string, json?: object) {
    const proc = Bun.spawn(["bun", "run", scriptPath, cmd, ...(json ? [JSON.stringify(json)] : [])], {
      env: {
        ...process.env,
        KORTIX_MASTER_URL: `http://127.0.0.1:${masterPort}`,
        INTERNAL_SERVICE_KEY: key,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()
    const code = await proc.exited
    return { code, out, err, json: JSON.parse(out) }
  }

  test("search returns pipedream apps through master proxy", async () => {
    const res = await run("search", { q: "gmail" })
    expect(res.code).toBe(0)
    expect(res.json.success).toBe(true)
    expect(res.json.apps[0].slug).toBe("gmail")
  })

  test("connect returns connect URL through master proxy", async () => {
    const res = await run("connect", { app: "slack" })
    expect(res.json.success).toBe(true)
    expect(res.json.connectUrl).toBe("https://connect.example/slack")
  })

  test("list returns connected integrations", async () => {
    const res = await run("list")
    expect(res.json.success).toBe(true)
    expect(res.json.integrations[0].app).toBe("gmail")
  })

  test("request proxies authenticated HTTP calls", async () => {
    const res = await run("request", { app: "stripe", method: "GET", url: "https://api.stripe.com/v1/customers?limit=5" })
    expect(res.json.success).toBe(true)
    expect(res.json.body.app).toBe("stripe")
    expect(res.json.body.url).toContain("customers")
  })

  test("actions returns action metadata", async () => {
    const res = await run("actions", { app: "gmail", q: "send" })
    expect(res.json.success).toBe(true)
    expect(res.json.actions[0].key).toBe("gmail-send-email")
  })

  test("run returns action result", async () => {
    const res = await run("run", { app: "gmail", action_key: "gmail-send-email", props: { to: "x@y.com" } })
    expect(res.json.success).toBe(true)
    expect(res.json.result.action).toBe("gmail-send-email")
  })

  test("exec provides proxyFetch for programmatic code", async () => {
    const res = await run("exec", { app: "stripe", code: 'const r = await proxyFetch("https://api.stripe.com/v1/customers?limit=1"); console.log(JSON.stringify(await r.json()));' })
    expect(res.json.success).toBe(true)
    expect(res.json.stdout).toContain('"app":"stripe"')
    expect(res.json.stdout).toContain('"ok":true')
  })
})
