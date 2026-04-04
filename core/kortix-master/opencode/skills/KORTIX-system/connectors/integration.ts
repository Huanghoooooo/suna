#!/usr/bin/env bun
/**
 * Legacy integration CLI — delegates to kpipedream.
 * Use kpipedream directly instead.
 */
import { execSync } from "node:child_process"
import * as path from "node:path"

const cli = path.resolve(import.meta.dir, "..", "..", "..", "..", "..", "channels", "kpipedream.ts")

// Convert legacy JSON arg format to kpipedream --flag format
const [cmd, rawArgs] = process.argv.slice(2)
if (!cmd) { console.error("Usage: integration.ts <command> [json-args]"); process.exit(1) }

const args = rawArgs ? JSON.parse(rawArgs) : {}
const flags: string[] = [cmd]
for (const [k, v] of Object.entries(args)) {
    if (k === "q") flags.push("--query", String(v))
    else if (k === "apps") {
        const list = Array.isArray(v) ? v : [v]
        for (const app of list) flags.push("--app", String(app))
    }
    else if (k === "action_key") flags.push("--action", String(v))
    else if (typeof v === "object") flags.push(`--${k}`, JSON.stringify(v))
    else flags.push(`--${k}`, String(v))
}

try {
    const result = execSync(`bun run ${cli} ${flags.map(f => JSON.stringify(f)).join(" ")}`, {
        encoding: "utf8", timeout: 35000, env: { ...process.env },
    })
    process.stdout.write(result)
} catch (e: any) {
    process.stdout.write(e.stdout || "")
    process.exit(e.status || 1)
}
