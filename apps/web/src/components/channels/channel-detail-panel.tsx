"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Trash2,
  Save,
  MessageSquare,
  Users,
  Mic,
  Mail,
  Radio,
  AlertTriangle,
} from 'lucide-react';
import {
  useUpdateChannel,
  useDeleteChannel,
  type ChannelConfig,
} from '@/hooks/channels';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOpenCodeAgents, useOpenCodeProviders } from '@/hooks/opencode/use-opencode-sessions';
import { AgentSelector, flattenModels } from '@/components/session/session-chat-input';
import { ModelSelector } from '@/components/session/model-selector';
import { authenticatedFetch } from '@/lib/auth-token';
import { getActiveOpenCodeUrl } from '@/stores/server-store';
import { SlackIcon } from '@/components/ui/icons/slack';
import { TelegramIcon } from '@/components/ui/icons/telegram';
import { DiscordIcon } from '@/components/ui/icons/discord';
import { WhatsAppIcon } from '@/components/ui/icons/whatsapp';

const getChannelIcon = (channelType: string): React.ComponentType<{ className?: string }> => {
  switch (channelType) {
    case 'telegram': return TelegramIcon;
    case 'slack': return SlackIcon;
    case 'discord': return DiscordIcon;
    case 'whatsapp': return WhatsAppIcon;
    case 'teams': return Users;
    case 'voice': return Mic;
    case 'email': return Mail;
    case 'sms': return MessageSquare;
    default: return Radio;
  }
};

const getChannelLabel = (channelType: string) => {
  const labels: Record<string, string> = {
    telegram: 'Telegram', slack: 'Slack', discord: 'Discord',
    whatsapp: 'WhatsApp', teams: 'Teams', voice: 'Voice',
    email: 'Email', sms: 'SMS',
  };
  return labels[channelType] || channelType;
};

interface ChannelEditDialogProps {
  channel: ChannelConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChannelEditDialog({ channel, open, onOpenChange }: ChannelEditDialogProps) {
  const [name, setName] = useState(channel.name);
  const [agentName, setAgentName] = useState(channel.agentName || '');
  const [instructions, setInstructions] = useState(channel.instructions || '');
  const [modelKey, setModelKey] = useState(() => {
    const providerID = typeof channel.metadata?.modelProviderID === 'string' ? channel.metadata.modelProviderID : '';
    const modelID = typeof channel.metadata?.modelID === 'string' ? channel.metadata.modelID : '';
    return providerID && modelID ? `${providerID}:${modelID}` : '';
  });
  const [isDirty, setIsDirty] = useState(false);

  const updateMutation = useUpdateChannel();
  const deleteMutation = useDeleteChannel();

  const { data: agents = [] } = useOpenCodeAgents();
  const { data: providers } = useOpenCodeProviders();
  const models = React.useMemo(() => flattenModels(providers), [providers]);

  // Sync state when channel prop changes
  React.useEffect(() => {
    setName(channel.name);
    setAgentName(channel.agentName || '');
    setInstructions(channel.instructions || '');
    const providerID = typeof channel.metadata?.modelProviderID === 'string' ? channel.metadata.modelProviderID : '';
    const modelID = typeof channel.metadata?.modelID === 'string' ? channel.metadata.modelID : '';
    setModelKey(providerID && modelID ? `${providerID}:${modelID}` : '');
    setIsDirty(false);
  }, [channel.channelConfigId, channel.name, channel.agentName, channel.instructions, channel.metadata]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        id: channel.channelConfigId,
        data: {
          name,
          agent_name: agentName.trim() || null,
          instructions: instructions.trim() || null,
          metadata: {
            ...channel.metadata,
            ...(modelKey
              ? {
                  modelProviderID: modelKey.split(':')[0],
                  modelID: modelKey.split(':').slice(1).join(':'),
                }
              : {
                  modelProviderID: null,
                  modelID: null,
                }),
          },
        },
      });
      const baseUrl = getActiveOpenCodeUrl();
      if (baseUrl) {
        await authenticatedFetch(`${baseUrl}/channels/reload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch(() => {});
      }
      toast.success('Channel updated');
      setIsDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this channel? This cannot be undone.')) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(channel.channelConfigId);
      toast.success('Channel deleted');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const Icon = getChannelIcon(channel.channelType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg gap-0 p-0 overflow-visible">
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-muted border border-border/50 shrink-0">
                <Icon className="h-5 w-5" />
                {channel.enabled && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate">{channel.name}</span>
                  <Badge variant={channel.enabled ? 'highlight' : 'secondary'} className="text-xs shrink-0">
                    {channel.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
                <span className="text-xs font-normal text-muted-foreground">
                  {getChannelLabel(channel.channelType)}
                </span>
              </div>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-xs">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => { setName(e.target.value); setIsDirty(true); }}
                className="h-9 rounded-xl focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Agent</Label>
              <div className="rounded-xl border bg-card px-2 py-1">
                <AgentSelector
                  agents={agents}
                  selectedAgent={agentName || null}
                  onSelect={(next) => { setAgentName(next || ''); setIsDirty(true); }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Model</Label>
              <div className="rounded-xl border bg-card px-2 py-1">
                <ModelSelector
                  models={models}
                  selectedModel={modelKey ? {
                    providerID: modelKey.split(':')[0],
                    modelID: modelKey.split(':').slice(1).join(':'),
                  } : null}
                  onSelect={(next) => {
                    setModelKey(next ? `${next.providerID}:${next.modelID}` : '');
                    setIsDirty(true);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-instructions" className="text-xs">Instructions</Label>
              <textarea
                id="edit-instructions"
                value={instructions}
                onChange={(e) => { setInstructions(e.target.value); setIsDirty(true); }}
                rows={5}
                className="flex w-full rounded-xl border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Optional bot instructions for this channel"
              />
            </div>

            <div className="rounded-xl border p-4 space-y-2">
              <Label className="text-xs">Instance</Label>
              <div className="text-sm font-medium truncate">
                {channel.sandbox?.name || channel.sandboxId || 'No instance'}
              </div>
              <p className="text-xs text-muted-foreground">
                Channels are bound to the instance they were created for.
              </p>
            </div>

            <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-4">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-destructive">Danger Zone</h4>
                  <p className="text-xs text-destructive mt-0.5">
                    Permanently delete this channel. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-7">
                <Button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  size="sm"
                  className="text-xs gap-1.5 rounded-lg text-white bg-destructive hover:bg-destructive/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4">
          {isDirty && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="h-9 text-xs gap-1.5 rounded-xl"
            >
              <Save className="h-3.5 w-3.5" />
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
