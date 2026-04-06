/**
 * Share proxy — /s/:token/*
 *
 * Public route (NO auth) that validates a share token, checks TTL,
 * then proxies to the target port on localhost.
 *
 * This is the route that shared URLs point to:
 *   https://8000--slug.kortix.cloud/s/{token}/path?__proxy_token=xxx
 *
 * The __proxy_token authenticates to the CF Worker → kortix-master.
 * The share token authenticates the specific share (port + TTL).
 * No INTERNAL_SERVICE_KEY or user auth needed — the share token IS the auth.
 */

import { Hono } from 'hono'
import { validateShare } from '../services/share-store'
import {
  FETCH_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  isTransientError,
  isConnectionRefused,
  buildUpstreamHeaders,
  readBodyOnce,
  createClientAbort,
  detectSSE,
  getFetchSignal,
} from './proxy-utils'

const shareProxyRouter = new Hono()

// Strip auth-related headers — share proxy is public, don't leak creds upstream
const EXTRA_STRIP = new Set(['authorization', 'x-proxy-token'])

shareProxyRouter.all('/:token/*', async (c) => {
  // ── CORS preflight — respond immediately, no token validation needed ────
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  const token = c.req.param('token')

  // ── Validate share token ────────────────────────────────────────────────
  const entry = validateShare(token)
  if (!entry) {
    return c.json({
      error: 'Share link expired or invalid',
      hint: 'This link has expired. Ask for a new share link.',
    }, 410)  // 410 Gone — the resource existed but is no longer available
  }

  const port = entry.port

  // ── Build upstream URL ──────────────────────────────────────────────────
  const url = new URL(c.req.url)
  const prefix = `/s/${token}`
  const remainingPath = url.pathname.slice(prefix.length) || '/'
  // Strip __proxy_token from the query string — it's for the CF Worker, not the upstream service
  const upstreamParams = new URLSearchParams(url.searchParams)
  upstreamParams.delete('__proxy_token')
  const search = upstreamParams.toString() ? `?${upstreamParams.toString()}` : ''
  const targetUrl = `http://localhost:${port}${remainingPath}${search}`

  // ── Build headers ───────────────────────────────────────────────────────
  const headers = buildUpstreamHeaders(c, EXTRA_STRIP)
  headers.set('Host', `localhost:${port}`)

  const acceptsSSE = detectSSE(c)

  let body: ArrayBuffer | undefined
  try {
    body = await readBodyOnce(c)
  } catch {
    return c.json({ error: 'Failed to read request body' }, 400)
  }

  const clientAbort = createClientAbort(c)

  // ── Retry loop (same pattern as proxy.ts) ───────────────────────────────
  let lastError = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (clientAbort.signal.aborted) {
      return new Response(null, { status: 499 })
    }

    try {
      const signal = getFetchSignal(acceptsSSE, clientAbort)

      const response = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body,
        // @ts-ignore — Bun extension
        decompress: false,
        redirect: 'manual',
        signal,
      })

      const responseHeaders = new Headers(response.headers)

      // Rewrite Location header for redirects
      const location = responseHeaders.get('location')
      if (location) {
        try {
          const locUrl = new URL(location, `http://localhost:${port}`)
          if (locUrl.hostname === 'localhost' && parseInt(locUrl.port || '80') === port) {
            responseHeaders.set('location', `${prefix}${locUrl.pathname}${locUrl.search}`)
          }
        } catch { /* leave as-is */ }
      }

      // Add CORS headers for public shares
      responseHeaders.set('Access-Control-Allow-Origin', '*')
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS')
      responseHeaders.set('Access-Control-Allow-Headers', '*')

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      lastError = errMsg

      if (clientAbort.signal.aborted) {
        return new Response(null, { status: 499 })
      }

      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        return c.json({ error: 'Service timed out', port }, 504)
      }

      if (isConnectionRefused(errMsg)) {
        return c.json({
          error: 'Service not running',
          port,
          hint: `Nothing is listening on port ${port}. Start your service first.`,
        }, 502)
      }

      if (isTransientError(errMsg) && attempt < MAX_RETRIES) {
        await Bun.sleep(RETRY_DELAY_MS * (attempt + 1))
        continue
      }
    }
  }

  return c.json({ error: 'Failed to connect to service', port, details: lastError }, 502)
})

// Bare token without trailing path → redirect to add slash
shareProxyRouter.all('/:token', (c) => {
  const token = c.req.param('token')
  const url = new URL(c.req.url)
  return c.redirect(`/s/${token}/${url.search}`, 301)
})

export default shareProxyRouter
