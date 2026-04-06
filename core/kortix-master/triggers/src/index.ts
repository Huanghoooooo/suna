import { createTriggersPlugin } from "./plugin.js"

// ─── New unified trigger system ─────────────────────────────────────────────
export { TriggerStore, isValidCronExpression, getNextRun, describeCron } from "./trigger-store.js"
export { TriggerYaml } from "./trigger-yaml.js"
export { TriggerManager } from "./trigger-manager.js"
export { ActionDispatcher } from "./action-dispatch.js"
export { executePromptAction } from "./actions/prompt-action.js"
export { executeCommandAction } from "./actions/command-action.js"
export { executeHttpAction } from "./actions/http-action.js"
export { WebhookTriggerServer } from "./webhook-server.js"
export { createTriggersPlugin } from "./plugin.js"

// ─── Legacy compat exports (used by existing code during transition) ────────
export { TriggerStore as CronStoreSqlite, TriggerStore as CronStore } from "./trigger-store.js"
export { CronManager } from "./cron-manager.js"
export { discoverAgentsWithTriggers, resolveAgentPaths } from "./parser.js"

// Legacy: opencode-http-dispatch functions (no longer separate file)
export function buildCronTriggerEventText(trigger: any, event: any): string {
  return [
    trigger.prompt,
    "",
    "<trigger_event>",
    JSON.stringify({ type: event.type, trigger: trigger.name, data: { timestamp: event.timestamp, manual: event.manual } }, null, 2),
    "</trigger_event>",
  ].join("\n")
}

export async function dispatchCronTriggerViaHttp(trigger: any, event: any, options: { baseUrl: string; timeoutMs?: number }): Promise<{ sessionId: string; response: { accepted: true } }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 300000)
  try {
    const bodyText = buildCronTriggerEventText(trigger, event)
    const sessionRes = await fetch(`${options.baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trigger.agent_name ? { agent: trigger.agent_name } : {}),
      signal: controller.signal,
    })
    if (!sessionRes.ok) throw new Error(`Failed to create session: ${sessionRes.status} ${await sessionRes.text()}`)
    const session = await sessionRes.json() as { id: string }
    const promptRes = await fetch(`${options.baseUrl}/session/${session.id}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: bodyText }],
        agent: trigger.agent_name ?? undefined,
      }),
      signal: controller.signal,
    })
    if (!promptRes.ok) throw new Error(`Failed to send prompt: ${promptRes.status} ${await promptRes.text()}`)
    await promptRes.text()
    return { sessionId: session.id, response: { accepted: true } }
  } finally {
    clearTimeout(timeout)
  }
}

// Legacy type re-exports
export type {
  // New types
  SourceType,
  ActionType,
  TriggerRecord,
  ExecutionRecord,
  ExecutionStatus,
  CronSourceConfig,
  WebhookSourceConfig,
  PromptActionConfig,
  CommandActionConfig,
  HttpActionConfig,
  ContextConfig,
  PipedreamConfig,
  YamlTriggerEntry,
  TriggersYamlFile,
  TriggerResponse,
  ExecutionResponse,
  TriggerPluginOptions,
  MinimalOpenCodeClient,
  PluginContextShape,
  // Legacy compat types
  TriggerKind,
  TriggerExecutionConfig,
  TriggerContextConfig,
  TriggerBase,
  CronTriggerConfig,
  WebhookTriggerConfig,
  PipedreamSourceConfig as PipedreamSourceConfigLegacy,
  PipedreamTriggerConfig,
  AgentTriggerConfig,
  DiscoveredAgent,
  CronTriggerRecord,
  CronExecutionStatus,
  CronExecutionRecord,
  TriggerSyncResult,
  AgentTriggersPluginOptions,
  EventListenerRecord,
  WebhookDispatchResult,
} from "./types.js"

export default createTriggersPlugin()
