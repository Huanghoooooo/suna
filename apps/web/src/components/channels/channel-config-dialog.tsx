"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Users,
  Mic,
  Mail,
  MessageSquare,
  ArrowRight,
  ArrowLeft,
  Radio,
} from 'lucide-react';
import { useCreateChannel, type ChannelType } from '@/hooks/channels';
import { SlackIcon } from '@/components/ui/icons/slack';
import { TelegramIcon } from '@/components/ui/icons/telegram';
import { DiscordIcon } from '@/components/ui/icons/discord';
import { WhatsAppIcon } from '@/components/ui/icons/whatsapp';
import { TelegramSetupWizard } from './telegram-setup-wizard';
import { SlackSetupWizard } from './slack-setup-wizard';
import { useSandbox } from '@/hooks/platform/use-sandbox';
import { useServerStore } from '@/stores/server-store';
import { ensureSandbox } from '@/lib/platform-client';
import { toast } from 'sonner';
import { DEFAULT_CHANNEL_AGENT, buildDefaultChannelInstructions } from './channel-defaults';

interface ChannelConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const CHANNEL_OPTIONS: { type: ChannelType; label: string; icon: React.ComponentType<{ className?: string }>; available: boolean }[] = [
  { type: 'telegram', label: 'Telegram', icon: TelegramIcon, available: true },
  { type: 'slack', label: 'Slack', icon: SlackIcon, available: true },
  { type: 'discord', label: 'Discord', icon: DiscordIcon, available: false },
  { type: 'whatsapp', label: 'WhatsApp', icon: WhatsAppIcon, available: false },
  { type: 'teams', label: 'Teams', icon: Users, available: false },
  { type: 'voice', label: 'Voice', icon: Mic, available: false },
  { type: 'email', label: 'Email', icon: Mail, available: false },
  { type: 'sms', label: 'SMS', icon: MessageSquare, available: false },
];

export function ChannelConfigDialog({ open, onOpenChange, onCreated }: ChannelConfigDialogProps) {
  const [step, setStep] = useState<'type' | 'slack-wizard' | 'telegram-wizard' | 'config'>('type');
  const [channelType, setChannelType] = useState<ChannelType | null>(null);
  const [name, setName] = useState('');

  const { sandbox } = useSandbox();
  const activeServer = useServerStore((s) => s.servers.find((srv) => srv.id === s.activeServerId));
  const createMutation = useCreateChannel();

  const resolveSandboxId = async (): Promise<string | null> => {
    // 1. Active server's instanceId (set when navigating to /instances/{id})
    if (activeServer?.instanceId) return activeServer.instanceId;
    // 2. Sandbox from context hook
    if (sandbox?.sandbox_id) return sandbox.sandbox_id;
    // 3. Any server with a sandboxId
    const store = useServerStore.getState();
    for (const s of store.servers) {
      if (s.instanceId) return s.instanceId;
    }
    // 4. Last resort: ensureSandbox
    try {
      const result = await ensureSandbox();
      return result.sandbox.sandbox_id;
    } catch {
      return null;
    }
  };

  const handleClose = () => {
    setStep('type');
    setChannelType(null);
    setName('');
    onOpenChange(false);
  };

  const handleSelectType = (type: ChannelType) => {
    if (type === 'telegram') {
      setChannelType('telegram');
      setStep('telegram-wizard');
      return;
    }
    if (type === 'slack') {
      setChannelType('slack');
      setStep('slack-wizard');
      return;
    }
    setChannelType(type);
    setName(`My ${CHANNEL_OPTIONS.find((o) => o.type === type)?.label} Bot`);
    setStep('config');
  };

  const handleCreate = async () => {
    if (!channelType) return;
    const sandboxId = await resolveSandboxId();
    if (!sandboxId) {
      toast.error('Could not find your sandbox — is the backend running?');
      return;
    }

    try {
      await createMutation.mutateAsync({
        sandbox_id: sandboxId,
        channel_type: channelType,
        name,
        agent_name: DEFAULT_CHANNEL_AGENT,
        instructions: buildDefaultChannelInstructions(channelType, name),
        metadata: {},
      });
      toast.success('Channel created successfully');
      handleClose();
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create channel');
    }
  };

  const isValid = (): boolean => {
    return !!name.trim() && !!sandbox;
  };

  if (!open) return null;

  // ─── Slack Wizard ───────────────────────────────────────────────────────────

  if (step === 'slack-wizard') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
          <div className="px-6 pt-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-muted border border-border/50">
                  <SlackIcon className="h-4.5 w-4.5" />
                </div>
                Connect Slack
              </DialogTitle>
              <DialogDescription className="mt-1.5">
                Connect a Slack bot to your instance
              </DialogDescription>
            </DialogHeader>
          </div>
          <SlackSetupWizard
            sandboxId={activeServer?.instanceId || sandbox?.sandbox_id}
            onBack={() => { setStep('type'); setChannelType(null); }}
            onCreated={() => {
              handleClose();
              onCreated?.();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Telegram Wizard ────────────────────────────────────────────────────────

  if (step === 'telegram-wizard') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
          <div className="px-6 pt-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-muted border border-border/50">
                  <TelegramIcon className="h-4.5 w-4.5" />
                </div>
                Connect Telegram
              </DialogTitle>
              <DialogDescription className="mt-1.5">
                Connect a Telegram bot to your instance
              </DialogDescription>
            </DialogHeader>
          </div>
          <TelegramSetupWizard
            sandboxId={activeServer?.instanceId || sandbox?.sandbox_id}
            onBack={() => { setStep('type'); setChannelType(null); }}
            onCreated={() => {
              handleClose();
              onCreated?.();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Type Picker ────────────────────────────────────────────────────────────

  if (step === 'type') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
          <div className="px-6 pt-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-muted border border-border/50">
                  <Radio className="h-4.5 w-4.5" />
                </div>
                Add Channel
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                {CHANNEL_OPTIONS.filter(o => o.available).map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    onClick={() => handleSelectType(type)}
                    className="group flex items-center gap-3 rounded-xl p-4 text-left transition-all border border-border bg-card hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 cursor-pointer"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                      <Icon className="h-5 w-5 text-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{label}</div>
                      <div className="text-xs text-primary/70">Ready to connect</div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-primary/70 transition-all" />
                  </button>
                ))}
              </div>
            </div>
            {CHANNEL_OPTIONS.some(o => !o.available) && (
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coming Soon</span>
                <div className="grid grid-cols-3 gap-2">
                  {CHANNEL_OPTIONS.filter(o => !o.available).map(({ type, label, icon: Icon }) => (
                    <div
                      key={type}
                      className="flex flex-col items-center gap-2 rounded-xl p-3 border border-dashed border-border/60 opacity-60"
                    >
                      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted/60">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Generic Config (fallback for non-wizard channels) ──────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
        <div className="bg-muted/30 border-b px-6 pt-6 pb-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              {channelType && (() => {
                const Icon = CHANNEL_OPTIONS.find((o) => o.type === channelType)?.icon || Radio;
                return (
                  <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-muted border border-border/50">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                );
              })()}
              Configure {CHANNEL_OPTIONS.find((o) => o.type === channelType)?.label}
            </DialogTitle>
            <DialogDescription className="mt-1.5">
              Enter a name for this channel
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Bot"
              className="rounded-xl focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
        <div className="flex justify-between gap-2 px-6 pb-6">
          <Button variant="outline" onClick={() => setStep('type')} className="rounded-xl">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!isValid() || createMutation.isPending}
            className="rounded-xl"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Channel'}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
