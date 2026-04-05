'use client';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { ServerType } from '@/lib/api/billing';

const SIZE_LABELS: Record<number, string> = {
  2: 'Small',
  3: 'Small',
  4: 'Medium',
  8: 'Large',
  12: 'XL',
  16: '2XL',
  32: '4XL',
};

function getSizeLabel(cores: number): string {
  return SIZE_LABELS[cores] || `${cores}x`;
}

function formatMemory(gb: number): string {
  return gb >= 1 ? `${gb} GB` : `${Math.round(gb * 1024)} MB`;
}

function formatDisk(gb: number): string {
  return gb >= 1000 ? `${(gb / 1000).toFixed(0)} TB` : `${gb} GB`;
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

export { formatMemory, formatDisk, formatPrice, getSizeLabel };

export function SizePicker({
  types,
  selected,
  onSelect,
  defaultOnly,
  className,
}: {
  types: ServerType[];
  selected: string | null;
  onSelect: (name: string) => void;
  defaultOnly?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-1.5', className)}>
      {types.map((t, i) => {
        const isSelected = selected === t.name;
        const label = getSizeLabel(t.cores);
        const isDefault = i === 0;
        const isDisabled = defaultOnly && !isDefault;

        return (
          <button
            key={t.name}
            type="button"
            onClick={() => !isDisabled && onSelect(t.name)}
            disabled={isDisabled}
            className={cn(
              'flex items-center gap-3.5 w-full px-3 py-2.5 rounded-xl border text-left transition-colors',
              isDisabled
                ? 'opacity-40 cursor-not-allowed'
                : 'cursor-pointer',
              isSelected && !isDisabled
                ? 'border-foreground/20 bg-foreground/[0.04] shadow-sm'
                : !isDisabled && 'border-border/40 hover:bg-muted/40 hover:border-border/60',
              isDisabled && 'border-border/20',
            )}
          >
            <div className={cn(
              'shrink-0 w-11 h-11 rounded-lg border flex flex-col items-center justify-center',
              isSelected && !isDisabled ? 'bg-foreground text-background' : 'bg-muted/60 text-foreground/70',
            )}>
              <span className="text-[15px] font-semibold tabular-nums leading-none">{t.cores}</span>
              <span className="text-[8px] font-medium opacity-60 mt-0.5">vCPU</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-foreground">{label}</span>
                {isDefault && defaultOnly && (
                  <span className="text-[0.5625rem] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">Included</span>
                )}
                {isDisabled && (
                  <span className="text-[0.5625rem] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground/50">Coming soon</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground/60">
                <span>{formatMemory(t.memory)} RAM</span>
                <span className="text-muted-foreground/20">{'\u00B7'}</span>
                <span>{formatDisk(t.disk)} SSD</span>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <span className="text-sm font-semibold text-foreground tabular-nums tracking-tight">
                {isDefault && defaultOnly ? 'Included' : formatPrice(t.priceMonthlyMarkup)}
              </span>
              {!(isDefault && defaultOnly) && (
                <span className="text-[11px] text-muted-foreground/40">/mo</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function SizePickerSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-1.5', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 px-3 py-2.5 rounded-xl border border-border/40">
          <Skeleton className="w-11 h-11 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
