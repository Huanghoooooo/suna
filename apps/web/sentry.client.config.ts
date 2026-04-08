/**
 * Sentry client-side configuration for Kortix Frontend.
 *
 * Uses @sentry/nextjs SDK pointed at Better Stack's Sentry-compatible endpoint.
 * Errors are tunneled through /monitoring route (auto-configured by
 * `tunnelRoute: '/monitoring'` in next.config.ts) to bypass ad-blockers.
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_KORTIX_ENV || 'dev',

    // Capture 100% of errors
    // Sample 10% of page loads for performance (keep low on client)
    tracesSampleRate: 0.1,

    // Tunnel is auto-configured by `tunnelRoute: '/monitoring'` in next.config.ts
    // No need to set `tunnel` manually here.

    // Don't send PII
    sendDefaultPii: false,

    // Ignore noisy browser errors
    ignoreErrors: [
      // Browser extensions and ad-blockers
      'ResizeObserver loop',
      'ResizeObserver loop completed with undelivered notifications',
      // Network errors (user went offline)
      'Failed to fetch',
      'NetworkError',
      'Load failed',
      'ChunkLoadError',
      // Next.js navigation errors (expected)
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      // User-initiated aborts
      'AbortError',
      'The operation was aborted',
      // PostHog retry noise
      'ERR_BLOCKED_BY_CLIENT',
      // External Safari / WebView video probing noise
      'webkitPresentationMode',
    ],

    // Filter out internal/low-value errors before sending
    beforeSend(event) {
      const message = event.exception?.values?.[0]?.value || event.message || '';
      // Don't report errors from browser extensions
      const frames = event.exception?.values?.[0]?.stacktrace?.frames || [];
      if (frames.some((f) => f.filename?.includes('extension://'))) {
        return null;
      }
      if (
        message.includes('webkitPresentationMode') ||
        frames.some((f) => f.filename?.startsWith('app:///'))
      ) {
        return null;
      }
      return event;
    },
  });
}
