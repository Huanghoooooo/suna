'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Abort detection — user-initiated stops get a lowkey treatment
// ============================================================================

const ABORT_PATTERNS = [
  'operation was aborted',
  'aborted',
  'abort',
  'cancelled',
  'canceled',
];

function isAbortError(text: string): boolean {
  const lower = text.toLowerCase();
  return ABORT_PATTERNS.some((p) => lower.includes(p));
}

// ============================================================================
// TurnErrorDisplay — simple inline error card (matches SolidJS reference)
// ============================================================================

interface TurnErrorDisplayProps {
  errorText: string;
  className?: string;
}

/**
 * Renders a turn-level error inline. Error text is derived directly from
 * `AssistantMessage.error.data.message` via `getTurnError()` — no
 * classification, no severity levels, just the unwrapped error message.
 *
 * Abort errors (user-initiated stops) get a minimal, lowkey treatment —
 * just muted text, no border/background card.
 */
export function TurnErrorDisplay({ errorText, className }: TurnErrorDisplayProps) {
  if (!errorText) return null;

  // Abort/cancelled → tiny muted note, no card
  if (isAbortError(errorText)) {
    return (
      <p className={cn('text-[11px] text-muted-foreground/50 italic', className)}>
        Interrupted
      </p>
    );
  }

  // Real errors → full card
  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2 rounded-md border',
        'bg-muted/40 dark:bg-muted/30',
        'border-border/60',
        className,
      )}
    >
      <AlertCircle className="size-3.5 mt-0.5 flex-shrink-0 text-muted-foreground/70" />
      <p className="text-xs text-muted-foreground break-words min-w-0">
        {errorText}
      </p>
    </div>
  );
}

interface SessionRetryDisplayProps {
  message: string;
  attempt: number;
  secondsLeft: number;
  className?: string;
}

export function SessionRetryDisplay({
  message,
  attempt,
  secondsLeft,
  className,
}: SessionRetryDisplayProps) {
  if (!message) return null;

  const line = secondsLeft > 0 ? `Retrying in ${secondsLeft}s (#${attempt})` : `Retrying now (#${attempt})`;

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2 rounded-md border',
        'bg-muted/40 dark:bg-muted/30',
        'border-border/60',
        className,
      )}
    >
      <Loader2 className="size-3.5 mt-0.5 flex-shrink-0 animate-spin text-muted-foreground/70" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground break-words">{message}</p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">{line}</p>
      </div>
    </div>
  );
}
