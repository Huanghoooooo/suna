/**
 * Preferences routes — default model management.
 *
 * GET  /kortix/preferences/model   — get current default model
 * PUT  /kortix/preferences/model   — set or clear default model
 * GET  /kortix/preferences/models  — list all available models from connected providers
 */

import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from 'zod'
import { config } from '../config'
import { ErrorResponse } from '../schemas/common'

const preferencesRouter = new Hono()

// ─── Zod schemas ────────────────────────────────────────────────────────────

const GetModelResponse = z.object({
  model: z.string().nullable().describe('Current default model in "provider/model" format, or null if not set'),
})

const SetModelBody = z.object({
  model: z.string().nullable().describe('Model in "provider/model" format, or null to clear'),
})

const SetModelResponse = z.object({
  ok: z.literal(true),
  model: z.string().nullable(),
})

const ModelInfo = z.object({
  id: z.string().describe('Model ID in "provider/alias" format'),
  name: z.string().describe('Human-readable model name'),
  provider: z.string().describe('Provider ID'),
  providerName: z.string().describe('Human-readable provider name'),
  connected: z.boolean().describe('Whether the provider is authenticated/connected'),
  cost: z.object({
    input: z.number(),
    output: z.number(),
  }).nullable().describe('Cost per million tokens, or null'),
  limit: z.object({
    context: z.number(),
    output: z.number(),
  }).describe('Token limits'),
})

const ListModelsResponse = z.object({
  models: z.array(ModelInfo),
})

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchOpenCode(path: string): Promise<Response> {
  return fetch(`http://${config.OPENCODE_HOST}:${config.OPENCODE_PORT}${path}`, {
    signal: AbortSignal.timeout(10_000),
  })
}

// ─── GET /model — current default model ─────────────────────────────────────

preferencesRouter.get('/model',
  describeRoute({
    tags: ['Preferences'],
    summary: 'Get current default model',
    description: 'Returns the current default AI model from OpenCode config.',
    responses: {
      200: { description: 'Current model', content: { 'application/json': { schema: resolver(GetModelResponse) } } },
      502: { description: 'OpenCode not reachable', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
    },
  }),
  async (c) => {
    try {
      const res = await fetchOpenCode('/config')
      const configData = await res.json() as any
      return c.json({ model: configData.model || null })
    } catch (err: any) {
      return c.json({ error: 'OpenCode not reachable', details: err?.message }, 502)
    }
  },
)

// ─── PUT /model — set or clear default model ────────────────────────────────

preferencesRouter.put('/model',
  describeRoute({
    tags: ['Preferences'],
    summary: 'Set default model',
    description: 'Set or clear the default AI model. Expects "provider/modelAlias" format, or null to clear.',
    responses: {
      200: { description: 'Model updated', content: { 'application/json': { schema: resolver(SetModelResponse) } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
      502: { description: 'OpenCode not reachable', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
    },
  }),
  async (c) => {
    try {
      const body = await c.req.json() as { model?: string | null }
      const value = body.model ?? null

      if (typeof value === 'string') {
        if (!value.includes('/')) {
          return c.json({ error: 'Invalid model format — expected "provider/modelAlias"' }, 400)
        }
      } else if (value !== null) {
        return c.json({ error: 'model must be a string or null' }, 400)
      }

      const res = await fetch(
        `http://${config.OPENCODE_HOST}:${config.OPENCODE_PORT}/config`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: value }),
          signal: AbortSignal.timeout(10_000),
        },
      )

      if (!res.ok) {
        const text = await res.text()
        return c.json({ error: `OpenCode returned ${res.status}`, details: text }, 502)
      }

      return c.json({ ok: true as const, model: value })
    } catch (err: any) {
      return c.json({ error: 'OpenCode not reachable', details: err?.message }, 502)
    }
  },
)

// ─── GET /models — list all available models ────────────────────────────────

preferencesRouter.get('/models',
  describeRoute({
    tags: ['Preferences'],
    summary: 'List available models',
    description: 'Returns a flat list of models from all connected providers.',
    responses: {
      200: { description: 'Models list', content: { 'application/json': { schema: resolver(ListModelsResponse) } } },
      502: { description: 'OpenCode not reachable', content: { 'application/json': { schema: resolver(ErrorResponse) } } },
    },
  }),
  async (c) => {
    try {
      const res = await fetchOpenCode('/provider')
      const data = await res.json() as {
        all: Array<{
          id: string
          name: string
          models: Record<string, {
            id: string
            name: string
            cost?: { input: number; output: number }
            limit: { context: number; output: number }
            attachment: boolean
            reasoning: boolean
            tool_call: boolean
          }>
        }>
        connected: string[]
        default: Record<string, string>
      }

      const connectedSet = new Set(data.connected)
      const models: z.infer<typeof ModelInfo>[] = []

      for (const provider of data.all) {
        if (!connectedSet.has(provider.id)) continue
        for (const [alias, model] of Object.entries(provider.models)) {
          models.push({
            id: `${provider.id}/${alias}`,
            name: model.name,
            provider: provider.id,
            providerName: provider.name,
            connected: true,
            cost: model.cost ? { input: model.cost.input, output: model.cost.output } : null,
            limit: { context: model.limit.context, output: model.limit.output },
          })
        }
      }

      return c.json({ models })
    } catch (err: any) {
      return c.json({ error: 'OpenCode not reachable', details: err?.message }, 502)
    }
  },
)

export default preferencesRouter
