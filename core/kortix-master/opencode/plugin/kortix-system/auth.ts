import { generatePKCE } from "@openauthjs/openauth/pkce"
import type { Plugin } from "@opencode-ai/plugin"
import type { Auth, Provider } from "@opencode-ai/sdk"

const clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const tokenURL = "https://platform.claude.com/v1/oauth/token"
const authUserAgent = "claude-code/2.1.76"
const tokenUserAgent = "axios/1.13.6"
const expiresSkewMs = 5 * 60 * 1000
const oauthTokenLifetimeSeconds = 31536000
const toolPrefix = "mcp_"
const requiredBetas = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
]
const consoleAuthScopes = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
].join(" ")
const maxAuthScope = "user:inference"

type OAuthAuth = Extract<Auth, { type: "oauth" }>
type HeaderInput = Headers | Array<[string, string]> | Record<string, string | number | boolean | undefined>

function zero(provider: Provider) {
  for (const model of Object.values(provider.models)) {
    model.cost = {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    }
  }
}

function merge(init?: HeaderInput, req?: Request) {
  const headers = new Headers()
  if (req) req.headers.forEach((value, key) => headers.set(key, value))
  if (!init) return headers
  if (init instanceof Headers) {
    init.forEach((value, key) => headers.set(key, value))
    return headers
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) headers.set(key, value)
    return headers
  }
  for (const [key, value] of Object.entries(init)) {
    if (value !== undefined) headers.set(key, String(value))
  }
  return headers
}

function betas(input: string) {
  return [...new Set([...requiredBetas, ...input.split(",").map((item) => item.trim()).filter(Boolean)])].join(",")
}

function patchText(value: string) {
  return value.replace(/OpenCode/g, "Claude Code").replace(/opencode/gi, "Claude")
}

function authHeaders(extra?: HeaderInput) {
  return merge(
    {
      "Content-Type": "application/json",
      "User-Agent": authUserAgent,
    },
    extra instanceof Request ? extra : undefined,
  )
}

function tokenHeaders(extra?: HeaderInput) {
  return merge({
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "User-Agent": tokenUserAgent,
    ...(extra ?? {}),
  })
}

function patchBody(raw: string) {
  try {
    const body = JSON.parse(raw) as {
      system?: Array<{ type?: string; text?: string }>
      tools?: Array<{ name?: string }>
      messages?: Array<{ content?: Array<{ type?: string; name?: string }> }>
    }

    if (Array.isArray(body.system)) {
      body.system = body.system.map((item) => {
        if (item.type !== "text" || !item.text) return item
        return {
          ...item,
          text: patchText(item.text),
        }
      })
    }

    if (Array.isArray(body.tools)) {
      body.tools = body.tools.map((item) => ({
        ...item,
        name: item.name ? `${toolPrefix}${item.name}` : item.name,
      }))
    }

    if (Array.isArray(body.messages)) {
      body.messages = body.messages.map((msg) => {
        if (!Array.isArray(msg.content)) return msg
        return {
          ...msg,
          content: msg.content.map((block) => {
            if (block.type !== "tool_use" || !block.name) return block
            return {
              ...block,
              name: `${toolPrefix}${block.name}`,
            }
          }),
        }
      })
    }

    return JSON.stringify(body)
  } catch {
    return raw
  }
}

function parseCallbackCode(input: string, fallbackState: string) {
  const value = input.trim()

  if (value.includes("#") && !value.startsWith("http://") && !value.startsWith("https://")) {
    const [code, state] = value.split("#")
    return {
      code,
      state: state || fallbackState,
    }
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value)
    return {
      code: url.searchParams.get("code") || url.hash.replace(/^#/, "") || value,
      state: url.searchParams.get("state") || fallbackState,
    }
  }

  if (value.includes("code=") || value.includes("state=")) {
    const params = new URLSearchParams(value.replace(/^\?/, ""))
    return {
      code: params.get("code") || value,
      state: params.get("state") || fallbackState,
    }
  }

  return {
    code: value,
    state: fallbackState,
  }
}

async function authorize(mode: "max" | "console") {
  const pkce = await generatePKCE()
  const state = (await generatePKCE()).verifier
  const redirectURI = mode === "max"
    ? `http://localhost:${Math.floor(40000 + Math.random() * 20000)}/callback`
    : "https://console.anthropic.com/oauth/code/callback"
  const url = new URL(`https://${mode === "console" ? "console.anthropic.com" : "claude.ai"}/oauth/authorize`)
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", clientID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", redirectURI)
  url.searchParams.set("scope", mode === "max" ? maxAuthScope : consoleAuthScopes)
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)
  return {
    url: url.toString(),
    verifier: pkce.verifier,
    state,
    redirectURI,
  }
}

