import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';

export type PlatformRole = 'user' | 'admin' | 'super_admin';
export type AccountRole = 'owner' | 'admin' | 'member';

export interface AdminAccountSummary {
  accountId: string;
  name: string;
  personalAccount: boolean;
  createdAt: string;
  ownerEmail: string | null;
  memberCount: number;
  platformRole: PlatformRole | null;
}

interface AccountListResponse {
  accounts: AdminAccountSummary[];
  total: number;
  page: number;
  limit: number;
  error?: string;
}

export interface AdminAccountMember {
  userId: string;
  accountRole: AccountRole;
  joinedAt: string;
  email: string | null;
}

export interface AdminAccountDetail {
  account: {
    accountId: string;
    name: string;
    personalAccount: boolean;
    setupCompleteAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  platformRole: PlatformRole;
  members: AdminAccountMember[];
}

export interface AdminAccountListParams {
  search?: string;
  page?: number;
  limit?: number;
}

export function useAdminAccounts(params: AdminAccountListParams = {}) {
  const { search = '', page = 1, limit = 50 } = params;

  return useQuery<AccountListResponse>({
    queryKey: ['admin', 'accounts', 'list', search, page, limit],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      q.set('page', String(page));
      q.set('limit', String(limit));

      const response = await backendApi.get<AccountListResponse>(
        `/admin/api/accounts?${q.toString()}`,
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useAdminAccountDetail(accountId: string | null) {
  return useQuery<AdminAccountDetail>({
    queryKey: ['admin', 'accounts', 'detail', accountId],
    queryFn: async () => {
      if (!accountId) throw new Error('accountId required');
      const response = await backendApi.get<AdminAccountDetail>(
        `/admin/api/accounts/${accountId}`,
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    enabled: !!accountId,
    staleTime: 10_000,
  });
}

interface SetPlatformRoleArgs {
  accountId: string;
  role: PlatformRole;
}

export function useSetPlatformRole() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; role: PlatformRole }, Error, SetPlatformRoleArgs>({
    mutationFn: async ({ accountId, role }) => {
      const response = await backendApi.put<{ ok: boolean; role: PlatformRole }>(
        `/admin/api/platform-roles/${accountId}`,
        { role },
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: (_d, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'accounts'] });
      qc.invalidateQueries({ queryKey: ['admin', 'accounts', 'detail', accountId] });
      qc.invalidateQueries({ queryKey: ['admin', 'platform-roles'] });
    },
  });
}

interface SetMemberRoleArgs {
  accountId: string;
  userId: string;
  role: AccountRole;
}

export function useSetMemberRole() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; role: AccountRole }, Error, SetMemberRoleArgs>({
    mutationFn: async ({ accountId, userId, role }) => {
      const response = await backendApi.put<{ ok: boolean; role: AccountRole }>(
        `/admin/api/accounts/${accountId}/members/${userId}`,
        { role },
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: (_d, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'accounts', 'detail', accountId] });
    },
  });
}

interface RemoveMemberArgs {
  accountId: string;
  userId: string;
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; removed: boolean }, Error, RemoveMemberArgs>({
    mutationFn: async ({ accountId, userId }) => {
      const response = await backendApi.delete<{ ok: boolean; removed: boolean }>(
        `/admin/api/accounts/${accountId}/members/${userId}`,
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: (_d, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'accounts', 'detail', accountId] });
    },
  });
}

// List all explicit platform roles (accounts that are admin or super_admin).
export interface PlatformRoleEntry {
  accountId: string;
  role: 'admin' | 'super_admin';
  grantedBy: string | null;
  createdAt: string;
  accountName: string;
  personalAccount: boolean;
  ownerEmail: string | null;
}

export function usePlatformRoles() {
  return useQuery<{ roles: PlatformRoleEntry[] }>({
    queryKey: ['admin', 'platform-roles'],
    queryFn: async () => {
      const response = await backendApi.get<{ roles: PlatformRoleEntry[] }>(
        '/admin/api/platform-roles',
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    staleTime: 15_000,
  });
}
