"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Radio,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Ripple } from '@/components/ui/ripple';
import { PageHeader } from '@/components/ui/page-header';
import { SlackIcon } from '@/components/ui/icons/slack';
import { TelegramIcon } from '@/components/ui/icons/telegram';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useServerStore, getActiveOpenCodeUrl } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';
import { ChannelConfigDialog } from './channel-config-dialog';
import { ChannelSettingsDialog } from './channel-settings-dialog';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Channel {
  id: string;
  platform: 'telegram' | 'slack';
  name: string;
  enabled: boolean;
  bot_username: string | null;
  default_agent: string;
  default_model: string;
  instructions?: string;
  webhook_path: string;
  webhook_url?: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── API ────────────────────────────────────────────────────────────────────

async function channelFetch(path: string, opts?: RequestInit): Promise<any> {
  const url = getActiveOpenCodeUrl();
  if (!url) return null;
  try {
    const res = await authenticatedFetch(`${url}/kortix/channels${path}`, opts);
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Components ─────────────────────────────────────────────────────────────

function ChannelCard({
  channel,
  index,
  onToggle,
  onRemove,
  onSettings,
}: {
  channel: Channel;
  index: number;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onSettings: (channel: Channel) => void;
}) {
  const Icon = channel.platform === 'telegram' ? TelegramIcon : SlackIcon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.6) }}
    >
      <SpotlightCard className="bg-card border border-border/50">
        <div className="p-4 sm:p-5 flex flex-col h-full cursor-pointer group" onClick={() => onSettings(channel)}>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-muted border border-border/50 shrink-0">
              <Icon className="h-4.5 w-4.5 text-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground truncate">{channel.name}</h3>
                <Badge variant={channel.enabled ? "highlight" : "secondary"} className="text-xs shrink-0">
                  {channel.enabled ? "Active" : "Disabled"}
                </Badge>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-1">
            {channel.platform === 'telegram' ? 'Telegram' : 'Slack'} · @{channel.bot_username || '?'}
          </p>
          <div className="text-[11px] text-muted-foreground/60 mb-3 space-y-0.5">
            <p>{channel.default_agent} · {channel.default_model ? channel.default_model.split('/').pop() : 'default model'}</p>
            {channel.instructions && <p className="truncate italic">"{channel.instructions.slice(0, 60)}{channel.instructions.length > 60 ? '…' : ''}"</p>}
          </div>
          <div className="mt-auto flex items-center gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="px-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onSettings(channel)}>
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="px-2" onClick={() => onToggle(channel.id, !channel.enabled)}>
              {channel.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" className="px-2 text-destructive hover:text-destructive" onClick={() => onRemove(channel.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </SpotlightCard>
    </motion.div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configDialogPlatform, setConfigDialogPlatform] = useState<'telegram' | 'slack' | undefined>(undefined);
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Subscribe to server URL changes so we re-fetch when it becomes available
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());

  const load = useCallback(async () => {
    const data = await channelFetch('');
    if (data?.ok) {
      setChannels(data.channels);
    } else {
      setChannels([]);
    }
    setLoading(false);
    setLoaded(true);
  }, []);

  // Load when serverUrl becomes available
  useEffect(() => {
    if (serverUrl) load();
  }, [serverUrl, load]);

  // Also try loading after a short delay if serverUrl is slow
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loaded) load();
    }, 2000);
    return () => clearTimeout(timer);
  }, [loaded, load]);

  const handleToggle = async (id: string, enabled: boolean) => {
    // Optimistic update
    setChannels(prev => prev.map(ch => ch.id === id ? { ...ch, enabled } : ch));
    const data = await channelFetch(`/${id}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' });
    if (data?.ok) {
      toast.success(enabled ? 'Enabled' : 'Disabled');
    } else {
      // Revert on failure
      setChannels(prev => prev.map(ch => ch.id === id ? { ...ch, enabled: !enabled } : ch));
      toast.error('Failed');
    }
  };

  const handleRemove = async (id: string) => {
    const ch = channels.find(c => c.id === id);
    if (!confirm(`Remove ${ch?.name}?`)) return;
    // Optimistic remove
    setChannels(prev => prev.filter(c => c.id !== id));
    const data = await channelFetch(`/${id}`, { method: 'DELETE' });
    if (data?.ok) {
      toast.success('Removed');
    } else {
      // Revert
      load();
      toast.error('Failed');
    }
  };

  const openSetupDialog = (platform?: 'telegram' | 'slack') => {
    setConfigDialogPlatform(platform);
    setConfigDialogOpen(true);
  };

  const handleChannelCreated = () => {
    load();
  };

  return (
    <div className="min-h-[100dvh]">
      <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both">
        <PageHeader icon={Radio}>
          <div className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
            <span className="text-primary">Channels</span>
          </div>
        </PageHeader>
      </div>

      <div className="container mx-auto max-w-7xl px-3 sm:px-4 pb-8">
        {loading && !loaded ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-2xl border bg-card p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-9 w-9 rounded-[10px]" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-3 w-32 mb-2" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="relative bg-muted/20 rounded-3xl border border-dashed border-border/50 flex flex-col items-center justify-center py-16 px-4 overflow-hidden">
            <Ripple mainCircleSize={160} mainCircleOpacity={0.12} numCircles={6} />
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-16 h-16 bg-muted border rounded-2xl flex items-center justify-center mb-4">
                <Radio className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Connect a channel</h3>
              <p className="text-sm text-muted-foreground text-center leading-relaxed max-w-md mb-8">
                Connect Telegram or Slack so people can interact with your agent via chat.
              </p>
              <div className="flex gap-4">
                <button onClick={() => openSetupDialog('telegram')} className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-border/50 bg-card hover:bg-muted/50 transition-colors cursor-pointer group">
                  <div className="w-12 h-12 rounded-xl bg-muted border border-border/50 flex items-center justify-center group-hover:border-primary/30 transition-colors">
                    <TelegramIcon className="h-6 w-6 text-foreground" />
                  </div>
                  <p className="text-sm font-medium">Telegram</p>
                </button>
                <button onClick={() => openSetupDialog('slack')} className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-border/50 bg-card hover:bg-muted/50 transition-colors cursor-pointer group">
                  <div className="w-12 h-12 rounded-xl bg-muted border border-border/50 flex items-center justify-center group-hover:border-primary/30 transition-colors">
                    <SlackIcon className="h-6 w-6 text-foreground" />
                  </div>
                  <p className="text-sm font-medium">Slack</p>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Channels</span>
                <Badge variant="secondary" className="text-xs tabular-nums">{channels.length}</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="px-2" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openSetupDialog('telegram')}>
                  <TelegramIcon className="h-3.5 w-3.5" /><span className="hidden sm:inline">Telegram</span>
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openSetupDialog('slack')}>
                  <SlackIcon className="h-3.5 w-3.5" /><span className="hidden sm:inline">Slack</span>
                </Button>
              </div>
            </div>
            <AnimatePresence mode="popLayout">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {channels.map((ch, i) => (
                  <ChannelCard key={ch.id} channel={ch} index={i} onToggle={handleToggle} onRemove={handleRemove} onSettings={(ch) => { setSettingsChannel(ch); setSettingsOpen(true); }} />
                ))}
              </div>
            </AnimatePresence>
          </>
        )}
      </div>

      <ChannelConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onCreated={handleChannelCreated}
        initialPlatform={configDialogPlatform}
      />

      <ChannelSettingsDialog
        channel={settingsChannel}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onUpdated={load}
      />
    </div>
  );
}
