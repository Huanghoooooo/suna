/**
 * TriggerManager — Unified orchestration for the trigger system.
 *
 * Wires together: TriggerStore (DB), TriggerYaml (file sync),
 * CronScheduler (croner jobs), WebhookServer (HTTP), ActionDispatcher (execution).
 */
import { Cron } from "croner"
import { TriggerStore, getNextRun } from "./trigger-store.js"
import { TriggerYaml } from "./trigger-yaml.js"
import { ActionDispatcher, type DispatchEvent } from "./action-dispatch.js"
import { WebhookTriggerServer, type WebhookRoute } from "./webhook-server.js"
import type { MinimalOpenCodeClient, TriggerPluginOptions, TriggerRecord, TriggerSyncResult, CronSourceConfig, WebhookSourceConfig } from "./types.js"

const KORTIX_MASTER_URL = "http://localhost:8000"

export class TriggerManager {
  private readonly store: TriggerStore
  private readonly yamlSync: TriggerYaml
  private readonly dispatcher: ActionDispatcher
  private readonly webhookServer: WebhookTriggerServer
  private readonly cronJobs = new Map<string, Cron>()
  private started = false

  constructor(
    private readonly client: MinimalOpenCodeClient,
    private readonly options: TriggerPluginOptions = {},
  ) {
    const directory = options.directory ?? process.cwd()
    const dbPath = this.resolveDbPath(directory)

    this.store = new TriggerStore(dbPath)
    this.yamlSync = new TriggerYaml(
      this.store,
      directory,
      options.logger,
      () => this.rebuildRuntime(), // callback after YAML sync
    )
    this.dispatcher = new ActionDispatcher(this.store, client, directory, options.logger)

    const host = options.webhookHost ?? "0.0.0.0"
    const port = options.webhookPort ?? 8099
    this.webhookServer = new WebhookTriggerServer(host, port, (route, payload) => this.dispatchWebhook(route, payload))
    // Pipedream handler: route events from Pipedream through the webhook server
    this.webhookServer.setPipedreamHandler((listenerId, payload) => this.dispatchPipedreamEvent(listenerId, payload))
  }

