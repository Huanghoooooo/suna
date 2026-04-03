import { config } from '../../config';

export interface JustAvpsReadinessProbeInput {
  slug?: string;
  proxyToken?: string;
  serviceKey?: string;
  /** The sandbox's external_id — used for the backend proxy fallback route (/p/{externalId}/8000) */
  externalId?: string;
}

export interface SandboxReadinessResult {
  ready: boolean;
  message: string;
  httpStatus?: number;
}

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Probe sandbox readiness via multiple paths:
 *   1. Cloudflare proxy: https://{slug}.{proxyDomain}/kortix/health
 *   2. Backend proxy fallback: http://localhost:{port}/v1/p/{externalId}/8000/kortix/health
 *
 * If EITHER path returns 200, the sandbox is ready.
 * This prevents sandboxes from staying stuck when the CF proxy has
 * auth issues but the backend proxy works fine.
 */
export async function probeJustAvpsSandboxReadiness(
  input: JustAvpsReadinessProbeInput,
): Promise<SandboxReadinessResult> {
  if (!input.slug && !input.externalId) {
    return { ready: false, message: 'Sandbox slug and externalId both missing' };
  }

  // ── Try Cloudflare proxy first ──
  if (input.slug) {
    const cfResult = await probeCfProxy(input);
    if (cfResult.ready) return cfResult;
    // If CF returned 503, services are starting — skip backend fallback (same result)
    if (cfResult.httpStatus === 503) return cfResult;
  }

  // ── Fallback: try through backend's own proxy ──
  if (input.externalId) {
    const backendResult = await probeBackendProxy(input.externalId, input.serviceKey);
    if (backendResult.ready) return backendResult;
    // Return the more informative message between the two probes
    if (input.slug) {
      // CF probe ran but failed — return its message (more specific)
      const cfResult = await probeCfProxy(input);
      return cfResult;
    }
    return backendResult;
  }

  // Only CF was tried and failed
  return probeCfProxy(input);
}

async function probeCfProxy(input: JustAvpsReadinessProbeInput): Promise<SandboxReadinessResult> {
  if (!input.slug) {
    return { ready: false, message: 'Sandbox slug missing' };
  }

  const headers: Record<string, string> = {};
  if (input.proxyToken) headers['X-Proxy-Token'] = input.proxyToken;
  if (input.serviceKey || config.INTERNAL_SERVICE_KEY) {
    headers.Authorization = `Bearer ${input.serviceKey || config.INTERNAL_SERVICE_KEY}`;
  }

  try {
    const res = await fetch(`https://8000--${input.slug}.${config.JUSTAVPS_PROXY_DOMAIN}/kortix/health`, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (res.status === 200) {
      return { ready: true, message: 'Sandbox services are ready', httpStatus: 200 };
    }

    if (res.status === 503) {
      return { ready: false, message: 'Sandbox container is up but still starting', httpStatus: 503 };
    }

    return { ready: false, message: `Sandbox health probe returned ${res.status}`, httpStatus: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ready: false, message: `Sandbox health probe failed: ${message}` };
  }
}

async function probeBackendProxy(externalId: string, serviceKey?: string): Promise<SandboxReadinessResult> {
  const backendBase = `http://localhost:${config.PORT}`;
  const url = `${backendBase}/v1/p/${externalId}/8000/kortix/health`;

  const headers: Record<string, string> = {};
  if (serviceKey || config.INTERNAL_SERVICE_KEY) {
    headers.Authorization = `Bearer ${serviceKey || config.INTERNAL_SERVICE_KEY}`;
  }

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (res.status === 200) {
      return { ready: true, message: 'Sandbox services are ready (via backend proxy)', httpStatus: 200 };
    }

    if (res.status === 503) {
      return { ready: false, message: 'Sandbox container is up but still starting', httpStatus: 503 };
    }

    return { ready: false, message: `Backend proxy health probe returned ${res.status}`, httpStatus: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ready: false, message: `Backend proxy health probe failed: ${message}` };
  }
}
