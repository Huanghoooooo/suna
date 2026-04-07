'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Loader2, GitCommit, Tag } from 'lucide-react';
import { getAllVersions, type VersionEntry, type VersionChannel } from '@/lib/platform-client';
import { useGlobalSandboxUpdate, detectChannel } from '@/hooks/platform/use-global-sandbox-update';
import { useSandboxConnectionStore } from '@/stores/sandbox-connection-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { FilterBar, FilterBarItem } from '@/components/ui/tabs';
import { useUpdateDialogStore } from '@/stores/update-dialog-store';
import { UnifiedMarkdown } from '@/components/markdown/unified-markdown';

// ─── Version type classification ──────────────────────────────────────────

type VersionType = 'major' | 'minor' | 'patch' | 'dev';

function parseVersionType(version: string): VersionType {
  if (version.startsWith('dev-')) return 'dev';
  const parts = version.split('.');
  if (parts.length < 3) return 'patch';
  if (parts[2] === '0' && parts[1] === '0') return 'major';
  if (parts[2] === '0') return 'minor';
  return 'patch';
}

function normalizeReleaseTitle(title: string | undefined, version: string): string | undefined {
  if (!title) return title;
  if (version.startsWith('dev-')) return title;
  const escaped = version.replace(/\./g, '\\.');
  const patterns = [
    new RegExp(`^v${escaped}\\s*[—–:-]\\s*`, 'i'),
    new RegExp(`^${escaped}\\s*[—–:-]\\s*`, 'i'),
    new RegExp(`^v${escaped}\\s+`, 'i'),
    new RegExp(`^${escaped}\\s+`, 'i'),
  ];
  let normalized = title;
  for (const pattern of patterns) {
    normalized = normalized.replace(pattern, '');
  }
  return normalized.trim() || title;
}

// ─── Channel badge ────────────────────────────────────────────────────────

function ChannelBadge({ channel }: { channel: VersionChannel }) {
  if (channel === 'dev') {
    return <Badge variant="warning" size="sm">dev</Badge>;
  }
  return <Badge variant="success" size="sm">stable</Badge>;
}

// ─── Version entry card ───────────────────────────────────────────────────

