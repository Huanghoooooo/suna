'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Loader2, Sparkles, Bug, Zap, AlertTriangle, Shield, RefreshCw, Check, Package, Container, Github, Cloud, GitCommit, Tag } from 'lucide-react';
import { getAllVersions, triggerSandboxUpdate, type VersionEntry, type VersionChannel, type ChangelogChange, type ChangelogArtifact, type SandboxInfo } from '@/lib/platform-client';
import { useGlobalSandboxUpdate, detectChannel } from '@/hooks/platform/use-global-sandbox-update';
import { useSandboxConnectionStore } from '@/stores/sandbox-connection-store';
import { useServerStore } from '@/stores/server-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterBarItem } from '@/components/ui/tabs';
import { useUpdateDialogStore } from '@/stores/update-dialog-store';
import { toast } from 'sonner';

// ─── Change type icons + colors ───────────────────────────────────────────

const changeTypeConfig: Record<string, { icon: typeof Sparkles; color: string; label: string }> = {
  feature:      { icon: Sparkles,       color: 'text-emerald-500', label: 'Feature' },
  fix:          { icon: Bug,            color: 'text-red-400',     label: 'Fix' },
  improvement:  { icon: Zap,            color: 'text-blue-400',    label: 'Improvement' },
  breaking:     { icon: AlertTriangle,  color: 'text-amber-500',   label: 'Breaking' },
  upstream:     { icon: RefreshCw,      color: 'text-violet-400',  label: 'Upstream' },
  security:     { icon: Shield,         color: 'text-rose-400',    label: 'Security' },
  deprecation:  { icon: AlertTriangle,  color: 'text-orange-400',  label: 'Deprecated' },
};

function ChangeItem({ change }: { change: ChangelogChange }) {
  const config = changeTypeConfig[change.type] ?? changeTypeConfig.improvement;
  const Icon = config.icon;
  return (
    <div className="flex items-start gap-2.5 py-1">
      <Icon className={cn('h-3.5 w-3.5 mt-0.5 flex-shrink-0', config.color)} />
      <span className="text-sm text-foreground/80">{change.text}</span>
    </div>
  );
}

// ─── Channel badge ────────────────────────────────────────────────────────

function ChannelBadge({ channel }: { channel: VersionChannel }) {
  if (channel === 'dev') {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
        dev
      </span>
    );
  }
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
      stable
    </span>
  );
}

// ─── Version badge ────────────────────────────────────────────────────────

function VersionBadge({ version, channel, isCurrent, isLatest }: {
  version: string;
  channel: VersionChannel;
  isCurrent: boolean;
  isLatest: boolean;
}) {
  const isDevVersion = version.startsWith('dev-');
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        {isDevVersion ? (
          <GitCommit className="h-3.5 w-3.5 text-muted-foreground/60" />
        ) : (
          <Tag className="h-3.5 w-3.5 text-muted-foreground/60" />
        )}
        <span className="font-mono text-lg font-semibold text-foreground">
          {isDevVersion ? version : `v${version}`}
        </span>
      </div>
      <ChannelBadge channel={channel} />
      {isCurrent && (
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          Current
        </span>
      )}
      {isLatest && !isCurrent && (
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
          Latest
        </span>
      )}
    </div>
  );
}

// ─── Artifacts list ───────────────────────────────────────────────────────

const artifactTargetConfig: Record<string, { icon: typeof Package; label: string }> = {
  npm:              { icon: Package,   label: 'npm' },
  'docker-hub':     { icon: Container, label: 'Docker Hub' },
  'github-release': { icon: Github,    label: 'GitHub' },
  daytona:          { icon: Cloud,     label: 'Daytona' },
};

