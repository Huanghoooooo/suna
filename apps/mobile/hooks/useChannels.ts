/**
 * React Query hooks for Channels management.
 * Mirrors the frontend's channels API against the backend /channels endpoints.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '@/api/config';
import { useSandboxContext } from '@/contexts/SandboxContext';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChannelType = 'telegram' | 'slack' | 'discord' | 'whatsapp' | 'teams' | 'voice' | 'email' | 'sms';

export interface ChannelConfig {
  id: string;
  channelConfigId?: string;
  platform: ChannelType;
  channelType?: ChannelType;
  name: string;
  enabled: boolean;
  bot_username: string | null;
  default_agent: string | null;
  default_model: string | null;
  instructions: string | null;
  webhook_path: string | null;
  webhook_url: string | null;
  platformConfig?: Record<string, unknown>;
  agentName?: string | null;
  metadata?: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
  sandboxId?: string | null;
  sandbox?: { name: string; status: string };
}

export interface CreateChannelData {
  name: string;
  channel_type: ChannelType;
  platform_config?: Record<string, unknown>;
  instructions?: string;
  agent_name?: string;
  default_agent?: string;
  default_model?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateChannelData {
  name?: string;
  platform_config?: Record<string, unknown>;
  instructions?: string;
  agent_name?: string;
  default_agent?: string;
  default_model?: string;
  metadata?: Record<string, unknown>;
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function sandboxChannelFetch<T>(sandboxUrl: string, path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${sandboxUrl}/kortix/channels${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string>),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || body?.message || `Request failed (${res.status})`);
  }
  return body;
}

// ─── API Functions ───────────────────────────────────────────────────────────

async function listChannels(sandboxUrl: string): Promise<ChannelConfig[]> {
  try {
    const data = await sandboxChannelFetch<{ ok?: boolean; channels?: ChannelConfig[]; data?: ChannelConfig[] }>(
      sandboxUrl, '',
    );
    return data.channels || data.data || [];
  } catch {
    // Channels service may not be running — return empty list
    return [];
  }
}

async function getChannel(sandboxUrl: string, id: string): Promise<ChannelConfig> {
  const data = await sandboxChannelFetch<{ ok: boolean; channel: ChannelConfig }>(
    sandboxUrl, `/${id}`,
  );
  return data.channel;
}

async function updateChannel(sandboxUrl: string, id: string, body: UpdateChannelData): Promise<ChannelConfig> {
  const data = await sandboxChannelFetch<{ ok: boolean; channel: ChannelConfig }>(
    sandboxUrl, `/${id}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return data.channel;
}

async function deleteChannel(sandboxUrl: string, id: string): Promise<void> {
  await sandboxChannelFetch(sandboxUrl, `/${id}`, { method: 'DELETE' });
}

async function enableChannel(sandboxUrl: string, id: string): Promise<ChannelConfig> {
  const data = await sandboxChannelFetch<{ ok: boolean; channel: ChannelConfig }>(
    sandboxUrl, `/${id}/enable`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return data.channel;
}

async function disableChannel(sandboxUrl: string, id: string): Promise<ChannelConfig> {
  const data = await sandboxChannelFetch<{ ok: boolean; channel: ChannelConfig }>(
    sandboxUrl, `/${id}/disable`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return data.channel;
}

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const channelKeys = {
  all: ['channels'] as const,
  list: (sandboxId?: string) => [...channelKeys.all, 'list', sandboxId] as const,
  detail: (id: string) => [...channelKeys.all, 'detail', id] as const,
};

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useChannels() {
  const { sandboxUrl } = useSandboxContext();
  return useQuery({
    queryKey: channelKeys.list(sandboxUrl),
    queryFn: () => listChannels(sandboxUrl!),
    enabled: !!sandboxUrl,
    staleTime: 60 * 1000,
  });
}

export function useChannel(id: string) {
  const { sandboxUrl } = useSandboxContext();
  return useQuery({
    queryKey: channelKeys.detail(id),
    queryFn: () => getChannel(sandboxUrl!, id),
    enabled: !!sandboxUrl && !!id,
    staleTime: 60 * 1000,
  });
}

export function useUpdateChannel() {
  const { sandboxUrl } = useSandboxContext();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelData }) => updateChannel(sandboxUrl!, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useDeleteChannel() {
  const { sandboxUrl } = useSandboxContext();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChannel(sandboxUrl!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useToggleChannel() {
  const { sandboxUrl } = useSandboxContext();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? enableChannel(sandboxUrl!, id) : disableChannel(sandboxUrl!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function getChannelTypeLabel(type: ChannelType): string {
  const labels: Record<ChannelType, string> = {
    telegram: 'Telegram',
    slack: 'Slack',
    discord: 'Discord',
    whatsapp: 'WhatsApp',
    teams: 'Teams',
    voice: 'Voice',
    email: 'Email',
    sms: 'SMS',
  };
  return labels[type] || type;
}

export function formatChannelDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
