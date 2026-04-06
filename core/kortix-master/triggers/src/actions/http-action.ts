/**
 * HTTP Action — Make an outbound HTTP request. No LLM involved.
 * Captures response status and body.
 */
import type { TriggerRecord, HttpActionConfig } from "../types.js"

export interface HttpActionResult {
  httpStatus: number
  httpBody: string
}

function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, key: string) => {
    const value = values[key]
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    return JSON.stringify(value)
  })
}

function getPathValue(input: unknown, pathStr: string): unknown {
  return pathStr.split(".").reduce<unknown>((current, part) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[part]
  }, input)
}

export async function executeHttpAction(
  trigger: TriggerRecord,
  event: { type: string; data?: unknown; manual?: boolean; timestamp: string },
): Promise<HttpActionResult> {
  const config = JSON.parse(trigger.action_config) as HttpActionConfig
  const url = config.url
  if (!url) throw new Error("HTTP action requires a 'url' field")

  const timeoutMs = config.timeout_ms ?? 30_000

  // Build template variables from event data
  const templateVars: Record<string, unknown> = {}
  if (event.data && typeof event.data === "object" && !Array.isArray(event.data)) {
    for (const [key, value] of Object.entries(event.data as Record<string, unknown>)) {
      templateVars[key] = value
    }
  }
  // Add nested access: data.body.field etc.
  templateVars["data"] = event.data

  // Render body template
  let body: string | undefined
  if (config.body_template) {
    body = renderTemplate(config.body_template, templateVars)
  }

  // Render header values
  const headers: Record<string, string> = {}
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = renderTemplate(value, templateVars)
    }
  }

  const res = await fetch(url, {
    method: config.method ?? "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })

  const responseBody = await res.text()

  // Truncate large response
  const maxBody = 50_000
  return {
    httpStatus: res.status,
    httpBody: responseBody.length > maxBody ? responseBody.slice(0, maxBody) + "\n... (truncated)" : responseBody,
  }
}