function ArtifactsList({ artifacts }: { artifacts: ChangelogArtifact[] }) {
  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-1.5">Published</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {artifacts.map((art) => {
          const config = artifactTargetConfig[art.target] ?? artifactTargetConfig.npm;
          const Icon = config.icon;
          return (
            <div key={`${art.name}-${art.target}`} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
              <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />
              <Icon className="h-3 w-3 flex-shrink-0" />
              <span className="font-mono text-[11px]">{art.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Version entry card ───────────────────────────────────────────────────

function VersionEntryCard({ entry, isCurrent, isLatestInChannel, onInstall, isInstalling }: {
  entry: VersionEntry;
  isCurrent: boolean;
  isLatestInChannel: boolean;
  onInstall?: (version: string) => void;
  isInstalling?: boolean;
}) {
  const isDevVersion = entry.version.startsWith('dev-');

  return (
    <div className={cn(
      'rounded-xl border p-5 transition-colors',
      isCurrent ? 'border-emerald-500/20 bg-emerald-500/[0.02]' :
      isLatestInChannel ? 'border-primary/20 bg-primary/[0.02]' : 'border-border/50',
    )}>
      <div className="flex items-start justify-between gap-4 mb-1">
        <VersionBadge
          version={entry.version}
          channel={entry.channel}
          isCurrent={isCurrent}
          isLatest={isLatestInChannel}
        />
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground/60 font-mono">{entry.date}</span>
          {!isCurrent && onInstall && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled={isInstalling}
              onClick={() => onInstall(entry.version)}
            >
              {isInstalling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3 w-3" />
              )}
              Install
            </Button>
          )}
        </div>
      </div>

      <h3 className="text-sm font-medium text-foreground mb-1">{entry.title}</h3>

      {entry.body && (
        <p className="text-xs text-muted-foreground mb-3 whitespace-pre-line line-clamp-6">
          {entry.body}
        </p>
      )}

      {/* Dev entries show the SHA as a link */}
      {isDevVersion && entry.sha && (
        <div className="mt-2">
          <a
            href={`https://github.com/kortix-ai/suna/commit/${entry.sha}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-primary transition-colors"
          >
            <GitCommit className="h-3 w-3" />
            <span className="font-mono">{entry.sha.substring(0, 8)}</span>
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Filter tabs ──────────────────────────────────────────────────────────

type FilterOption = 'all' | 'stable' | 'dev';

function FilterTabs({ value, onChange }: { value: FilterOption; onChange: (v: FilterOption) => void }) {
  const options: { key: FilterOption; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'stable', label: 'Stable' },
    { key: 'dev', label: 'Dev' },
  ];

  return (
    <FilterBar>
      {options.map((opt) => (
        <FilterBarItem
          key={opt.key}
          data-state={value === opt.key ? 'active' : 'inactive'}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </FilterBarItem>
      ))}
    </FilterBar>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function ChangelogPage() {
  const currentVersion = useSandboxConnectionStore((s) => s.sandboxVersion);
  const currentChannel = detectChannel(currentVersion);
  const { updateAvailable, latestVersion, isUpdating } = useGlobalSandboxUpdate();

  // Default filter: show dev builds if the running instance is a dev build, otherwise show all
  const [filter, setFilter] = useState<FilterOption>(currentChannel === 'dev' ? 'all' : 'all');
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);

  // Get the active sandbox for triggering updates
  const activeServer = useServerStore((s) => {
    const id = s.activeServerId;
    return id ? s.servers.find((sv) => sv.id === id) : undefined;
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['sandbox', 'versions', 'all'],
    queryFn: getAllVersions,
    staleTime: 5 * 60 * 1000,
  });

  const openDialog = useUpdateDialogStore((s) => s.openDialog);
  const handleUpdate = () => openDialog();

  // Install a specific version
  const handleInstall = useCallback(async (version: string) => {
    if (!activeServer?.sandboxId) {
      toast.error('No active sandbox found');
      return;
    }
    setInstallingVersion(version);
    try {
      // For local_docker / fallback sandboxId: use the legacy route (no DB lookup).
      // For cloud sandboxes: use the per-sandbox route.
      const isLocal = activeServer.provider === 'local_docker' || activeServer.sandboxId === 'kortix-sandbox';
      const sandboxIdForUpdate = isLocal ? undefined : activeServer.sandboxId;
      await triggerSandboxUpdate(
        { sandbox_id: sandboxIdForUpdate } as SandboxInfo,
        version,
      );
      toast.success(`Installing ${version.startsWith('dev-') ? version : `v${version}`}...`, {
        description: 'Your sandbox will restart with the new version.',
      });
    } catch (err: any) {
      toast.error(`Failed to install ${version}`, {
        description: err?.message || 'Unknown error',
      });
    } finally {
      setInstallingVersion(null);
    }
  }, [activeServer?.sandboxId, activeServer?.provider]);

  // Filter versions based on selected tab
  const filteredVersions = useMemo(() => {
    if (!data?.versions) return [];
    if (filter === 'all') return data.versions;
    return data.versions.filter((v) => v.channel === filter);
  }, [data?.versions, filter]);

  // Track which is the latest in each channel for badge display
  const latestStable = useMemo(() => {
    return data?.versions?.find((v) => v.channel === 'stable')?.version ?? null;
  }, [data?.versions]);

  const latestDev = useMemo(() => {
    return data?.versions?.find((v) => v.channel === 'dev')?.version ?? null;
  }, [data?.versions]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Changelog</h1>
          <p className="text-sm text-muted-foreground">
            {currentVersion ? (
              <>
                Running{' '}
                <span className="font-mono font-medium text-foreground">
                  {currentVersion.startsWith('dev-') ? currentVersion : `v${currentVersion}`}
                </span>
                {currentChannel === 'dev' && (
                  <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    dev
                  </span>
                )}
              </>
            ) : (
              'Version history for Kortix Computer'
            )}
            {latestVersion && currentVersion && latestVersion !== currentVersion && (
              <> &middot; Latest: <span className="font-mono font-medium text-primary">
                {latestVersion.startsWith('dev-') ? latestVersion : `v${latestVersion}`}
              </span></>
            )}
          </p>

          {/* Update button */}
          {updateAvailable && !isUpdating && (
            <div className="mt-4">
              <Button onClick={handleUpdate}>
                <ArrowDownToLine className="h-4 w-4" />
                Update to {latestVersion?.startsWith('dev-') ? latestVersion : `v${latestVersion}`}
              </Button>
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="mb-6">
          <FilterTabs value={filter} onChange={setFilter} />
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-muted-foreground text-center py-20">
            Could not load version history. The platform API may be unavailable.
          </div>
        )}

        {/* Version entries */}
        {filteredVersions.length > 0 && (
          <div className="space-y-4">
            {filteredVersions.map((entry) => {
              const isLatestInChannel =
                (entry.channel === 'stable' && entry.version === latestStable) ||
                (entry.channel === 'dev' && entry.version === latestDev);

              return (
                <VersionEntryCard
                  key={entry.version}
                  entry={entry}
                  isCurrent={currentVersion === entry.version}
                  isLatestInChannel={isLatestInChannel}
                  onInstall={handleInstall}
                  isInstalling={installingVersion === entry.version}
                />
              );
            })}
          </div>
        )}

        {data && filteredVersions.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-20">
            No {filter === 'all' ? '' : filter} versions found.
          </div>
        )}
      </div>
    </div>
  );
}
