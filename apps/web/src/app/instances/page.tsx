'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import {
  listSandboxes,
  ensureSandbox,
  type SandboxInfo,
} from '@/lib/platform-client';
import { isBillingEnabled } from '@/lib/config';
import { useServerStore, type ServerEntry } from '@/stores/server-store';
import { useAccountState } from '@/hooks/billing/use-account-state';
import { claimComputer } from '@/lib/api/billing';

import { NewInstanceModal } from '@/components/billing/pricing/new-instance-modal';
import { UserSettingsModal } from '@/components/settings/user-settings-modal';
import { Button } from '@/components/ui/button';
import {
  Server,
  Cloud,
  Container,
  Box,
  Plus,
  Loader2,
  LogOut,
  AlertCircle,
  ExternalLink,
  Monitor,
  Settings,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { clearUserLocalStorage } from '@/lib/utils/clear-local-storage';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// ─── Status helpers ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dotColor: string }> = {
  active: { label: 'Active', color: 'text-emerald-500', dotColor: 'bg-emerald-500' },
  provisioning: { label: 'Provisioning', color: 'text-amber-500', dotColor: 'bg-amber-400' },
  stopped: { label: 'Stopped', color: 'text-muted-foreground', dotColor: 'bg-muted-foreground/40' },
  error: { label: 'Error', color: 'text-red-400', dotColor: 'bg-red-400' },
  available: { label: 'Available', color: 'text-blue-500', dotColor: 'bg-blue-500' },
  archived: { label: 'Archived', color: 'text-muted-foreground/50', dotColor: 'bg-muted-foreground/20' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, color: 'text-muted-foreground', dotColor: 'bg-muted-foreground/30' };
}

const PROVIDER_CONFIG: Record<string, { label: string; icon: typeof Server; badgeCls: string }> = {
  justavps: { label: 'VPS', icon: Server, badgeCls: 'text-orange-500/70 bg-orange-500/10' },
  daytona: { label: 'Cloud', icon: Cloud, badgeCls: 'text-violet-500/70 bg-violet-500/10' },
  local_docker: { label: 'Local', icon: Container, badgeCls: 'text-blue-500/70 bg-blue-500/10' },
  custom: { label: 'Custom', icon: Box, badgeCls: 'text-muted-foreground/70 bg-muted/50' },
};

function getProviderConfig(provider: string) {
  return PROVIDER_CONFIG[provider] ?? { label: provider, icon: Box, badgeCls: 'text-muted-foreground/70 bg-muted/50' };
}

// ─── Instance Card ──────────────────────────────────────────────────────────

function InstanceCard({ sandbox, onClick, onBackups }: { sandbox: SandboxInfo; onClick: () => void; onBackups?: () => void }) {
  const status = getStatusConfig(sandbox.status);
  const provider = getProviderConfig(sandbox.provider);
  const ProviderIcon = provider.icon;
  const meta = sandbox.metadata as Record<string, unknown> | undefined;
  const location = (meta?.location as string) || null;
  const serverType = (meta?.serverType as string) || null;
  const showBackups = sandbox.provider === 'justavps' && ['active', 'stopped'].includes(sandbox.status);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border/50 bg-card hover:bg-muted/30 hover:border-border transition-colors p-4 cursor-pointer group"
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted/50 flex-shrink-0 mt-0.5">
          <ProviderIcon className="h-5 w-5 text-muted-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {sandbox.name || sandbox.sandbox_id}
            </span>
            <span className={cn('px-1.5 py-px text-[0.5625rem] font-medium rounded-full uppercase tracking-wider leading-none', provider.badgeCls)}>
              {provider.label}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1.5">
            {/* Status */}
            <span className={cn('flex items-center gap-1.5 text-xs font-medium', status.color)}>
              <span className={cn('h-[7px] w-[7px] rounded-full flex-shrink-0', status.dotColor,
                sandbox.status === 'provisioning' && 'animate-pulse',
              )} />
              {status.label}
            </span>

            {/* Location */}
            {location && (
              <span className="text-[11px] text-muted-foreground/50">{location}</span>
            )}

            {/* Server type */}
            {serverType && (
              <span className="text-[11px] text-muted-foreground/50 font-mono">{serverType}</span>
            )}

            {/* Version */}
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
              onClick={(e) => { e.stopPropagation(); onBackups(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onBackups(); } }}
              title="Backups"
              className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/30 hover:text-muted-foreground/80 hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Archive className="h-3.5 w-3.5" />
            </span>
          )}
          <ExternalLink className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
        </div>
      </div>
    </button>
  );
}