async function exchange(code: string, verifier: string, state: string, redirectURI: string) {
  const parsed = parseCallbackCode(code, state)
  let response: Response
  try {
    response = await fetch(tokenURL, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({
        code: parsed.code,
        state: parsed.state,
        grant_type: "authorization_code",
        client_id: clientID,
        redirect_uri: redirectURI,
        code_verifier: verifier,
        expires_in: oauthTokenLifetimeSeconds,
      }),
    })
  } catch (error) {
    console.error("[anthropic-auth] token exchange request threw", {
      message: error instanceof Error ? error.message : String(error),
      parsed,
    })
    throw error
  }
  if (!response.ok) {
    console.error("[anthropic-auth] token exchange failed", {
      status: response.status,
      body: await response.text().catch(() => ""),
      parsed,
    })
    return { type: "failed" as const }
  }
  const json = (await response.json()) as {
    refresh_token: string
    access_token: string
    expires_in: number
  }
  return {
    type: "success" as const,
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000 - expiresSkewMs,
  }
}

async function refresh(client: { auth: { set: (input: { path: { id: string }; body: OAuthAuth }) => Promise<unknown> } }, auth: OAuthAuth) {
  if (auth.access && auth.expires > Date.now()) return auth.access
  let response: Response
  try {
    response = await fetch(tokenURL, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: clientID,
        scope: maxAuthScope,
      }),
    })
  } catch (error) {
    console.error("[anthropic-auth] token refresh request threw", {
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  if (!response.ok) throw new Error(`Anthropic token refresh failed: ${response.status}`)
  const json = (await response.json()) as {
    refresh_token: string
    access_token: string
    expires_in: number
  }
  await client.auth.set({
    path: { id: "anthropic" },
    body: {
      type: "oauth",
      refresh: json.refresh_token,
      access: json.access_token,
      expires: Date.now() + json.expires_in * 1000 - expiresSkewMs,
    },
  })
  return json.access_token
}

const AnthropicAuthPlugin: Plugin = async (input) => {
  return {
    "experimental.chat.system.transform": async ({ model }, output) => {
      if (model.providerID !== "anthropic") return
      const prefix = "You are Claude Code, Anthropic's official CLI for Claude."
      output.system.unshift(prefix)
      if (output.system[1]) output.system[1] = `${prefix}\n\n${output.system[1]}`
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (!auth || auth.type !== "oauth") return {}

        zero(provider)

        return {
          apiKey: "",
          async fetch(value: Request | URL | string, init?: RequestInit) {
            const current = await getAuth()
            if (!current || current.type !== "oauth") return fetch(value, init)
            const access = await refresh(input.client, current)
            const req = value instanceof Request ? value : undefined
            const headers = merge(init?.headers, req)
            headers.set("authorization", `Bearer ${access}`)
            headers.set("anthropic-beta", betas(headers.get("anthropic-beta") ?? ""))
            headers.set("user-agent", authUserAgent)
            headers.delete("x-api-key")

            let body = init?.body
            if (typeof body === "string") body = patchBody(body)

            let target = value
            try {
              const url = new URL(value instanceof Request ? value.url : value.toString())
              if (url.pathname === "/v1/messages" && !url.searchParams.has("beta")) {
                url.searchParams.set("beta", "true")
                target = req ? new Request(url.toString(), req) : url
              }
            } catch {}

            const response = await fetch(target, {
              ...init,
              body,
              headers,
            })

            if (!response.body) return response

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            const encoder = new TextEncoder()

            return new Response(
              new ReadableStream({
                async pull(controller) {
                  const part = await reader.read()
                  if (part.done) {
                    controller.close()
                    return
                  }
                  const text = decoder
                    .decode(part.value, { stream: true })
                    .replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"')
                  controller.enqueue(encoder.encode(text))
                },
              }),
              {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              },
            )
          },
        }
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const result = await authorize("max")
            return {
              url: result.url,
              instructions: "Open the link, sign in, then paste the redirect URL (starts with http://localhost) below",
              method: "code" as const,
              callback: async (code: string) => exchange(code, result.verifier, result.state, result.redirectURI),
            }
          },
        },
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const result = await authorize("console")
            return {
              url: result.url,
              instructions: "Paste the authorization code here: ",
              method: "code" as const,
              callback: async (code: string) => {
                const credentials = await exchange(code, result.verifier, result.state, result.redirectURI)
                if (credentials.type === "failed") return credentials
                const response = await fetch("https://api.anthropic.com/api/oauth/claude_cli/create_api_key", {
                  method: "POST",
                  headers: authHeaders({
                    authorization: `Bearer ${credentials.access}`,
                  }),
                })
                if (!response.ok) {
                  console.error("[anthropic-auth] api key creation failed", {
                    status: response.status,
                    body: await response.text().catch(() => ""),
                  })
                  return { type: "failed" as const }
                }
                const json = (await response.json()) as { raw_key: string }
                return {
                  type: "success" as const,
                  key: json.raw_key,
                }
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}

export default AnthropicAuthPlugin
