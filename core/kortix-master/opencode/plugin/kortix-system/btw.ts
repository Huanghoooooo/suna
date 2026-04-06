/**
 * /btw Plugin — Quick Side Questions
 *
 * Ported from Claude Code's /btw command (commands/btw/).
 *
 * What it does:
 *   User types "/btw <question>" → a lightweight forked agent answers the
 *   question using the current conversation context WITHOUT tools. The
 *   answer is injected as an assistant message in the same session. The
 *   main agent context is NOT interrupted.
 *
 * How it works in CC (source of truth):
 *   1. /btw is a `local-jsx` command (immediate, renders React overlay)
 *   2. Calls `runSideQuestion()` which wraps the question in a system-reminder
 *      instructing the agent it has NO tools, is a separate lightweight instance,
 *      and must answer in a single turn.
 *   3. Uses `runForkedAgent()` with `maxTurns: 1`, all tools denied,
 *      `skipCacheWrite: true` to share the parent prompt cache.
 *   4. Response extracted from assistant messages, displayed in scrollable overlay.
 *
 * OpenCode adaptation:
 *   We can't fork the model in-process like CC does. Instead we use the
 *   SDK client to send the question as a new message in the current session
 *   with a preamble that frames it as a side question. The `command.execute.before`
 *   hook intercepts "/btw" and rewrites the user parts to include the side-question
 *   framing from CC's sideQuestion.ts.
 *
 * Files:
 *   btw.ts — this plugin (hook + command rewriter)
 *   ../../commands/btw.md — the slash command definition (frontmatter)
 */

import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin"

// ── Constants ────────────────────────────────────────────────────────────────

const COMMAND_NAME = "btw"

/**
 * System-reminder framing from CC's sideQuestion.ts.
 * Instructs the model to answer without tools in a single turn.
 */
const SIDE_QUESTION_PREAMBLE = `<system-reminder>This is a quick side question from the user ("/btw"). Answer it directly in a single response.

IMPORTANT CONTEXT:
- You are answering a quick side question — the user wants a fast answer without disrupting the main task.
- You share the full conversation context and can reference anything discussed so far.
- Keep your answer concise and direct — this is meant to be a quick clarification, not a deep dive.

CRITICAL CONSTRAINTS:
- Do NOT use any tools — no file reads, no bash commands, no searches, no web fetches. Answer from what you already know.
- This is a one-off response — keep it short and focused.
- NEVER say "Let me check...", "I'll look into...", "Let me search..." — you cannot take actions.
- If you don't know the answer from the current context, say so plainly — do not offer to investigate.
- Do NOT reference "being interrupted" or "what you were doing" — that framing is incorrect. This is a separate lightweight question.

Answer the question below concisely.</system-reminder>

`

// ── Plugin ────────────────────────────────────────────────────────────────────

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
	return {
		/**
		 * Intercept the /btw command before it executes.
		 * Rewrite the user message parts to include the side-question framing.
		 */
		"command.execute.before": async (
			cmd: { command: string; sessionID: string; arguments: string },
			output: { parts: any[] },
		) => {
			if (cmd.command !== COMMAND_NAME) return

			const question = cmd.arguments?.trim()
			if (!question) {
				// Empty /btw — inject a usage hint as the message
				output.parts = [
					{
						type: "text" as const,
						text: "Usage: /btw <your question>\n\nAsk a quick side question without interrupting the main task. The answer uses only what's already in the conversation context — no tools are called.",
					},
				]
				return
			}

			// Rewrite the parts to include the side-question preamble + original question
			output.parts = [
				{
					type: "text" as const,
					text: `${SIDE_QUESTION_PREAMBLE}${question}`,
				},
			]
		},
	}
}

export default { id: "btw", server: plugin }
