import { config } from '../../config';

/**
 * Provider / MCP secrets that the sandbox runtime may need directly.
 *
 * Keep this list intentionally narrow:
 * - LLM keys are needed by OpenCode providers running inside the sandbox.
 * - CONTEXT7_API_KEY is needed by the remote MCP entry in opencode.jsonc.
 * - Tool-provider keys are not synced here; those routes are proxied by kortix-api.
 *
 * Empty values are omitted so we do not clear secrets that were explicitly
 * configured inside the sandbox via its own /env API.
 */
export function getOptionalSandboxSecrets(): Record<string, string> {
  const candidateSecrets: Record<string, string> = {
    OPENROUTER_API_KEY: config.OPENROUTER_API_KEY,
    OPENAI_API_KEY: config.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
    XAI_API_KEY: config.XAI_API_KEY,
    GEMINI_API_KEY: config.GEMINI_API_KEY,
    GROQ_API_KEY: config.GROQ_API_KEY,
    CONTEXT7_API_KEY: config.CONTEXT7_API_KEY,
  };

  return Object.fromEntries(
    Object.entries(candidateSecrets).filter(([, value]) => !!value),
  );
}
