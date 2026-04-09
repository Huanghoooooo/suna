/**
 * Kortix Projects hooks — ported from apps/web/src/hooks/kortix/use-kortix-projects.ts
 *
 * Fetches from kortix-master's /kortix/projects API through the sandbox URL.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '@/api/config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface KortixProject {
  id: string;
  name: string;
  path: string;
  description: string;
  created_at: string;
  opencode_id: string | null;
  sessionCount?: number;
  delegationStats?: Record<string, number>;
}

export interface KortixProjectDetail extends KortixProject {
  delegations: Array<{
    session_id: string;
    project_id: string;
    prompt: string;
    agent: string;
    status: string;
    result: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
}

export interface KortixTask {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'cancelled';
  result: string | null;
  priority: 'high' | 'medium' | 'low';
  created_at: string;
  updated_at: string;
}

export interface KortixAgent {
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

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function kortixFetch<T>(sandboxUrl: string, path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const url = `${sandboxUrl.replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kortix API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const kortixKeys = {
  projects: (url: string) => ['kortix', 'projects', url] as const,
  project: (url: string, id: string) => ['kortix', 'projects', url, id] as const,
  projectSessions: (url: string, id: string) => ['kortix', 'projects', url, id, 'sessions'] as const,
  tasks: (url: string, projectId: string) => ['kortix', 'tasks', url, projectId] as const,
  agents: (url: string, projectId: string) => ['kortix', 'agents', url, projectId] as const,
};

// ── Project hooks ────────────────────────────────────────────────────────────

export function useKortixProjects(sandboxUrl: string | undefined) {
  return useQuery<KortixProject[]>({
    queryKey: kortixKeys.projects(sandboxUrl || ''),
    queryFn: () => kortixFetch<KortixProject[]>(sandboxUrl!, '/kortix/projects'),
    enabled: !!sandboxUrl,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

export function useKortixProject(sandboxUrl: string | undefined, id: string) {
  return useQuery<KortixProjectDetail>({
    queryKey: kortixKeys.project(sandboxUrl || '', id),
    queryFn: () => kortixFetch<KortixProjectDetail>(sandboxUrl!, `/kortix/projects/${encodeURIComponent(id)}`),
    enabled: !!sandboxUrl && !!id,
    staleTime: 15_000,
    retry: 2,
  });
}

export function useKortixProjectSessions(sandboxUrl: string | undefined, projectId: string) {
  return useQuery<any[]>({
    queryKey: kortixKeys.projectSessions(sandboxUrl || '', projectId),
    queryFn: () => kortixFetch<any[]>(sandboxUrl!, `/kortix/projects/${encodeURIComponent(projectId)}/sessions`),
    enabled: !!sandboxUrl && !!projectId,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

export function useKortixTasks(sandboxUrl: string | undefined, projectId: string | undefined) {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return useQuery<KortixTask[]>({
    queryKey: kortixKeys.tasks(sandboxUrl || '', projectId || ''),
    queryFn: () => kortixFetch<KortixTask[]>(sandboxUrl!, `/kortix/tasks${qs}`),
    enabled: !!sandboxUrl && !!projectId,
    refetchInterval: 5000,
    retry: 2,
  });
}

export function useKortixAgents(sandboxUrl: string | undefined, projectId: string | undefined) {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return useQuery<KortixAgent[]>({
    queryKey: kortixKeys.agents(sandboxUrl || '', projectId || ''),
    queryFn: async () => {
      try {
        return await kortixFetch<KortixAgent[]>(sandboxUrl!, `/kortix/agents${qs}`);
      } catch {
        return [];
      }
    },
    enabled: !!sandboxUrl && !!projectId,
    refetchInterval: 5000,
  });
}

// ── Mutation hooks ───────────────────────────────────────────────────────────

export function useUpdateProject(sandboxUrl: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string }) =>
      kortixFetch<KortixProject>(sandboxUrl!, `/kortix/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      if (sandboxUrl) {
        qc.invalidateQueries({ queryKey: kortixKeys.project(sandboxUrl, vars.id) });
        qc.invalidateQueries({ queryKey: kortixKeys.projects(sandboxUrl) });
      }
    },
  });
}

export function useDeleteProject(sandboxUrl: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      kortixFetch<{ deleted: boolean; name: string; path: string }>(sandboxUrl!, `/kortix/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      if (sandboxUrl) {
        qc.invalidateQueries({ queryKey: kortixKeys.projects(sandboxUrl) });
      }
    },
  });
}
