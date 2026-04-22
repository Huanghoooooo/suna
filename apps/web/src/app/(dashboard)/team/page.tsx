'use client';

import { useMemo } from 'react';
import { useMyAccounts } from '@/hooks/account/use-team';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { UserRoundCheck, Users } from 'lucide-react';

function formatDateTime(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString('zh-CN');
}

export default function TeamPage() {
  const { data: myAccounts, isLoading } = useMyAccounts();
  const accounts = useMemo(() => myAccounts ?? [], [myAccounts]);

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="w-5 h-5" /> 用户账号 User Account
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          当前部署采用 1:1 用户账号模型：每个登录用户只绑定自己的 personal account。
          团队成员邀请、把新用户加入既有账号等旧入口已关闭，避免用户资料和沙箱上下文串号。
        </p>
      </header>

      <section className="rounded-lg border">
        <div className="p-4 border-b">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <UserRoundCheck className="w-4 h-4" /> 我的账号 My Account
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号 Account</TableHead>
              <TableHead>类型 Type</TableHead>
              <TableHead>角色 Role</TableHead>
              <TableHead>创建时间 Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                  暂无账号 No account
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <TableRow key={account.account_id}>
                  <TableCell>
                    <div className="font-medium">{account.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {account.account_id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={account.personal_account ? 'secondary' : 'outline'}>
                      {account.personal_account ? 'personal' : 'legacy team'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{account.account_role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(account.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
