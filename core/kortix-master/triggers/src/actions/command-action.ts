/**
 * Command Action — Run a shell command directly. No LLM involved.
 * Uses Bun.spawn to execute, captures stdout/stderr/exit code.
 */
import type { TriggerRecord, CommandActionConfig } from "../types.js"

export interface CommandActionResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function executeCommandAction(
  trigger: TriggerRecord,
  _event: { type: string; data?: unknown; manual?: boolean; timestamp: string },
): Promise<CommandActionResult> {
  const config = JSON.parse(trigger.action_config) as CommandActionConfig
  const command = config.command
  if (!command) throw new Error("Command action requires a 'command' field")

  const args = config.args ?? []
  const timeoutMs = config.timeout_ms ?? 300_000

  // Resolve workdir: use config, fall back to /workspace, then process.cwd()
  let cwd = config.workdir ?? "/workspace"
  try {
    const { existsSync } = await import("node:fs")
    if (!existsSync(cwd)) cwd = process.cwd()
  } catch {
    cwd = process.cwd()
  }

  const proc = Bun.spawn([command, ...args], {
    cwd,
    env: { ...process.env, ...(config.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  })

  // Set up timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      try { proc.kill() } catch {}
      reject(new Error(`Command timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  // Wait for exit or timeout
  const exitCode = await Promise.race([proc.exited, timeoutPromise])

  // Read output
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ""
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : ""

  // Truncate large output
  const maxOutput = 50_000
  return {
    exitCode: exitCode as number,
    stdout: stdout.length > maxOutput ? stdout.slice(0, maxOutput) + "\n... (truncated)" : stdout,
    stderr: stderr.length > maxOutput ? stderr.slice(0, maxOutput) + "\n... (truncated)" : stderr,
  }
}
