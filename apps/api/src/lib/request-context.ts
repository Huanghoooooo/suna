/**
 * Request-scoped context using AsyncLocalStorage.
 *
 * Provides automatic context propagation for structured logging.
 * Any code running within a request lifecycle can call getRequestContext()
 * to get the current userId, accountId, sandboxId, requestId, etc.
 *
 * The logger and console.error patch automatically attach these fields
 * to every log — no manual passing needed.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Unique ID for this request (for tracing across logs) */
  requestId: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Supabase user ID (set after auth middleware) */
  userId?: string;
  /** Kortix account ID (set after auth middleware) */
  accountId?: string;
  /** User email (set after auth middleware) */
  userEmail?: string;
  /** Sandbox ID (set by route handlers that operate on a sandbox) */
  sandboxId?: string;
  /** Extra fields that route handlers can attach */
  [key: string]: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

let counter = 0;

/**
 * Generate a short request ID: timestamp prefix + counter.
 * Not globally unique (use trace IDs for that), but unique enough
 * to correlate logs within a single API instance.
 */
function generateRequestId(): string {
  const ts = Date.now().toString(36);
  const seq = (counter++).toString(36);
  return `${ts}-${seq}`;
}

/**
 * Run a function within a request context.
 * Called by the Hono middleware at the start of every request.
 */
export function runWithContext<T>(method: string, path: string, fn: () => T): T {
  const ctx: RequestContext = {
    requestId: generateRequestId(),
    method,
    path,
  };
  return storage.run(ctx, fn);
}

/**
 * Get the current request context (or undefined if not in a request).
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Set a field on the current request context.
 * Call this from auth middleware, route handlers, etc.
 *
 *   setContextField('userId', user.id);
 *   setContextField('sandboxId', sandbox.id);
 */
export function setContextField(key: string, value: string): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx[key] = value;
  }
}

/**
 * Get loggable fields from the current context.
 * Returns only defined fields (no undefined values cluttering logs).
 */
export function getContextFields(): Record<string, string> {
  const ctx = storage.getStore();
  if (!ctx) return {};

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (value !== undefined) {
      fields[key] = value;
    }
  }
  return fields;
}
