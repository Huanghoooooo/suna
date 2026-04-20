import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/lib/api-client';
import type { AccountRole, AdminAccountMember } from '@/hooks/admin/use-admin-accounts';

/**
 * Account self-service — NOT the /admin UI. These hooks target the
 * /v1/account-membership routes, which work for any account member
 * provided they are owner/admin of that account. No platform-level
 * admin role required.
 */

export interface AccountSummary {
  account_id: string;
  name: string;
  slug: string;
  personal_account: boolean;
  account_role: AccountRole;
  is_primary_owner: boolean;
}

/** GET /v1/accounts — all accounts the current user belongs to. */
export function useMyAccounts() {
  return useQuery<AccountSummary[]>({
    queryKey: ['accounts', 'mine'],
    queryFn: async () => {
      const response = await backendApi.get<AccountSummary[]>('/accounts');
      if (response.error) throw new Error(response.error.message);
      return response.data ?? [];
    },
    staleTime: 30_000,
  });
}

export interface TeamMembersResponse {
  callerRole: AccountRole;
  members: AdminAccountMember[];
}

/** GET /v1/account-membership/:accountId/members */
export function useTeamMembers(accountId: string | null) {
  return useQuery<TeamMembersResponse>({
    queryKey: ['team', 'members', accountId],
    queryFn: async () => {
      if (!accountId) throw new Error('accountId required');
      const response = await backendApi.get<TeamMembersResponse>(
        `/account-membership/${accountId}/members`,
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    enabled: !!accountId,
    staleTime: 10_000,
  });
}

interface CreateTeamMemberArgs {
  accountId: string;
  email: string;
  password: string;
  accountRole: AccountRole;
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; userId: string; email: string; accountId: string; accountRole: AccountRole },
    Error,
    CreateTeamMemberArgs
  >({
    mutationFn: async ({ accountId, email, password, accountRole }) => {
      const response = await backendApi.post<{
        ok: boolean;
        userId: string;
        email: string;
        accountId: string;
        accountRole: AccountRole;
      }>(`/account-membership/${accountId}/members`, { email, password, accountRole });
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: (_d, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['team', 'members', accountId] });
    },
  });
}

interface SetTeamMemberRoleArgs {
  accountId: string;
  userId: string;
  role: AccountRole;
}

export function useSetTeamMemberRole() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; role: AccountRole }, Error, SetTeamMemberRoleArgs>({
    mutationFn: async ({ accountId, userId, role }) => {
      const response = await backendApi.put<{ ok: boolean; role: AccountRole }>(
        `/account-membership/${accountId}/members/${userId}`,
        { role },
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: (_d, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['team', 'members', accountId] });
    },
  });
}

interface RemoveTeamMemberArgs {
  accountId: string;
  userId: string;
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; removed: boolean }, Error, RemoveTeamMemberArgs>({
    mutationFn: async ({ accountId, userId }) => {
      const response = await backendApi.delete<{ ok: boolean; removed: boolean }>(
        `/account-membership/${accountId}/members/${userId}`,
      );
      if (response.error) throw new Error(response.error.message);
      return response.data!;
    },
    onSuccess: (_d, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['team', 'members', accountId] });
    },
  });
}
