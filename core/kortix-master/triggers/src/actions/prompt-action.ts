/**
 * Prompt Action — Send a prompt to an OpenCode agent session.
 * This is the existing dispatch behavior, extracted into its own module.
 */
import type { MinimalOpenCodeClient, TriggerRecord, ExecutionRecord, PromptActionConfig, ContextConfig } from "../types.js"

function parseModel(modelId?: string | null): { providerID: string; modelID: string } | undefined {
  if (!modelId) return undefined
  const [providerID, ...rest] = modelId.split("/")
  if (!providerID || rest.length === 0) return { providerID: "kortix", modelID: modelId }
  return { providerID, modelID: rest.join("/") }
}

function getPathValue(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[part]
  }, input)
}

function renderPrompt(template: string, values: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, key: string) => {
    const value = values[key]
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    return JSON.stringify(value)
  })
}

export interface PromptActionResult {
  sessionId: string
}

export async function executePromptAction(
  client: MinimalOpenCodeClient,
  trigger: TriggerRecord,
  event: { type: string; data?: unknown; manual?: boolean; timestamp: string },
  options: { directory?: string; reusedSessions: Map<string, string> },
): Promise<PromptActionResult> {
  const actionConfig = JSON.parse(trigger.action_config) as PromptActionConfig
  const contextConfig = JSON.parse(trigger.context_config || "{}") as ContextConfig
  const prompt = actionConfig.prompt ?? ""

  // Extract context values from event data
  const extracted: Record<string, unknown> = {}
  if (contextConfig.extract && event.data) {
    for (const [key, extractPath] of Object.entries(contextConfig.extract)) {
      extracted[key] = getPathValue(event, extractPath)
    }
  }

  // Flatten top-level event data fields for template rendering
  const flatData: Record<string, unknown> = {}
  if (event.data && typeof event.data === "object" && !Array.isArray(event.data)) {
    for (const [key, value] of Object.entries(event.data as Record<string, unknown>)) {
      flatData[key] = value
    }
  }

  // Build prompt text
  const renderedPrompt = renderPrompt(prompt, { ...flatData, ...extracted })
  const sections = [renderedPrompt]

  if (Object.keys(extracted).length > 0) {
    sections.push("", "<trigger_context_values>", JSON.stringify(extracted, null, 2), "</trigger_context_values>")
  }

  const normalizedEvent = {
    type: event.type,
    trigger: trigger.name,
    data: event.data ?? { timestamp: event.timestamp, manual: event.manual ?? false },
  }

  if (contextConfig.include_raw !== false) {
    sections.push("", "<trigger_event>", JSON.stringify(normalizedEvent, null, 2), "</trigger_event>")
  }

  const bodyText = sections.join("\n")

  // Session management
  const agentName = trigger.agent_name ?? actionConfig.agent
  const modelId = trigger.model_id ?? actionConfig.model
  const sessionMode = trigger.session_mode ?? actionConfig.session_mode ?? "new"
  const reuseKey = `trigger:${trigger.name}`
  let sessionId = sessionMode === "reuse"
    ? (options.reusedSessions.get(reuseKey) ?? trigger.session_id ?? undefined)
    : undefined

  if (!sessionId) {
    const created = await client.session.create({
      body: {
        directory: options.directory,
        title: trigger.name,
      },
    }) as { data?: { id: string }; id?: string }
    sessionId = created.data?.id ?? created.id
    if (!sessionId) throw new Error("session.create did not return an id")
    if (sessionMode === "reuse") options.reusedSessions.set(reuseKey, sessionId)
  }

  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      agent: agentName ?? undefined,
      model: parseModel(modelId),
      parts: [{ type: "text", text: bodyText }],
    },
  })

  return { sessionId }
}
