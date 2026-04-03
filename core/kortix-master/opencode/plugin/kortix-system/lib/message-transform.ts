// ============================================================================
// Kortix System XML Tags — wrap internal/system content for conditional rendering
// ============================================================================
//
// Usage: Wrap any system/internal content (instructions, reminders, AGENTS.md
// injected content, etc.) in these XML tags. The frontend strips content inside
// these tags before rendering, so internal content never appears in the UI.
//
// Examples:
//   <kortix_system>AGENTS.md instruction content here</kortix_system>
//   <kortix_system reminder="project-gate">Project must be selected first</kortix_system>
//   <kortix_system type="instruction" source="AGENTS.md">System prompt...</kortix_system>

export const MEMORY_CONTEXT_MARKER = "<!-- kortix-mem-context -->"
export const MEMORY_CONTEXT_MESSAGE_ID = "__kortix_mem_context__"

export const KORTIX_SYSTEM_OPEN_TAG = "<kortix_system"
export const KORTIX_SYSTEM_CLOSE_TAG = "</kortix_system>"

/**
 * Check if text contains any kortix_system XML tags.
 */
export function containsKortixSystemTags(text: string): boolean {
	return text.includes(KORTIX_SYSTEM_OPEN_TAG) && text.includes(KORTIX_SYSTEM_CLOSE_TAG)
}

/**
 * Wrap text content in kortix_system XML tags with optional attributes.
 * 
 * @param content - The text content to wrap
 * @param attrs - Optional attributes (e.g., { type: "instruction", source: "AGENTS.md" })
 * @returns The wrapped text, e.g., '<kortix_system type="instruction" source="AGENTS.md">content</kortix_system>'
 */
export function wrapInKortixSystemTags(
	content: string,
	attrs?: Record<string, string>,
): string {
	if (!content || !content.trim()) return ""
	
	const attrString = attrs
		? " " + Object.entries(attrs)
			.map(([k, v]) => `${k}="${v}"`)
			.join(" ")
		: ""
	
	return `${KORTIX_SYSTEM_OPEN_TAG}${attrString}>${content}${KORTIX_SYSTEM_CLOSE_TAG}`
}

/**
 * Strip all kortix_system XML tags and their content from text.
 * Use this in the frontend to remove internal content before rendering.
 * 
 * @param text - Text containing kortix_system tags
 * @returns Text with all kortix_system content removed
 */
export function stripKortixSystemTags(text: string): string {
	if (!text) return ""
	
	// Pattern to match <kortix_system ...>...</kortix_system> with optional attributes
	// Handles multiline content
	const SYSTEM_TAG_REGEX = /<kortix_system[^>]*>[\s\S]*?<\/kortix_system>/gi
	
	return text.replace(SYSTEM_TAG_REGEX, "").trim()
}

/**
 * Extract all kortix_system content blocks from text without removing them.
 * Useful for debugging or logging what system content was injected.
 * 
 * @param text - Text containing kortix_system tags
 * @returns Array of content blocks found inside kortix_system tags
 */
export function extractKortixSystemContent(text: string): string[] {
	if (!text) return []
	
	const SYSTEM_TAG_REGEX = /<kortix_system[^>]*>([\s\S]*?)<\/kortix_system>/gi
	const results: string[] = []
	let match
	
	while ((match = SYSTEM_TAG_REGEX.exec(text)) !== null) {
		if (match[1]) results.push(match[1].trim())
	}
	
	return results
}

/**
 * Wrap multiple lines or content blocks in kortix_system tags.
 * Automatically handles multiline content.
 * 
 * @param linesOrBlocks - Array of strings to wrap, or a single string
 * @param attrs - Optional attributes for the wrapper tag
 * @returns Single string with all content wrapped
 */
export function wrapLinesInKortixSystemTags(
	linesOrBlocks: string | string[],
	attrs?: Record<string, string>,
): string {
	const content = Array.isArray(linesOrBlocks)
		? linesOrBlocks.filter(Boolean).join("\n\n")
		: linesOrBlocks
	
	if (!content.trim()) return ""
	
	return wrapInKortixSystemTags(content, attrs)
}

// ============================================================================
// Memory context marker (existing functionality)
// ============================================================================

export interface ChatMessagePart {
	type?: string
	text?: string
	[key: string]: unknown
}

export interface ChatMessage {
	info?: {
		role?: string
		id?: string
		sessionID?: string
		[key: string]: unknown
	}
	parts?: ChatMessagePart[]
	[key: string]: unknown
}

function isMemoryContextPart(part: ChatMessagePart | undefined): boolean {
	return part?.type === "text" && typeof part.text === "string" && part.text.includes(MEMORY_CONTEXT_MARKER)
}

function stripExistingMemoryContext(messages: ChatMessage[]): void {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (!message) continue
		if (!Array.isArray(message.parts) || message.parts.length === 0) {
			if (message.info?.id === MEMORY_CONTEXT_MESSAGE_ID) messages.splice(i, 1)
			continue
		}
		const filtered = message.parts.filter((part) => !isMemoryContextPart(part))
		if (filtered.length === 0 && message.info?.id === MEMORY_CONTEXT_MESSAGE_ID) {
			messages.splice(i, 1)
			continue
		}
		if (filtered.length !== message.parts.length) message.parts = filtered
	}
}

export function upsertMemoryContextAtPromptEnd(messages: ChatMessage[], syntheticText: string, sessionID?: string): void {
	stripExistingMemoryContext(messages)
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message?.info?.role !== "user") continue
		if (!Array.isArray(message.parts)) message.parts = []
		message.parts.push({ type: "text", text: syntheticText })
		return
	}
	messages.push({
		info: {
			role: "user",
			id: MEMORY_CONTEXT_MESSAGE_ID,
			sessionID: sessionID ?? "",
			createdAt: new Date().toISOString(),
		} as ChatMessage["info"],
		parts: [{ type: "text", text: syntheticText }],
	})
}
