'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { RotateCcw, Home, Copy, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { cn } from '@/lib/utils';
import * as Sentry from '@sentry/nextjs';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error('[Wutong Dashboard Error]', error);
    Sentry.captureException(error);
  }, [error]);

  const handleCopy = async () => {
    const details = [
      `Error: ${error.message}`,
      error.digest ? `Digest: ${error.digest}` : null,
      `Timestamp: ${new Date().toISOString()}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : 'unknown'}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing
    }
  };

  // Sanitize error message for display
  const displayMessage =
    error.message && error.message.length < 200
      ? error.message
      : 'An unexpected error occurred in the dashboard.';

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-4">
      {/* Noise/static overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '256px 256px',
        }}
      />

      {/* Scanline effect */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.015] dark:opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, currentColor 2px, currentColor 3px)',
          backgroundSize: '100% 3px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative z-10 flex w-full max-w-md flex-col items-center gap-8"
      >
        {/* Logo */}
        <KortixLogo size={28} />

        {/* Glitched error indicator */}
        <div className="relative select-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="font-mono text-[80px] font-bold leading-none tracking-tighter text-foreground/[0.06]"
          >
            ERR
          </motion.div>
          {/* Glitch slice */}
          <motion.div
            className="absolute left-1 top-0 font-mono text-[80px] font-bold leading-none tracking-tighter text-destructive-foreground/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0, 0.4, 0] }}
            transition={{
              duration: 3,
              repeat: Infinity,
              repeatDelay: 5,
              times: [0, 0.02, 0.04, 0.06, 0.08],
            }}
            style={{ clipPath: 'inset(30% 0 40% 0)' }}
          >
            ERR
          </motion.div>
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
            Something went wrong
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {displayMessage}
          </p>
        </div>

        {/* System status indicator */}
        <motion.div
          className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <motion.div
            className="h-1.5 w-1.5 rounded-full bg-amber-500"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="font-mono text-xs text-muted-foreground">
            system recovering
          </span>
          {error.digest && (
            <>
              <span className="text-border">|</span>
              <span className="font-mono text-xs text-muted-foreground/60">
                {error.digest}
              </span>
            </>
          )}
        </motion.div>

        {/* Error detail card */}
        <motion.div
          className="w-full rounded-xl border border-border bg-card/50 p-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Process Interrupted</p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {displayMessage}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-3">
          <Button size="lg" className="w-full" onClick={reset}>
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" asChild>
              <Link href="/">
                <Home className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <Button
              variant="outline"
              className={cn('flex-1', copied && 'text-emerald-600 dark:text-emerald-400')}
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? 'Copied' : 'Copy Details'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
