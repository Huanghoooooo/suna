'use client';

import { useQuery } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';

interface KortixAgent {
  id: string;
  project_id: string;
  session_id: string;
  parent_session_id: string;
  agent_type: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  result: string | null;
  created_at: string;
  updated_at: string;
}

interface KortixAgentQueryOptions {
  enabled?: boolean;
  pollingEnabled?: boolean;
}

export function useKortixAgents(
  projectId?: string,
  options: KortixAgentQueryOptions = {},
) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  const qs = params.toString() ? `?${params}` : '';
  return useQuery({
    queryKey: ['kortix', 'agents', projectId],
    queryFn: async () => {
      const url = `${serverUrl.replace(/\/+$/, '')}/kortix/agents${qs}`;
      const res = await authenticatedFetch(url);
      if (!res.ok) return [];
      return res.json() as Promise<KortixAgent[]>;
    },
    enabled: !!projectId && (options.enabled ?? true),
    refetchInterval: options.pollingEnabled === false ? false : 5000,
    refetchIntervalInBackground: false,
  });
}

export type { KortixAgent };
