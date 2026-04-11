'use client';

/**
 * Instance list row components + status config.
 * Shared by /instances, /debug/instances, and anywhere else we need to
 * render a sandbox row in the same visual language.
 *
 * No provider distinction — from a user's perspective a "VPS", a
 * "cloud machine" and a "local docker container" are all just
 * computers. We render them uniformly.
 */

import { Archive, ChevronRight, Server } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SandboxInfo } from '@/lib/platform-client';
import type { ServerEntry } from '@/stores/server-store';

// ─── Status config ─────────────────────────────────────────────────────────

export interface StatusConfig {
  label: string;
  color: string;
  dotColor: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  active: { label: 'Active', color: 'text-emerald-500', dotColor: 'bg-emerald-500' },
  provisioning: { label: 'Provisioning', color: 'text-amber-500', dotColor: 'bg-amber-400' },
  stopped: { label: 'Stopped', color: 'text-muted-foreground', dotColor: 'bg-muted-foreground/40' },
  error: { label: 'Error', color: 'text-red-400', dotColor: 'bg-red-400' },
  available: { label: 'Available', color: 'text-blue-500', dotColor: 'bg-blue-500' },
  archived: { label: 'Archived', color: 'text-muted-foreground/50', dotColor: 'bg-muted-foreground/20' },
};

export function getStatusConfig(status: string): StatusConfig {
  return (
    STATUS_CONFIG[status] ?? {
      label: status,
      color: 'text-muted-foreground',
      dotColor: 'bg-muted-foreground/30',
    }
  );
}

// ─── Shared row primitives ─────────────────────────────────────────────────

const ROW_CLS =
  'w-full text-left rounded-xl border border-border/50 bg-card hover:bg-muted/30 hover:border-border transition-colors p-4 cursor-pointer group';

function IconBox() {
  return (
    <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted/50 flex-shrink-0 mt-0.5">
      <Server className="h-5 w-5 text-muted-foreground/70" />
    </div>
  );
}

function StatusPill({
  status,
  animated,
}: {
  status: StatusConfig;
  animated?: boolean;
}) {
  return (
    <span className={cn('flex items-center gap-1.5 text-xs font-medium', status.color)}>
      <span
        className={cn(
          'h-[7px] w-[7px] rounded-full flex-shrink-0',
          status.dotColor,
          animated && 'animate-pulse',
        )}
      />
      {status.label}
    </span>
  );
}

function ChevronAffordance({ className }: { className?: string }) {
  return (
    <ChevronRight
      className={cn(
        'h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all',
        className,
      )}
    />
  );
}

// ─── Instance card (live sandbox) ──────────────────────────────────────────

export function InstanceCard({
  sandbox,
  onClick,
  onBackups,
}: {
  sandbox: SandboxInfo;
  onClick: () => void;
  onBackups?: () => void;
}) {
  const status = getStatusConfig(sandbox.status);
  const meta = sandbox.metadata as Record<string, unknown> | undefined;
  const location = (meta?.location as string) || null;
  const serverType = (meta?.serverType as string) || null;
  const showBackups =
    sandbox.provider === 'justavps' &&
    ['active', 'stopped'].includes(sandbox.status);

  return (
    <button type="button" onClick={onClick} className={ROW_CLS}>
      <div className="flex items-start gap-3">
        <IconBox />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate block">
            {sandbox.name || sandbox.sandbox_id}
          </span>

          <div className="flex items-center gap-3 mt-1.5">
            <StatusPill status={status} animated={sandbox.status === 'provisioning'} />
            {location && (
              <span className="text-[11px] text-muted-foreground/50">{location}</span>
            )}
            {serverType && (
              <span className="text-[11px] text-muted-foreground/50 font-mono">{serverType}</span>
            )}
            {sandbox.version && (
              <span className="text-[11px] text-muted-foreground/50 font-mono">v{sandbox.version}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 mt-1">
          {showBackups && onBackups && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onBackups();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  onBackups();
                }
              }}
              title="Backups"
              className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Archive className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronAffordance />
        </div>
      </div>
    </button>
  );
}

// ─── Fallback card (server-store entry, no live sandbox) ───────────────────

export function FallbackInstanceCard({
  server,
  isActive,
  onClick,
}: {
  server: ServerEntry;
  isActive: boolean;
  onClick: () => void;
}) {
  const status = getStatusConfig(server.instanceId ? 'active' : 'available');

  return (
    <button type="button" onClick={onClick} className={ROW_CLS}>
      <div className="flex items-start gap-3">
        <IconBox />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {server.label || server.instanceId || server.id}
            </span>
            {isActive && (
              <span className="px-1.5 py-px text-[0.5625rem] font-medium rounded-full uppercase tracking-wider leading-none text-primary bg-primary/10">
                current
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <StatusPill status={status} />
            {server.instanceId && (
              <span className="text-[11px] text-muted-foreground/50 font-mono">
                {server.instanceId}
              </span>
            )}
          </div>
        </div>
        <ChevronAffordance className="flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}