  private resolveDbPath(directory: string): string {
    // Use the central kortix.db if it exists, otherwise create in .kortix/
    const centralDb = `${directory}/.kortix/kortix.db`
    return centralDb
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.options.logger?.(level, message)
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<TriggerSyncResult> {
    if (this.started) return { total: 0, created: 0, updated: 0, removed: 0, details: [] }
    this.started = true

    // Run migration from old system if needed
    await this.migrateFromOldSystem()

    // Sync from YAML → DB
    let syncResult: TriggerSyncResult
    try {
      syncResult = this.yamlSync.syncFromYaml()
    } catch (err) {
      this.log("error", `[triggers] Initial YAML sync failed: ${err instanceof Error ? err.message : String(err)}`)
      syncResult = { total: 0, created: 0, updated: 0, removed: 0, details: [`Sync error: ${err instanceof Error ? err.message : String(err)}`] }
    }

    // Start runtimes
    this.rebuildRuntime()
    await this.webhookServer.start()
    this.yamlSync.startWatching()

    this.log("info", `[triggers] Started: ${syncResult.total} triggers, ${this.cronJobs.size} cron jobs`)
    return syncResult
  }

  async stop(): Promise<void> {
    this.yamlSync.stopWatching()
    for (const job of this.cronJobs.values()) job.stop()
    this.cronJobs.clear()
    await this.webhookServer.stop()
    this.started = false
  }

  // ─── Runtime rebuild (after YAML sync or config change) ───────────────────

  private rebuildRuntime(): void {
    // Stop all existing cron jobs
    for (const job of this.cronJobs.values()) job.stop()
    this.cronJobs.clear()

    // Schedule active cron triggers
    const triggers = this.store.list({ is_active: true })
    for (const trigger of triggers) {
      if (trigger.source_type === "cron") {
        this.scheduleCron(trigger)
      }
    }

    // Rebuild webhook routes
    this.rebuildWebhookRoutes()
  }

  private scheduleCron(trigger: TriggerRecord): void {
    const sc = JSON.parse(trigger.source_config) as CronSourceConfig
    if (!sc.cron_expr) return

    try {
      const job = new Cron(sc.cron_expr, { timezone: sc.timezone ?? "UTC" }, async () => {
        await this.dispatcher.dispatch(trigger.id, {
          type: "cron.tick",
          manual: false,
          timestamp: new Date().toISOString(),
        })
      })
      this.cronJobs.set(trigger.id, job)
    } catch (err) {
      this.log("error", `[triggers] Failed to schedule cron ${trigger.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private rebuildWebhookRoutes(): void {
    const triggers = this.store.list({ source_type: "webhook", is_active: true })
    const routes: WebhookRoute[] = []

    for (const trigger of triggers) {
      const sc = JSON.parse(trigger.source_config) as WebhookSourceConfig
      const ac = JSON.parse(trigger.action_config) as Record<string, unknown>
      const ctx = JSON.parse(trigger.context_config || "{}") as Record<string, unknown>

      const route: WebhookRoute = {
        agentName: trigger.agent_name ?? "kortix",
        trigger: {
          name: trigger.name,
          source: {
            type: "webhook" as const,
            path: sc.path,
            method: sc.method,
            secret: sc.secret,
          },
          execution: {
            prompt: (ac.prompt as string) ?? "",
            agentName: trigger.agent_name ?? undefined,
            modelId: trigger.model_id ?? undefined,
            sessionMode: trigger.session_mode === "reuse" ? "reuse" : "new",
          },
          context: (ctx.extract || ctx.include_raw !== undefined) ? {
            extract: ctx.extract as Record<string, string>,
            includeRaw: ctx.include_raw as boolean,
          } : undefined,
        },
      }
      routes.push(route)
    }

    this.webhookServer.setRoutes(routes)
  }

  // ─── Webhook dispatch ─────────────────────────────────────────────────────

  private async dispatchWebhook(route: any, payload: { body: string; headers: Record<string, string>; method: string; path: string }): Promise<{ sessionId: string }> {
    // Find the trigger by webhook path
    const triggers = this.store.list({ source_type: "webhook" })
    const trigger = triggers.find((t) => {
      const sc = JSON.parse(t.source_config) as WebhookSourceConfig
      return sc.path === payload.path || sc.path === route.trigger.source.path
    })

    if (!trigger) {
      throw new Error(`No trigger found for webhook path: ${payload.path}`)
    }

    const parsedBody = (() => {
      try { return JSON.parse(payload.body) } catch { return payload.body }
    })()

    const result = await this.dispatcher.dispatch(trigger.id, {
      type: "webhook.request",
      manual: false,
      timestamp: new Date().toISOString(),
      data: {
        method: payload.method,
        path: payload.path,
        headers: payload.headers,
        body: parsedBody,
      },
    })

    return { sessionId: result.sessionId ?? "unknown" }
  }

  // ─── Pipedream event dispatch ─────────────────────────────────────────────

  private async dispatchPipedreamEvent(listenerId: string, payload: { body: string; headers: Record<string, string> }): Promise<{ sessionId: string } | { error: string; status: number }> {
    // Find trigger by Pipedream-related path or by matching listener patterns
    const triggers = this.store.list({ source_type: "webhook" })
    const trigger = triggers.find((t) => {
      const sc = JSON.parse(t.source_config) as WebhookSourceConfig
      return sc.path?.includes(listenerId) || sc.path === `/events/pipedream/${listenerId}`
    })

    if (!trigger) {
      return { error: `Unknown listener: ${listenerId}`, status: 404 }
    }

    if (!trigger.is_active) {
      return { error: `Listener is paused: ${listenerId}`, status: 403 }
    }

    const parsedBody = (() => {
      try { return JSON.parse(payload.body) } catch { return payload.body }
    })()

    this.store.recordEvent(trigger.id)

    const result = await this.dispatcher.dispatch(trigger.id, {
      type: "pipedream.event",
      manual: false,
      timestamp: new Date().toISOString(),
      data: parsedBody,
    })

    return { sessionId: result.sessionId ?? "unknown" }
  }

  // ─── Public API (used by routes + plugin tools) ───────────────────────────

  getStore(): TriggerStore {
    return this.store
  }

  getYamlSync(): TriggerYaml {
    return this.yamlSync
  }

  getPublicBaseUrl(): string {
    return this.options.publicBaseUrl ?? `http://localhost:${this.options.webhookPort ?? 8099}`
  }

  /** Create trigger via API: write to YAML + DB, rebuild runtime */
  createTrigger(input: Parameters<TriggerStore["create"]>[0]): TriggerRecord {
    const trigger = this.store.create(input)
    this.yamlSync.writeThrough()
    this.rebuildRuntime()
    return trigger
  }

  /** Update trigger config via API: update DB + YAML, rebuild runtime */
  updateTrigger(id: string, patch: Parameters<TriggerStore["update"]>[1]): TriggerRecord | null {
    const trigger = this.store.update(id, patch)
    if (!trigger) return null
    // Only write through to YAML for config changes, not runtime state
    if (patch.source_config || patch.action_config || patch.name || patch.description !== undefined || patch.context_config || patch.agent_name !== undefined || patch.model_id !== undefined || patch.session_mode) {
      this.yamlSync.writeThrough()
    }
    this.rebuildRuntime()
    return trigger
  }

  /** Delete trigger: remove from DB + YAML, rebuild runtime */
  deleteTrigger(id: string): boolean {
    const result = this.store.delete(id)
    if (result) {
      this.yamlSync.writeThrough()
      this.rebuildRuntime()
    }
    return result
  }

  /** Pause trigger: DB only (runtime state), rebuild cron schedule */
  pauseTrigger(id: string): TriggerRecord | null {
    const trigger = this.store.update(id, { is_active: false })
    if (trigger) {
      // Unschedule cron job
      const job = this.cronJobs.get(id)
      if (job) { job.stop(); this.cronJobs.delete(id) }
      this.rebuildWebhookRoutes()
    }
    return trigger
  }

  /** Resume trigger: DB only (runtime state), rebuild cron schedule */
  resumeTrigger(id: string): TriggerRecord | null {
    const trigger = this.store.update(id, { is_active: true })
    if (trigger) {
      if (trigger.source_type === "cron") this.scheduleCron(trigger)
      this.rebuildWebhookRoutes()
    }
    return trigger
  }

  /** Run trigger manually */
  async runTrigger(id: string): Promise<{ executionId: string } | null> {
    const trigger = this.store.get(id)
    if (!trigger) return null
    const result = await this.dispatcher.dispatch(id, {
      type: trigger.source_type === "cron" ? "cron.tick" : "webhook.request",
      manual: true,
      timestamp: new Date().toISOString(),
    })
    return { executionId: result.executionId }
  }

  /** Force re-read YAML → DB */
  sync(): TriggerSyncResult {
    const result = this.yamlSync.syncFromYaml()
    this.rebuildRuntime()
    return result
  }

  // ─── Migration from old system ────────────────────────────────────────────

  private async migrateFromOldSystem(): Promise<void> {
    const { existsSync, readFileSync } = await import("node:fs")
    const path = await import("node:path")
    const directory = this.options.directory ?? process.cwd()
    const oldDir = path.join(directory, ".kortix", "agent-triggers")
    const migratedMarker = path.join(oldDir, ".migrated-v2")

    if (existsSync(migratedMarker)) return // Already migrated
    if (!existsSync(oldDir)) return // Nothing to migrate

    this.log("info", "[triggers] Migrating from old trigger system...")

    let migrated = 0

    // 1. Migrate old triggers.sqlite
    const oldSqlitePath = path.join(oldDir, "triggers.sqlite")
    if (existsSync(oldSqlitePath)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Database } = require("bun:sqlite")
        const oldDb = new Database(oldSqlitePath, { readonly: true })
        const rows = oldDb.query("SELECT * FROM cron_triggers").all() as any[]
        for (const row of rows) {
          const existing = this.store.getByName(row.name)
          if (existing) continue
          this.store.create({
            name: row.name,
            source_type: "cron",
            source_config: { cron_expr: row.cron_expr, timezone: row.timezone ?? "UTC" },
            action_type: "prompt",
            action_config: { prompt: row.prompt },
            agent_name: row.agent_name,
            model_id: row.model_id,
            session_mode: row.session_mode ?? "new",
          })
          migrated++
        }
        oldDb.close()
        this.log("info", `[triggers] Migrated ${migrated} cron triggers from old SQLite`)
      } catch (err) {
        this.log("warn", `[triggers] Failed to migrate old SQLite: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 2. Migrate old listener-state.json
    const oldListenerPath = path.join(oldDir, "listener-state.json")
    if (existsSync(oldListenerPath)) {
      try {
        const raw = JSON.parse(readFileSync(oldListenerPath, "utf8"))
        const listeners = Array.isArray(raw.listeners) ? raw.listeners : []
        for (const listener of listeners) {
          const existing = this.store.getByName(listener.name)
          if (existing) continue
          this.store.create({
            name: listener.name,
            source_type: "webhook",
            source_config: { path: `/events/pipedream/${listener.id}`, method: "POST" },
            action_type: "prompt",
            action_config: { prompt: listener.prompt },
            agent_name: listener.agentName,
            model_id: listener.modelId,
            session_mode: listener.sessionMode ?? "new",
            pipedream_app: listener.app,
            pipedream_component: listener.componentKey,
            pipedream_props: listener.configuredProps,
          })
          migrated++
        }
        this.log("info", `[triggers] Migrated ${listeners.length} Pipedream listeners from old JSON`)
      } catch (err) {
        this.log("warn", `[triggers] Failed to migrate old listeners: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 3. Migrate agent YAML triggers
    try {
      const { discoverAgentsWithTriggers } = await import("./parser.js")
      const agents = discoverAgentsWithTriggers({ directory, homeDir: directory })
      for (const agent of agents) {
        for (const trigger of agent.triggers) {
          const fullName = `${agent.name}:${trigger.name}`
          const existing = this.store.getByName(fullName)
          if (existing) continue

          if (trigger.source.type === "cron") {
            this.store.create({
              name: fullName,
              source_type: "cron",
              source_config: { cron_expr: trigger.source.expr, timezone: trigger.source.timezone ?? "UTC" },
              action_type: "prompt",
              action_config: { prompt: trigger.execution.prompt },
              agent_name: trigger.execution.agentName ?? agent.name,
              model_id: trigger.execution.modelId,
              session_mode: trigger.execution.sessionMode ?? "new",
            })
            migrated++
          } else if (trigger.source.type === "webhook") {
            this.store.create({
              name: fullName,
              source_type: "webhook",
              source_config: { path: trigger.source.path, method: trigger.source.method ?? "POST", secret: trigger.source.secret },
              action_type: "prompt",
              action_config: { prompt: trigger.execution.prompt },
              agent_name: trigger.execution.agentName ?? agent.name,
              model_id: trigger.execution.modelId,
              session_mode: trigger.execution.sessionMode ?? "new",
            })
            migrated++
          }
        }
      }
      this.log("info", `[triggers] Migrated ${migrated} triggers from agent YAML`)
    } catch (err) {
      this.log("warn", `[triggers] Failed to migrate agent YAML triggers: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 4. Flush migrated state to triggers.yaml
    if (migrated > 0) {
      this.yamlSync.flushToYaml()
      this.log("info", `[triggers] Flushed ${migrated} migrated triggers to triggers.yaml`)
    }

    // 5. Mark migration complete
    try {
      const { writeFileSync: wf, mkdirSync: md } = await import("node:fs")
      md(oldDir, { recursive: true })
      wf(migratedMarker, new Date().toISOString(), "utf8")
    } catch {}
  }
}
