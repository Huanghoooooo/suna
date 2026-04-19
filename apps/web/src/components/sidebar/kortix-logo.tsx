'use client';

import { cn } from '@/lib/utils';

interface KortixLogoProps {
  size?: number;
  variant?: 'symbol' | 'logomark';
  className?: string;
}

// Brand wordmark: renders "Wutong" as text (Inter/Geist Bold, tight tracking).
// The original SVG symbol/logomark has been removed per product direction.
// `size` is interpreted as the font-size in px so existing callers keep their
// visual rhythm; `variant` is accepted for API compatibility but both render
// the same wordmark.
export function KortixLogo({ size = 24, variant = 'symbol', className }: KortixLogoProps) {
  void variant;
  return (
    <span
      aria-label="Wutong"
      className={cn(
        'inline-block font-sans font-bold tracking-tight leading-none select-none',
        'text-foreground',
        className,
      )}
      style={{ fontSize: `${size}px` }}
      suppressHydrationWarning
    >
      Wutong
    </span>
  );
}
