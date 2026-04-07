/**
 * Structured logger for Kortix API.
 *
 * Uses @logtail/node to ship structured logs to Better Stack Telemetry.
 * Falls back to console.log in development or when BETTERSTACK_API_LOG_TOKEN is not set.
 *
 * IMPORTANT: This module also patches console.error and console.warn globally
 * so that ALL existing console.error/warn calls across the codebase automatically
 * ship to Better Stack — no per-file refactor needed.
 *
 * Usage:
 *   import { logger } from './lib/logger';
 *   logger.info('User logged in', { userId: '123', method: 'oauth' });
 *   logger.error('Payment failed', { orderId: '456', error: err });
 */

import { Logtail } from '@logtail/node';

// ─── Configuration ──────────────────────────────────────────────────────────

const LOG_TOKEN = process.env.BETTERSTACK_API_LOG_TOKEN;
const LOG_HOST = process.env.BETTERSTACK_API_LOG_HOST;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Better Stack Client ────────────────────────────────────────────────────

let logtail: Logtail | null = null;

if (LOG_TOKEN) {
  logtail = new Logtail(LOG_TOKEN, {
    ...(LOG_HOST ? { endpoint: `https://${LOG_HOST}` } : {}),
  });
}

// ─── Enrichment ─────────────────────────────────────────────────────────────

const BASE_CONTEXT = {
  service: 'kortix-api',
  env: process.env.INTERNAL_KORTIX_ENV || 'dev',
  version: process.env.SANDBOX_VERSION || 'dev',
};

// ─── Ship to Better Stack ───────────────────────────────────────────────────

function shipToBetterStack(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!logtail) return;
  const enriched = { ...BASE_CONTEXT, ...context };
  switch (level) {
    case 'debug': logtail.debug(message, enriched); break;
    case 'info':  logtail.info(message, enriched);  break;
    case 'warn':  logtail.warn(message, enriched);  break;
    case 'error': logtail.error(message, enriched); break;
  }
}

// ─── Logger Implementation ──────────────────────────────────────────────────

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[LOG_LEVEL];
}

function formatForConsole(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${ctx}`;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  // Write to stdout/stderr (Docker captures these)
  const formatted = formatForConsole(level, message, context);
  if (level === 'error') {
    originalConsoleError(formatted);
  } else if (level === 'warn') {
    originalConsoleWarn(formatted);
  } else {
    console.log(formatted);
  }

  // Ship to Better Stack
  shipToBetterStack(level, message, context);
}

// ─── Global console.error/warn patch ────────────────────────────────────────
//
// Intercepts ALL console.error() and console.warn() calls across the entire
// codebase and ships them to Better Stack as structured logs. This captures
// the 290+ existing console.error/warn calls in catch blocks, provider code,
// startup logic, etc. — without touching any of those files.
//
// The original console methods are preserved for stdout/stderr output.

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);

if (logtail) {
  console.error = (...args: unknown[]) => {
    // Write to stderr as normal
    originalConsoleError(...args);
    // Ship to Better Stack
    const message = args.map(a =>
      a instanceof Error ? `${a.message}\n${a.stack}` :
      typeof a === 'string' ? a :
      JSON.stringify(a)
    ).join(' ');
    shipToBetterStack('error', message);
  };

  console.warn = (...args: unknown[]) => {
    // Write to stderr as normal
    originalConsoleWarn(...args);
    // Ship to Better Stack
    const message = args.map(a =>
      typeof a === 'string' ? a : JSON.stringify(a)
    ).join(' ');
    shipToBetterStack('warn', message);
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),

  /**
   * Flush all pending logs to Better Stack.
   * Call this before process exit to ensure no logs are lost.
   */
  flush: async (): Promise<void> => {
    if (logtail) {
      await logtail.flush();
    }
  },
};
