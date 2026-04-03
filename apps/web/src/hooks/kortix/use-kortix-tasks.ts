'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server-store';

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

async function fetchTasks(serverUrl: string, projectId?: string, status?: string): Promise<KortixTask[]> {
  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (status) params.set('status', status);
  const url = `${serverUrl}/kortix/tasks${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

export function useKortixTasks(projectId?: string, status?: string) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useQuery({
    queryKey: [...taskKeys.all, projectId, status],
    queryFn: () => fetchTasks(serverUrl, projectId, status),
    enabled: !!projectId,
    refetchInterval: 3000,
  });
}

export function useKortixTask(id: string) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useQuery({
    queryKey: taskKeys.single(id),
    queryFn: async () => {
      const res = await fetch(`${serverUrl}/kortix/tasks/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('Task not found');
      return res.json() as Promise<KortixTask>;
    },
    enabled: !!id,
  });
}

export function useUpdateKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<KortixTask>) => {
      const res = await fetch(`${serverUrl}/kortix/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update task');
      return res.json() as Promise<KortixTask>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDeleteKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${serverUrl}/kortix/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete task');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export type { KortixTask };
