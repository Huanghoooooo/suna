import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';

/**
 * Super-admin skill management — not part of the account-internal UI.
 * Wraps /v1/admin/api/skills.
 */

export interface AdminSkill {
  name: string;
  description: string | null;
  path: string;
  hasScripts: boolean;
  updatedAt: string;
}

interface SkillListResponse {
  skillsDir: string;
  skills: AdminSkill[];
  error?: string;
}

export function useAdminSkills() {
  return useQuery<SkillListResponse>({
    queryKey: ['admin', 'skills', 'list'],
    queryFn: async () => {
      const response = await backendApi.get<SkillListResponse>('/admin/api/skills');
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    staleTime: 15_000,
  });
}

export function useUploadSkill() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; skill: AdminSkill },
    Error,
    { name: string; file: File }
  >({
    mutationFn: async ({ name, file }) => {
      const form = new FormData();
      form.append('name', name);
      form.append('file', file);
      // backendApi helper always sets application/json; use raw fetch for
      // multipart uploads so the browser builds the right boundary.
      const { getSupabaseAccessTokenWithRetry } = await import('@/lib/auth-token');
      const { getEnv } = await import('@/lib/env-config');
      const token = await getSupabaseAccessTokenWithRetry();
      const res = await fetch(`${getEnv().BACKEND_URL || ''}/admin/api/skills`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Upload failed (${res.status})`);
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'skills'] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; removed: string }, Error, string>({
    mutationFn: async (name) => {
      const response = await backendApi.delete<{ ok: boolean; removed: string }>(
        `/admin/api/skills/${encodeURIComponent(name)}`,
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'skills'] });
    },
  });
}