function VersionEntryCard({ entry, isCurrent, isLatestInChannel, onInstall, isInstalling, showInstall }: {
  entry: VersionEntry;
  isCurrent: boolean;
  isLatestInChannel: boolean;
  onInstall?: (version: string) => void;
  isInstalling?: boolean;
  showInstall?: boolean;
}) {
  const isDevVersion = entry.version.startsWith('dev-');
  const versionType = parseVersionType(entry.version);
  const [expanded, setExpanded] = useState(false);

  // Visual treatment varies by version type
  const isMajor = versionType === 'major';
  const isMinor = versionType === 'minor';
  const isDev = versionType === 'dev';

  const displayVersion = isDevVersion ? entry.version : `v${entry.version}`;
  const displayTitle = normalizeReleaseTitle(entry.title, entry.version);
  const canExpandBody = Boolean(entry.body && entry.body.length > (isDev ? 220 : 420));
  const collapsedHeightClass = isDev ? 'max-h-32' : isMajor ? 'max-h-72' : 'max-h-56';

  return (
    <Card className={cn(
      'transition-colors overflow-hidden',
      // Major: prominent accent border
      isMajor && 'border-l-4 border-l-primary border-primary/30 bg-primary/[0.02]',
      // Current version: green highlight
      isCurrent && !isMajor && 'border-emerald-500/30 bg-emerald-500/[0.02]',
      // Latest in channel
      isLatestInChannel && !isCurrent && !isMajor && 'border-primary/20 bg-primary/[0.02]',
      // Minor: subtle highlight
      isMinor && !isCurrent && !isLatestInChannel && 'border-border/60',
      // Dev: minimal styling
      isDev && !isCurrent && !isLatestInChannel && 'border-border/40 bg-muted/20',
      // Patch: default
      versionType === 'patch' && !isCurrent && !isLatestInChannel && 'border-border/50',
      // Compact padding for dev/patch
      isDev ? 'py-3' : isMajor ? 'py-6' : 'py-4',
    )}>
      <CardHeader className={cn(
        'flex flex-row items-start justify-between gap-4',
        // Reduce gap for card's default gap-6
        isMajor ? 'pb-0' : 'pb-0',
      )}>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <div className="flex items-center gap-1.5">
            {isDevVersion ? (
              <GitCommit className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
            ) : (
              <Tag className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
            )}
            <span className={cn(
              'font-mono font-semibold text-foreground',
              isMajor ? 'text-xl' : isDev ? 'text-sm' : 'text-lg',
            )}>
              {displayVersion}
            </span>
          </div>

          <ChannelBadge channel={entry.channel} />

          {isMajor && (
            <Badge variant="highlight" size="sm">Major Release</Badge>
          )}

          {isCurrent && (
            <Badge variant="success" size="sm">Current</Badge>
          )}

          {isLatestInChannel && !isCurrent && (
            <Badge variant="new" size="sm">Latest</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground/60 font-mono">{entry.date}</span>
          {!isCurrent && showInstall && onInstall && (
            <Tooltip>
              <TooltipTrigger asChild>
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
              </TooltipTrigger>
              <TooltipContent>
                Install {displayVersion}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardHeader>

      <CardContent className={cn(
        isMajor ? 'pt-0' : 'pt-0',
        // Reduce spacing between header and content
        !entry.title && !entry.body ? 'pb-0' : '',
      )}>
        {displayTitle && (
          <h3 className={cn(
            'font-medium text-foreground',
            isMajor ? 'text-base mb-2' : 'text-sm mb-1',
          )}>
            {displayTitle}
          </h3>
        )}

        {/* Render body as markdown for proper formatting */}
        {entry.body && (
          <div className="mt-2">
            <div className="relative">
              <div className={cn(
                'prose prose-sm dark:prose-invert max-w-none',
                'text-muted-foreground',
                '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground/90 [&_h1]:mt-3 [&_h1]:mb-1.5',
                '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground/90 [&_h2]:mt-3 [&_h2]:mb-1',
                '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground/80 [&_h3]:mt-2 [&_h3]:mb-1',
                '[&_p]:text-xs [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:my-1',
                '[&_ul]:text-xs [&_ul]:my-1 [&_ul]:pl-4',
                '[&_ol]:text-xs [&_ol]:my-1 [&_ol]:pl-4',
                '[&_li]:text-xs [&_li]:text-muted-foreground [&_li]:my-0.5',
                '[&_code]:text-xs [&_code]:px-1 [&_code]:py-0.5 [&_code]:bg-muted [&_code]:rounded',
                '[&_pre]:text-xs [&_pre]:my-2',
                '[&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline',
                '[&_strong]:text-foreground/90 [&_strong]:font-semibold',
                '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-xs',
                !expanded && canExpandBody && `${collapsedHeightClass} overflow-hidden`,
              )}>
                <UnifiedMarkdown content={entry.body} />
              </div>

              {!expanded && canExpandBody && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card via-card/90 to-transparent" />
              )}
            </div>

            {canExpandBody && (
              <div className="mt-2 flex justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded((prev) => !prev)}
                >
                  {expanded ? 'Show less' : 'Show full release notes'}
                </Button>
              </div>
            )}
          </div>
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
      </CardContent>
    </Card>
  );
}

// ─── Filter tabs ──────────────────────────────────────────────────────────

type FilterOption = 'all' | 'stable' | 'dev';

function FilterTabs({ value, onChange, showDev }: { value: FilterOption; onChange: (v: FilterOption) => void; showDev: boolean }) {
  const options: { key: FilterOption; label: string }[] = showDev
    ? [
        { key: 'all', label: 'All' },
        { key: 'stable', label: 'Stable' },
        { key: 'dev', label: 'Dev' },
      ]
    : [
        { key: 'stable', label: 'Stable' },
      ];

  if (!showDev) return null;

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

  // Dev mode: hidden by default, persisted in localStorage
  const [showDev, setShowDev] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (currentChannel === 'dev') return true;
    return localStorage.getItem('changelog-show-dev') === 'true';
  });

  const toggleDev = useCallback(() => {
    setShowDev((prev) => {
      const next = !prev;
      localStorage.setItem('changelog-show-dev', String(next));
      if (!next) setFilter('stable');
      return next;
    });
  }, []);

  const [filter, setFilter] = useState<FilterOption>('stable');

  const { data, isLoading, error } = useQuery({
    queryKey: ['sandbox', 'versions', 'all'],
    queryFn: getAllVersions,
    staleTime: 5 * 60 * 1000,
  });

  const openDialog = useUpdateDialogStore((s) => s.openDialog);

  // Install a specific version via the update dialog
  const handleInstall = useCallback((version: string) => {
    openDialog(version);
  }, [openDialog]);

  // Update to latest via the update dialog (no target version = latest)
  const handleUpdate = useCallback(() => {
    openDialog();
  }, [openDialog]);

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

  const hasDevBuilds = useMemo(() => {
    return Boolean(data?.versions?.some((v) => v.channel === 'dev'));
  }, [data?.versions]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground mb-2">Versions</h1>
              <p className="text-sm text-muted-foreground">
                {currentVersion ? (
                  <>
                    Running{' '}
                    <span className="font-mono font-medium text-foreground">
                      {currentVersion.startsWith('dev-') ? currentVersion : `v${currentVersion}`}
                    </span>
                    {currentChannel === 'dev' && (
                      <Badge variant="warning" size="sm" className="ml-1.5">dev</Badge>
                    )}
                  </>
                ) : (
                  'Version history for Kortix Computer'
                )}
                {latestVersion && currentVersion && latestVersion !== currentVersion && (
                  <>
                    {' '}&middot; Latest:{' '}
                    <span className="font-mono font-medium text-primary">
                      {latestVersion.startsWith('dev-') ? latestVersion : `v${latestVersion}`}
                    </span>
                  </>
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

            {/* Dev toggle */}
            <Button
              variant="ghost"
              size="xs"
              onClick={toggleDev}
              className="mt-1.5 text-muted-foreground/55 hover:text-foreground"
            >
              {showDev ? 'Hide dev builds' : 'Dev builds'}
            </Button>
          </div>
        </div>

        {/* Filter tabs (only visible when dev mode is on) */}
        {showDev && (
          <div className="mb-6">
            <FilterTabs value={filter} onChange={setFilter} showDev={showDev} />
          </div>
        )}

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
          <div className="space-y-3">
            {filteredVersions.map((entry, index) => {
              const isLatestInChannel =
                (entry.channel === 'stable' && entry.version === latestStable) ||
                (entry.channel === 'dev' && entry.version === latestDev);

              const versionType = parseVersionType(entry.version);
              const prevEntry = filteredVersions[index - 1];
              const prevVersionType = prevEntry ? parseVersionType(prevEntry.version) : null;

              // Add separator before major releases (unless it's the first item)
              const showSeparator = index > 0 && versionType === 'major' && prevVersionType !== 'major';

              return (
                <div key={entry.version}>
                  {showSeparator && (
                    <Separator className="my-6" />
                  )}
                  <VersionEntryCard
                    entry={entry}
                    isCurrent={currentVersion === entry.version}
                    isLatestInChannel={isLatestInChannel}
                    onInstall={handleInstall}
                    isInstalling={false}
                    showInstall={hasDevBuilds}
                  />
                </div>
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
