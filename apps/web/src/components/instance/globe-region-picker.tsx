'use client';

import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';
import type { COBEOptions } from 'cobe';

const Globe = lazy(() => import('@/components/ui/globe').then((m) => ({ default: m.Globe })));

import { INSTANCE_CONFIG, type RegionId } from './config';

export const LOCATIONS = INSTANCE_CONFIG.regions;
export type LocationId = RegionId;

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function GlobeRegionPicker({
  location,
  onLocationChange,
  showToggle,
  className,
}: {
  location: string;
  onLocationChange: (id: string) => void;
  showToggle?: boolean;
  className?: string;
}) {
  const showRegionToggle = showToggle ?? INSTANCE_CONFIG.regionPickerEnabled;
  const isDark = useIsDark();
  const selectedLoc = LOCATIONS.find((l) => l.id === location) ?? LOCATIONS[0];

  const globeConfig = useMemo<COBEOptions>(() => ({
    width: 800,
    height: 800,
    onRender: () => {},
    devicePixelRatio: 2,
    phi: selectedLoc.phi,
    theta: selectedLoc.theta,
    dark: isDark ? 1 : 0,
    diffuse: isDark ? 0.4 : 1.2,
    mapSamples: 16000,
    mapBrightness: isDark ? 6 : 1.2,
    baseColor: isDark ? [0.3, 0.3, 0.3] : [0.95, 0.95, 0.95],
    markerColor: [0.3, 0.5, 1],
    glowColor: isDark ? [0.1, 0.1, 0.2] : [0.9, 0.9, 1],
    markers: LOCATIONS.map((loc) => ({
      location: [loc.lat, loc.lng] as [number, number],
      size: loc.id === location ? 0.08 : 0.03,
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isDark]);

  return (
    <div className={cn('rounded-2xl w-full h-full flex flex-col bg-muted/80 dark:bg-black/60 relative overflow-hidden', className)}>
      {/* Region label */}
      <div className="relative z-10 px-5 pt-5">
        <p className="text-[11px] font-semibold text-muted-foreground/60 dark:text-white/30 uppercase tracking-widest">
          Region
        </p>
        <p className="text-sm font-medium text-foreground dark:text-white/80 mt-0.5">
          {selectedLoc.label} <span className="font-normal">{selectedLoc.icon}</span>
        </p>
      </div>

      {/* Region toggle */}
      {showRegionToggle && (
        <div className="relative z-10 px-5 mt-4">
          <div className="flex items-center gap-0.5 p-1 rounded-full bg-background/80 dark:bg-white/10 backdrop-blur-xl border border-border/50 dark:border-white/10 shadow-sm w-fit">
            {LOCATIONS.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => onLocationChange(loc.id)}
                className={cn(
                  'px-5 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer',
                  location === loc.id
                    ? 'bg-foreground text-background dark:bg-white dark:text-black shadow-sm'
                    : 'text-muted-foreground hover:text-foreground dark:text-white/40 dark:hover:text-white/70',
                )}
              >
                {loc.shorthand}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Globe — oversized, bottom half clipped by parent overflow-hidden */}
      <div className="relative h-[340px] mt-auto">
        <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[560px] h-[560px]">
          <Suspense fallback={null}>
            <Globe
              config={globeConfig}
              autoRotate={false}
              targetPhi={selectedLoc.phi}
              targetTheta={selectedLoc.theta}
              className="!static !w-full !h-full !max-w-none"
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export function RegionToggle({
  location,
  onLocationChange,
  className,
}: {
  location: string;
  onLocationChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-0.5 p-1 rounded-full bg-muted/40 border border-border/30 w-fit', className)}>
      {LOCATIONS.map((loc) => (
        <button
          key={loc.id}
          type="button"
          onClick={() => onLocationChange(loc.id)}
          className={cn(
            'px-5 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer',
            location === loc.id
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {loc.shorthand}
        </button>
      ))}
    </div>
  );
}
