"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save } from 'lucide-react';
import { SlackIcon } from '@/components/ui/icons/slack';
import { TelegramIcon } from '@/components/ui/icons/telegram';
import { toast } from 'sonner';
import { getActiveOpenCodeUrl } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';
import { AgentSelector, flattenModels } from '@/components/session/session-chat-input';
import { ModelSelector } from '@/components/session/model-selector';
import { useOpenCodeAgents, useOpenCodeProviders } from '@/hooks/opencode/use-opencode-sessions';

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
  created_by: string | null;
  created_at: string;
}

interface ChannelSettingsDialogProps {
  channel: Channel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

export function ChannelSettingsDialog({ channel, open, onOpenChange, onUpdated }: ChannelSettingsDialogProps) {
  const [name, setName] = useState('');
  const [agentName, setAgentName] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<{ providerID: string; modelID: string } | null>(null);
  const [instructions, setInstructions] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: agents = [], isLoading: agentsLoading } = useOpenCodeAgents();
  const { data: providers, isLoading: modelsLoading } = useOpenCodeProviders();
  const models = useMemo(() => flattenModels(providers), [providers]);

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setAgentName(channel.default_agent || 'kortix');
      setInstructions(channel.instructions || '');
      setEnabled(channel.enabled);

      // Parse "provider/model" string into the selector format
      if (channel.default_model && channel.default_model.includes('/')) {
        const [providerID, ...rest] = channel.default_model.split('/');
        setSelectedModel({ providerID, modelID: rest.join('/') });
      } else if (channel.default_model) {
        setSelectedModel({ providerID: 'kortix', modelID: channel.default_model });
      } else {
        setSelectedModel(null);
      }
    }
  }, [channel]);

  const handleSave = async () => {
    if (!channel) return;
    setSaving(true);
    try {
      const url = getActiveOpenCodeUrl();
      if (!url) throw new Error('No sandbox');

      // Build model string from selector
      const modelStr = selectedModel
        ? `${selectedModel.providerID}/${selectedModel.modelID}`
        : '';

      const res = await authenticatedFetch(`${url}/kortix/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          default_agent: agentName || undefined,
          default_model: modelStr || undefined,
          instructions: instructions.trim(),
          enabled,
        }),
      });
      const data = await res.json() as any;
      if (data.ok) {
        toast.success('Settings saved');
        onUpdated();
        onOpenChange(false);
      } else {
        toast.error(data.error || 'Failed to save');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!channel) return null;

  const Icon = channel.platform === 'telegram' ? TelegramIcon : SlackIcon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-muted border border-border/50">
              <Icon className="h-4.5 w-4.5 text-foreground" />
            </div>
            <div>
              <DialogTitle>{channel.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">@{channel.bot_username || '?'} · {channel.platform}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Enabled */}
          <div className="flex items-center justify-between rounded-xl border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">Receive and respond to messages</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Channel Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Bot" />
          </div>

          {/* Agent */}
          <div className="space-y-1.5">
            <Label className="text-xs">Agent</Label>
            {agentsLoading ? (
              <div className="flex items-center gap-2 h-9 px-3 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading agents...
              </div>
            ) : (
              <div className="rounded-xl border bg-card px-2 py-1">
                <AgentSelector
                  agents={agents}
                  selectedAgent={agentName}
                  onSelect={(next) => setAgentName(next)}
                />
              </div>
            )}
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            {modelsLoading ? (
              <div className="flex items-center gap-2 h-9 px-3 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading models...
              </div>
            ) : (
              <div className="rounded-xl border bg-card px-2 py-1">
                <ModelSelector
                  models={models}
                  selectedModel={selectedModel}
                  onSelect={(next) => setSelectedModel(next)}
                />
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="space-y-1.5">
            <Label className="text-xs">System Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Optional custom instructions for this channel's agent..."
              rows={3}
              className="text-sm resize-none"
            />
            <p className="text-[11px] text-muted-foreground">
              Prepended to every session started from this channel.
            </p>
          </div>

          {/* Webhook path (read-only) */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Webhook Path</Label>
            <Input value={channel.webhook_path} readOnly className="font-mono text-xs text-muted-foreground" />
          </div>

          {/* Save */}
          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