function FallbackInstanceCard({ server, isActive, onClick }: { server: ServerEntry; isActive: boolean; onClick: () => void }) {
  const provider = getProviderConfig(server.provider || 'custom');
  const status = getStatusConfig(server.instanceId ? 'active' : 'available');
  const ProviderIcon = provider.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border/50 bg-card hover:bg-muted/30 hover:border-border transition-colors p-4 cursor-pointer group"
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted/50 flex-shrink-0 mt-0.5">
          <ProviderIcon className="h-5 w-5 text-muted-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{server.label || server.instanceId || server.id}</span>
            <span className={cn('px-1.5 py-px text-[0.5625rem] font-medium rounded-full uppercase tracking-wider leading-none', provider.badgeCls)}>
              {provider.label}
            </span>
            {isActive && (
              <span className="px-1.5 py-px text-[0.5625rem] font-medium rounded-full uppercase tracking-wider leading-none text-primary bg-primary/10">
                current
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <span className={cn('flex items-center gap-1.5 text-xs font-medium', status.color)}>
              <span className={cn('h-[7px] w-[7px] rounded-full flex-shrink-0', status.dotColor)} />
              {status.label}
            </span>
            {server.instanceId && <span className="text-[11px] text-muted-foreground/50 font-mono">{server.instanceId}</span>}
          </div>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function InstancesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { servers, activeServerId } = useServerStore();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const isCloud = isBillingEnabled();
  const { data: accountState, isLoading: accountStateLoading, refetch: refetchAccountState } = useAccountState();

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth');
    }
  }, [authLoading, user, router]);

  const { data: sandboxes, isLoading, error, refetch } = useQuery({
    queryKey: ['platform', 'sandbox', 'list'],
    queryFn: listSandboxes,
    enabled: !!user,
    refetchInterval: (query) => {
      // Poll every 15s if any sandbox is provisioning (real-time updates happen on the detail page via SSE)
      const data = query.state.data;
      if (data?.some((s) => s.status === 'provisioning')) return 15_000;
      return 60_000; // 60s when all stable
    },
  });

  // After Stripe checkout redirect — just clean the URL and refetch.
  // The webhook already created the subscription + provisioned the sandbox.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('subscription') !== 'success') return;
    const clean = new URL(window.location.href);
    clean.searchParams.delete('subscription');
    clean.searchParams.delete('session_id');
    window.history.replaceState({}, '', clean.pathname);
    refetch();
  }, [user, refetch]);

  // Local mode: auto-create the single sandbox if none exists, then redirect.
  // Only 1 instance allowed in local mode.
  useEffect(() => {
    if (!user || isLoading || autoCreating || isCloud) return;
    if (sandboxes && sandboxes.length === 0) {
      setAutoCreating(true);
      ensureSandbox()
        .then(() => refetch())
        .catch(() => { })
        .finally(() => setAutoCreating(false));
    }
  }, [user, isLoading, sandboxes, autoCreating, isCloud, refetch]);

  // Auto-redirect: if there's exactly 1 instance (local mode typical), go straight to it.
  useEffect(() => {
    if (isLoading || !sandboxes) return;
    const active = sandboxes.filter((s) => s.status !== 'archived');
    if (active.length === 1 && !isCloud) {
      router.replace(`/instances/${active[0].sandbox_id}`);
    }
  }, [isLoading, sandboxes, isCloud, router]);

  // Filter out archived — user shouldn't see those
  const visible = sandboxes?.filter((s) => s.status !== 'archived') ?? [];
  const fallbackServers = servers.filter((s) => !!s.provider || !!s.url);

  function handleInstanceClick(sandbox: SandboxInfo) {
    // Always go to the instance detail page. It's the gatekeeper:
    // active → dashboard, provisioning → progress, error → error.
    router.push(`/instances/${sandbox.sandbox_id}`);
  }

  function handleFallbackServerClick(server: ServerEntry) {
    if (server.instanceId) {
      router.push(`/instances/${server.instanceId}`);
    } else {
      router.push('/dashboard');
    }
  }

  function handleCreateInstance() {
    if (isCloud) {
      setCheckoutOpen(true);
    } else {
      // Local mode: create directly, no checkout
      setAutoCreating(true);
      ensureSandbox()
        .then(() => refetch())
        .catch(() => { })
        .finally(() => setAutoCreating(false));
    }
  }

  const handleClaimComputer = async () => {
    try {
      setClaiming(true);
      const result = await claimComputer();
      refetch();
      refetchAccountState();
      if (result?.data?.sandbox_id) {
        router.push(`/instances/${result.data.sandbox_id}`);
      }
    } catch {
      // Error handled by API client
    } finally {
      setClaiming(false);
    }
  };

  const canClaimComputer = accountState?.can_claim_computer === true;
  const pageLoading = isLoading || (isCloud && accountStateLoading);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearUserLocalStorage();
    router.push('/auth');
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0">
        <KortixLogo size={20} />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="gap-2 text-muted-foreground/50 hover:text-foreground"
          >
            {user?.user_metadata?.avatar_url ? (
              <Avatar className="h-5 w-5">
                <AvatarImage src={user.user_metadata.avatar_url} alt={user.user_metadata?.name || ''} />
                <AvatarFallback className="text-[10px] bg-muted">
                  {(user.user_metadata?.name || user.email || 'U').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : (
              <Settings className="h-3.5 w-3.5" />
            )}
            Settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-2 text-muted-foreground/50 hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Log Out
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center px-4 pt-12 pb-20">
        <div className="w-full max-w-lg">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-semibold text-foreground">Instances</h1>
            {(isCloud || visible.length === 0) && (
              <Button
                size="sm"
                onClick={handleCreateInstance}
                disabled={autoCreating}
                className="gap-1.5"
              >
                {autoCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {autoCreating ? 'Creating...' : 'New Kortix'}
              </Button>
            )}
          </div>

          {/* Loading */}
          {pageLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error */}
          {error && !pageLoading && fallbackServers.length === 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-destructive font-medium">Failed to load instances</p>
                <p className="text-xs text-destructive/70 mt-0.5">{(error as Error).message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {/* Claim computer card for legacy paid users */}
          {canClaimComputer && !pageLoading && (
            <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-background to-muted/20 px-8 py-14 pb-6 flex flex-col items-center text-center gap-6">
              <img
                src="/kortix-computer.png"
                alt="Kortix Computer"
                className="h-40 w-40 object-contain"
              />

              <div className="space-y-3 max-w-md">
                <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                  Kortix is now even better
                </h3>
                <p className="text-base text-muted-foreground leading-relaxed">
                  Your plan now includes a dedicated cloud computer
                  {accountState?.tier?.monthly_credits ? (<> with <span className="text-foreground font-medium">${accountState.tier.monthly_credits}/mo</span> in credits</>) : ''}.
                  Always on, runs while you sleep, full root access.
                </p>
              </div>

              <Button
                size="lg"
                onClick={handleClaimComputer}
                disabled={claiming}
                className="gap-2 px-8 h-11 text-sm font-medium"
              >
                {claiming ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  'Claim Computer'
                )}
              </Button>

              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/60 mt-8">
                <span>Included in your plan</span>
                <span className="h-3 w-px bg-border/50" />
                <span>Always on</span>
                <span className="h-3 w-px bg-border/50" />
                <span>Persistent storage</span>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!pageLoading && !error && visible.length === 0 && fallbackServers.length === 0 && !canClaimComputer && (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-8 flex flex-col items-center gap-4">
              <div className="flex items-center justify-center h-14 w-14 rounded-xl bg-muted/50">
                <Server className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground/80">No instances yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Create your first Kortix instance to get started.
                </p>
              </div>
              <Button onClick={handleCreateInstance} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                New Kortix
              </Button>
            </div>
          )}

          {/* Instance list */}
          {!pageLoading && visible.length > 0 && (
            <div className="flex flex-col gap-2">
              {visible.map((sandbox) => (
                <InstanceCard
                  key={sandbox.sandbox_id}
                  sandbox={sandbox}
                  onClick={() => handleInstanceClick(sandbox)}
                  onBackups={() => router.push(`/instances/${sandbox.sandbox_id}/backups`)}
                />
              ))}
            </div>
          )}

          {/* Fallback list from server store when sandbox API list is unavailable */}
          {!pageLoading && visible.length === 0 && fallbackServers.length > 0 && (
            <div className="flex flex-col gap-2">
              {fallbackServers.map((server) => (
                <FallbackInstanceCard
                  key={server.id}
                  server={server}
                  isActive={server.id === activeServerId}
                  onClick={() => handleFallbackServerClick(server)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Checkout modal — opens instantly, no page navigation */}
      <NewInstanceModal open={checkoutOpen} onOpenChange={setCheckoutOpen} />

      {/* User settings modal */}
      <UserSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
