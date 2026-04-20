'use client';

import { useState, useEffect } from 'react';
import { useAdminAccounts, useAdminRole, useCreateAccount } from '@/hooks/admin';
import type { AdminAccountSummary, PlatformRole } from '@/hooks/admin/use-admin-accounts';
import { openTabAndNavigate } from '@/stores/tab-store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import {
  Search, ChevronLeft, ChevronRight, ShieldCheck, ArrowRight, Plus,
} from 'lucide-react';

const PAGE_SIZE = 50;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function PlatformRoleBadge({ role }: { role: PlatformRole | null }) {
  if (!role || role === 'user') {
    return <span className="text-xs text-muted-foreground">user</span>;
  }
  if (role === 'super_admin') {
    return (
      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 gap-1">
        <ShieldCheck className="w-3 h-3" /> super_admin
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 gap-1">
      <ShieldCheck className="w-3 h-3" /> admin
    </Badge>
  );
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function CreateAccountDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const createAccount = useCreateAccount();

  const canSubmit = name.trim().length > 0 && !createAccount.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createAccount.mutate(
      { name: name.trim() },
      {
        onSuccess: (acct) => {
          toast.success(`已创建账号 "${acct.name}"，你是 owner`);
          setName('');
          setOpen(false);
          openTabAndNavigate({
            id: `page:/admin/accounts/${acct.accountId}`,
            title: acct.name,
            type: 'page',
            href: `/admin/accounts/${acct.accountId}`,
          });
        },
        onError: (e) => toast.error(e.message || '创建失败'),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setName('');
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          新建账号 New account
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建团队账号 Create team account</DialogTitle>
          <DialogDescription>
            一个账号通常对应一个部门或共享工作区。你将自动成为该账号的 owner，
            之后可以拉人进来、再把 owner 转给实际负责人。
            <br />
            One account usually maps to a department or shared workspace. You
            become the initial owner; add members and later transfer ownership
            to the real lead.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-account-name">账号名 Name</Label>
          <Input
            id="new-account-name"
            placeholder="销售部 / 研发部 / 客户 ACME"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) handleSubmit();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={createAccount.isPending}>
            取消 Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {createAccount.isPending ? '创建中… Creating…' : '创建 Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminAccountsPage() {
  const { data: roleData, isLoading: roleLoading } = useAdminRole();
  const isSuperAdmin = roleData?.role === 'super_admin';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isLoading, isFetching } = useAdminAccounts({
    search: debouncedSearch,
    page,
    limit: PAGE_SIZE,
  });

  if (roleLoading) {
    return <div className="p-6"><Skeleton className="h-8 w-48" /></div>;
  }
  if (!roleData?.isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        需要管理员权限 Admin access required.
      </div>
    );
  }

  const accounts = data?.accounts ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">账号管理 Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            浏览平台上的所有账号、分配平台角色、管理账号内成员。
            Browse all accounts, assign platform roles, manage account members.
          </p>
        </div>
        {isSuperAdmin && <CreateAccountDialog />}
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索账号名或成员邮箱 Search account name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="text-xs text-muted-foreground ml-auto">
          {isFetching ? '加载中 Loading…' : `共 ${total} 个账号 Total ${total}`}
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号 Account</TableHead>
              <TableHead>Owner 邮箱</TableHead>
              <TableHead className="text-right">成员</TableHead>
              <TableHead>平台角色</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}><Skeleton className="h-5 w-full" /></TableCell>
                </TableRow>
              ))
            ) : accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  无匹配账号 No accounts found
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((a: AdminAccountSummary) => {
                const openDetail = () =>
                  openTabAndNavigate({
                    id: `page:/admin/accounts/${a.accountId}`,
                    title: a.name || '账号详情',
                    type: 'page',
                    href: `/admin/accounts/${a.accountId}`,
                  });
                return (
                  <TableRow
                    key={a.accountId}
                    className="hover:bg-muted/40 cursor-pointer"
                    onClick={openDetail}
                  >
                    <TableCell>
                      <span className="font-medium">{a.name}</span>
                      {a.personalAccount && (
                        <Badge variant="secondary" className="ml-2 text-xs">personal</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.ownerEmail ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.memberCount}</TableCell>
                    <TableCell><PlatformRoleBadge role={a.platformRole} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(a.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            第 {page} / {totalPages} 页 Page {page} / {totalPages}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
