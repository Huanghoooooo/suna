'use client';

import { cn } from '@/lib/utils';
import React from 'react';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10',
        'skeleton-animate',
        className,
      )}
      {...props}
    >
      <div className="skeleton-shimmer-wrapper">
        <div className="skeleton-shimmer-bar" />
      </div>
    </div>
  );
}

export { Skeleton };
