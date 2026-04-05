'use client';

import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress';
import { featureFlags } from '@/lib/feature-flags';
import { DinoGame } from '@/components/games/dino-game';
import { STAGE_LABELS, type ProvisioningStageInfo } from '@/lib/provisioning-stages';

// Re-export the type so existing consumers don't break
export type { ProvisioningStageInfo } from '@/lib/provisioning-stages';

export interface ProvisioningProgressProps {
  progress: number;
  stages: ProvisioningStageInfo[] | null;
  currentStage: string | null;
  machineInfo: { ip: string; serverType: string; location: string } | null;
}

export function ProvisioningProgress({
  progress,
  stages,
  currentStage,
  machineInfo,
}: ProvisioningProgressProps) {
  const stageCount = stages?.length || 0;
  const currentStageIdx = stages?.findIndex((s) => s.id === currentStage) ?? -1;
  const completedCount = Math.max(0, currentStageIdx);

  const stageDisplayText = useMemo(() => {
    if (!currentStage) return 'Preparing your workspace';
    return STAGE_LABELS[currentStage] || 'Preparing your workspace';
  }, [currentStage]);

  return (
    <div className="w-full flex flex-col items-center">
      {/* Circular progress */}
      <div className="relative animate-setting-up-fade-in">
        <AnimatedCircularProgressBar
          value={progress}
          gaugePrimaryColor="var(--color-primary)"
          gaugeSecondaryColor="var(--color-primary)"
          className="size-36 [&>span]:hidden [&_circle:first-of-type]:opacity-15"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-light text-foreground/90 tabular-nums transition-colors duration-300">
            {`${Math.round(progress)}%`}
          </span>
        </div>
      </div>

      {/* Stage list (scrolling) or fallback label */}
      {stages && stages.length > 0 ? (
        <div className="mt-8 w-full max-w-[300px] relative h-[108px] overflow-hidden [clip-path:inset(0)]">
          <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-background via-background/80 to-transparent z-20 pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-background via-background/80 to-transparent z-20 pointer-events-none" />

          <div
            className="absolute left-0 right-0 flex flex-col transition-transform duration-700 ease-out"
            style={{ transform: `translateY(${36 - completedCount * 36}px)` }}
          >
            {stages.map((ps, i) => {
              const isDone = i < completedCount;
              const isActive = i === completedCount;

              return (
                <div key={ps.id} className="flex items-center justify-center gap-3 h-9 shrink-0 w-full">
                  <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    {isDone ? (
                      <CheckCircle2 className="size-3.5 text-primary/50" />
                    ) : isActive ? (
                      <Loader2 className="size-3.5 text-primary animate-spin" />
                    ) : (
                      <div className="h-1 w-1 rounded-full bg-foreground/15" />
                    )}
                  </div>
                  <span
                    className={cn('text-[13px] transition-colors duration-500', 
                      isActive ? 'text-foreground/90 font-medium' : isDone ? 'text-foreground/25' : 'text-foreground/15'
                    )}
                  >
                    {ps.message}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 relative min-h-[24px] flex items-center justify-center">
            <h2
              key={stageDisplayText}
              className="setting-up-text-enter text-base font-normal text-foreground/70 text-center"
            >
              {stageDisplayText}
            </h2>
          </div>
          <p className="mt-1 text-xs text-foreground/20">This can take a couple of minutes — we&apos;ll notify you when it&apos;s ready</p>
        </>
      )}

      {/* Divider */}
      <div className="mt-6 w-12 h-px bg-foreground/[0.06]" />

      {/* Dot progress indicators */}
      {stageCount > 0 && (
        <div className="mt-6 flex items-center gap-[6px]">
          {stages!.map((ps, i) => {
            const isDone = i < completedCount;
            const isActive = i === completedCount;

            return (
              <div
                key={ps.id}
                className={cn('rounded-full transition-colors duration-700 ease-out', 
                  isDone
                    ? 'h-[5px] w-[5px] bg-primary/50 setting-up-dot-complete'
                    : isActive
                      ? 'h-[7px] w-[7px] bg-primary/80'
                      : 'h-[5px] w-[5px] bg-foreground/[0.06]'
                )}
                style={isDone ? { animationDelay: `${i * 60}ms` } : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Machine info badge */}
      {machineInfo?.ip && (
        <div
          className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-foreground/[0.03] border border-foreground/[0.06] animate-setting-up-fade-in-slow"
        >
          <div className="h-1.5 w-1.5 rounded-full bg-primary/50" />
          <span className="text-[11px] text-foreground/30 font-mono tracking-wide">
            {machineInfo.location?.toLowerCase().includes('us') || machineInfo.location?.toLowerCase().includes('hil')
              ? 'US'
              : 'EU'}{' '}
            · {machineInfo.ip}
          </span>
        </div>
      )}

      {/* Dino game easter egg */}
      {featureFlags.enableDinoGame && (
        <div
          className="mt-8 w-full max-w-[600px] animate-setting-up-fade-in-dino"
        >
          <DinoGame />
        </div>
      )}
    </div>
  );
}
