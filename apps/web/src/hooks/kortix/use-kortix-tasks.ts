'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';

interface KortixTask {
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

const taskKeys = {
  all: ['kortix', 'tasks'] as const,
  byProject: (projectId: string) => ['kortix', 'tasks', projectId] as const,
  single: (id: string) => ['kortix', 'tasks', 'detail', id] as const,
};

async function kortixTaskFetch<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${serverUrl.replace(/\/+$/, '')}/kortix/tasks${path}`;
  const res = await authenticatedFetch(url, init);
  if (!res.ok) throw new Error(`Tasks API ${res.status}`);
  return res.json();
}

export function useKortixTasks(projectId?: string, status?: string) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (status) params.set('status', status);
  const qs = params.toString() ? `?${params}` : '';
  return useQuery({
    queryKey: [...taskKeys.all, projectId, status],
    queryFn: () => kortixTaskFetch<KortixTask[]>(serverUrl, qs),
    enabled: !!projectId,
    refetchInterval: 3000,
  });
}

export function useKortixTask(id: string) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useQuery({
    queryKey: taskKeys.single(id),
    queryFn: () => kortixTaskFetch<KortixTask>(serverUrl, `/${encodeURIComponent(id)}`),
    enabled: !!id,
  });
}

export function useUpdateKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<KortixTask>) =>
      kortixTaskFetch<KortixTask>(serverUrl, `/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export function useDeleteKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: (id: string) =>
      kortixTaskFetch<{ deleted: boolean }>(serverUrl, `/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: taskKeys.all }); },
  });
}

export type { KortixTask };
