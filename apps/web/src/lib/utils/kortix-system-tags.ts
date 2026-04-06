/**
 * Kortix System XML — utilities for handling <kortix_system> tags.
 *
 * Backend plugins wrap internal content (session context, memory, orchestrator
 * state, PTY output, etc.) in <kortix_system type="..." source="..."> tags.
 *
 * - stripKortixSystemTags: removes ALL tags before markdown rendering
 * - extractSessionReport: parses session-report tags into structured data
 */

const KORTIX_SYSTEM_RE = /<kortix_system[^>]*>[\s\S]*?<\/kortix_system>/gi

export function stripKortixSystemTags(text: string): string {
	if (!text) return ""
	return text.replace(KORTIX_SYSTEM_RE, "").trim()
}

// ── Session Report extraction ────────────────────────────────────────────────

export interface SessionReport {
	sessionId: string
	status: "COMPLETE" | "FAILED"
	project: string
	prompt: string
	result: string
}

const SESSION_REPORT_RE = /<kortix_system[^>]*type="session-report"[^>]*>[\s\S]*?<session-report>([\s\S]*?)<\/session-report>[\s\S]*?<\/kortix_system>/i

export function extractSessionReport(text: string): SessionReport | null {
	if (!text) return null
	const match = text.match(SESSION_REPORT_RE)
	if (!match) return null

	const xml = match[1]
	const get = (tag: string) => {
		const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
		return m?.[1]?.trim() || ""
	}

	return {
		sessionId: get("session-id"),
		status: get("status") === "FAILED" ? "FAILED" : "COMPLETE",
		project: get("project"),
		prompt: get("prompt"),
		result: get("result"),
	}
}

/**
 * Check if a user message text is purely a kortix_system message
 * (no visible user content outside the tags).
 */
export function isKortixSystemOnly(text: string): boolean {
	if (!text) return false
	return stripKortixSystemTags(text).length === 0
}
