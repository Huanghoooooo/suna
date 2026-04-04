/**
 * Kortix Connectors Plugin — thin wrapper around the kconnectors CLI.
 * All logic lives in channels/kconnectors.ts; this plugin just shells out.
 */

import { execSync } from "node:child_process"
import { type Plugin, tool } from "@opencode-ai/plugin"
import * as path from "node:path"

/** Resolve the kconnectors CLI path relative to this plugin */
function cliPath(): string {
	return path.resolve(import.meta.dir, "..", "..", "..", "channels", "kconnectors.ts")
}

function run(args: string): string {
	try {
		return execSync(`bun run ${cliPath()} ${args}`, {
			timeout: 10000,
			encoding: "utf8",
			env: { ...process.env },
		}).trim()
	} catch (e: any) {
		return e.stdout?.trim() || e.message || "CLI error"
	}
}

function parseResult(raw: string): any {
	try { return JSON.parse(raw) } catch { return { ok: false, error: raw } }
}

const ConnectorsPlugin: Plugin = async () => ({
	tool: {
		connector_list: tool({
			description: "List all connectors — what's connected, how, and where.",
			args: {
				filter: tool.schema.string().describe('"" for all, or filter by source/name.'),
			},
			async execute(args: { filter: string }): Promise<string> {
				const f = args.filter?.toLowerCase().trim()
				const filterArg = (f && f !== "all" && f !== "*") ? ` --filter ${JSON.stringify(f)}` : ""
				const res = parseResult(run(`list${filterArg}`))
				if (!res.ok) return res.error || "No connectors found."
				const rows = res.connectors || []
				if (!rows.length) return "No connectors found."
				const lines = rows.map((r: any) => `| ${r.name} | ${r.description || ""} | ${r.source || "—"} |`)
				return `| Name | Description | Source |\n|---|---|---|\n${lines.join("\n")}`
			},
		}),

		connector_get: tool({
			description: "Get a connector's full metadata.",
			args: { name: tool.schema.string().describe("Connector name.") },
			async execute(args: { name: string }): Promise<string> {
				const res = parseResult(run(`get ${JSON.stringify(args.name)}`))
				if (!res.ok) return res.error || `Not found: "${args.name}"`
				const c = res.connector
				const parts = [`name: ${c.name}`]
				if (c.description) parts.push(`description: ${c.description}`)
				if (c.source) parts.push(`source: ${c.source}`)
				if (c.pipedream_slug) parts.push(`pipedream_slug: ${c.pipedream_slug}`)
				if (c.env_keys) parts.push(`env: ${JSON.stringify(c.env_keys)}`)
				if (c.notes) parts.push(`notes: ${c.notes}`)
				return parts.join("\n")
			},
		}),

		connector_setup: tool({
			description: `Create or update connectors. Pass a JSON array. Only "name" is required. Fields: name, description, source (pipedream/cli/api-key/mcp/custom), pipedream_slug, env_keys (array), notes.`,
			args: {
				connectors: tool.schema.string().describe('JSON array. E.g. [{"name":"github","description":"kortix-ai org","source":"cli"}]'),
			},
			async execute(args: { connectors: string }): Promise<string> {
				// Shell-escape the JSON by passing it as a single-quoted argument
				const escaped = args.connectors.replace(/'/g, "'\\''")
				const res = parseResult(run(`add '${escaped}'`))
				if (!res.ok) return res.error || "Failed to create connectors."
				return `Created/updated ${res.created} connectors:\n${(res.connectors || []).join("\n")}`
			},
		}),

		connector_remove: tool({
			description: "Remove one or more connectors by name.",
			args: {
				names: tool.schema.string().describe('Comma-separated names or JSON array. E.g. "github,stripe" or ["github","stripe"]'),
			},
			async execute(args: { names: string }): Promise<string> {
				let list: string[]
				try { list = JSON.parse(args.names) } catch { list = args.names.split(",").map(s => s.trim()) }
				list = list.filter(Boolean)
				if (!list.length) return "No names provided."
				const res = parseResult(run(`remove ${list.join(" ")}`))
				if (!res.ok) return res.error || "Failed to remove."
				const removed = res.removed || []
				return removed.length ? `Removed: ${removed.join(", ")}` : "None found."
			},
		}),
	},
})

export default ConnectorsPlugin
