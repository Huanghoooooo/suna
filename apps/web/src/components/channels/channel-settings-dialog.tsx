"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save } from 'lucide-react';
import { SlackIcon } from '@/components/ui/icons/slack';
import { TelegramIcon } from '@/components/ui/icons/telegram';
import { toast } from 'sonner';
import { getActiveOpenCodeUrl } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';

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

const COMMON_MODELS = [
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-opus-4-6',
  'openai/gpt-4o',
  'openai/o3-mini',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'minimax',
];

export function ChannelSettingsDialog({ channel, open, onOpenChange, onUpdated }: ChannelSettingsDialogProps) {
  const [name, setName] = useState('');
  const [agent, setAgent] = useState('');
  const [model, setModel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setAgent(channel.default_agent || 'kortix');
      setModel(channel.default_model || '');
      setInstructions(channel.instructions || '');
      setEnabled(channel.enabled);
    }
  }, [channel]);

  const handleSave = async () => {
    if (!channel) return;
    setSaving(true);
    try {
      const url = getActiveOpenCodeUrl();
      if (!url) throw new Error('No sandbox');
      const res = await authenticatedFetch(`${url}/kortix/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          default_agent: agent.trim() || undefined,
          default_model: model.trim() || undefined,
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
            <Label className="text-xs">Default Agent</Label>
            <Input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="kortix" />
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <Label className="text-xs">Default Model</Label>
            <div className="flex gap-2">
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="anthropic/claude-sonnet-4-20250514"
                className="flex-1"
              />
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {COMMON_MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  className={`px-2 py-0.5 rounded-md text-[11px] border transition-colors cursor-pointer ${
                    model === m
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-muted/50 border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  {m.split('/').pop()}
                </button>
              ))}
            </div>
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
              These are prepended to every agent session started from this channel.
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
