'use client';

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';

// ---------------------------------------------------------------------------
// Types — mirror suna/core/kortix-master/opencode/plugin/kortix-system/tasks.ts
// ---------------------------------------------------------------------------

export type KortixTaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'cancelled';

export interface KortixTask {
  id: string;
  project_id: string;
  title: string;
  description: string;
  verification_condition: string;
  status: KortixTaskStatus;
  result: string | null;
  verification_summary: string | null;
  blocking_question: string | null;
  owner_session_id: string | null;
  owner_agent: string | null;
  requested_by_session_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KortixTaskComment {
  id: string;
  task_id: string;
  project_id: string;
  author_session_id: string | null;
  author_role: string;
  body: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const taskKeys = {
  all: ['kortix', 'tasks'] as const,
  byProject: (projectId: string) => ['kortix', 'tasks', projectId] as const,
  single: (id: string) => ['kortix', 'tasks', 'detail', id] as const,
  comments: (id: string) => ['kortix', 'tasks', 'comments', id] as const,
};

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function kortixTaskFetch<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${serverUrl.replace(/\/+$/, '')}/kortix/tasks${path}`;
  const res = await authenticatedFetch(url, init);
  if (!res.ok) throw new Error(`Tasks API ${res.status}`);
  return res.json();
}

/**
 * Normalize raw task rows from the API so legacy / unknown enum values
 * never reach the UI. Mirror of `normalizeStatus` in lib/kortix/task-meta.ts
 * — duplicated here to avoid import cycles.
 */
const LEGACY_STATUS_MAP: Record<string, KortixTaskStatus> = {
  pending: 'todo',
  open: 'todo',
  blocked: 'todo',
  info_needed: 'todo',
  failed: 'cancelled',
  done: 'completed',
  closed: 'completed',
  archived: 'cancelled',
};
const VALID_STATUSES: KortixTaskStatus[] = [
  'backlog', 'todo', 'in_progress', 'in_review',
  'completed', 'cancelled',
];

function normalizeTask(raw: any): KortixTask {
  const status = VALID_STATUSES.includes(raw?.status)
    ? raw.status
    : LEGACY_STATUS_MAP[raw?.status] || 'todo';
  return {
    id: raw.id,
    project_id: raw.project_id,
    title: raw.title || '',
    description: raw.description || '',
    verification_condition: raw.verification_condition || '',
    status,
    result: raw.result ?? null,
    verification_summary: raw.verification_summary ?? null,
    blocking_question: raw.blocking_question ?? null,
    owner_session_id: raw.owner_session_id ?? null,
    owner_agent: raw.owner_agent ?? null,
    requested_by_session_id: raw.requested_by_session_id ?? null,
    started_at: raw.started_at ?? null,
    completed_at: raw.completed_at ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function useKortixTasks(projectId?: string, status?: string) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (status) params.set('status', status);
  const qs = params.toString() ? `?${params}` : '';
  return useQuery({
    queryKey: [...taskKeys.all, projectId, status],
    queryFn: async () => {
      const rows = await kortixTaskFetch<any[]>(serverUrl, qs);
      return Array.isArray(rows) ? rows.map(normalizeTask) : [];
    },
    enabled: !!projectId,
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });
}

export function useKortixTask(id: string) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useQuery({
    queryKey: taskKeys.single(id),
    queryFn: async () => {
      const raw = await kortixTaskFetch<any>(serverUrl, `/${encodeURIComponent(id)}`);
      return normalizeTask(raw);
    },
    enabled: !!id,
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: (data: {
      project_id: string;
      title: string;
      description?: string;
      verification_condition?: string;
      status?: KortixTaskStatus;
    }) =>
      kortixTaskFetch<KortixTask>(serverUrl, '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useStartKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: ({ id, session_id, agent }: { id: string; session_id?: string; agent?: string }) =>
      kortixTaskFetch<KortixTask>(serverUrl, `/${encodeURIComponent(id)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id, agent }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useApproveKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: (id: string) =>
      kortixTaskFetch<KortixTask>(serverUrl, `/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDeleteKortixTask() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: (id: string) =>
      kortixTaskFetch<{ deleted: boolean }>(serverUrl, `/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function useKortixTaskComments(taskId?: string) {
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useQuery({
    queryKey: taskKeys.comments(taskId || ''),
    queryFn: () =>
      kortixTaskFetch<KortixTaskComment[]>(serverUrl, `/${encodeURIComponent(taskId!)}/comments`),
    enabled: !!taskId,
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });
}

export function useAddKortixTaskComment() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: ({ task_id, body, author_role }: { task_id: string; body: string; author_role?: string }) =>
      kortixTaskFetch<KortixTaskComment>(serverUrl, `/${encodeURIComponent(task_id)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, author_role: author_role || 'user' }),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: taskKeys.comments(vars.task_id) });
      qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDeleteKortixTaskComment() {
  const qc = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());
  return useMutation({
    mutationFn: ({ task_id, comment_id }: { task_id: string; comment_id: string }) =>
      kortixTaskFetch<{ deleted: boolean }>(
        serverUrl,
        `/${encodeURIComponent(task_id)}/comments/${encodeURIComponent(comment_id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: taskKeys.comments(vars.task_id) });
    },
  });
}
