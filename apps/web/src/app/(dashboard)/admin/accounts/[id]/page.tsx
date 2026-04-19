'use client';

import { use, useState } from 'react';
import {
  useAdminAccountDetail,
  useAdminRole,
  useSetPlatformRole,
  useSetMemberRole,
  useRemoveMember,
  useCreateAccountMember,
} from '@/hooks/admin';
import { openTabAndNavigate } from '@/stores/tab-store';
import type {
  AccountRole,
  PlatformRole,
  AdminAccountMember,
} from '@/hooks/admin/use-admin-accounts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import { ArrowLeft, ShieldCheck, UserMinus, Crown, UserPlus } from 'lucide-react';

function formatDateTime(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('zh-CN');
}

function PlatformRoleSection({
  accountId,
  currentRole,
  callerRole,
}: {
  accountId: string;
  currentRole: PlatformRole;
  callerRole: PlatformRole;
}) {
  const setRole = useSetPlatformRole();

  // Hierarchy: admin cannot change rows that currently have super_admin,
  // and cannot set super_admin. super_admin can do anything.
  const canEditSuperAdmin = callerRole === 'super_admin';
  const disabled =
    setRole.isPending ||
    (!canEditSuperAdmin && currentRole === 'super_admin');

  const handleChange = (next: string) => {
    const role = next as PlatformRole;
    if (role === currentRole) return;
    setRole.mutate(
      { accountId, role },
      {
        onSuccess: () => toast.success(`平台角色已设为 ${role}`),
        onError: (e) => toast.error(e.message || '修改失败'),
      },
    );
  };

  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> 平台角色 Platform Role
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            控制该账号是否能进入 <code>/admin</code> 后台。
            Gates access to the <code>/admin</code> panel.
          </p>
        </div>
        <div className="min-w-[180px]">
          <Select value={currentRole} onValueChange={handleChange} disabled={disabled}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">user（默认，无后台访问）</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
              <SelectItem value="super_admin" disabled={!canEditSuperAdmin}>
                super_admin{!canEditSuperAdmin && '（需超管）'}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {!canEditSuperAdmin && currentRole === 'super_admin' && (
        <p className="text-xs text-amber-500 mt-3">
          只有 super_admin 可以修改 super_admin 账号。
          Only a super_admin can change a super_admin account.
        </p>
      )}
    </section>
  );
}

function MemberRoleSelect({
  currentRole,
  onChange,
  disabled,
}: {
  currentRole: AccountRole;
  onChange: (r: AccountRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={currentRole}
      onValueChange={(v) => onChange(v as AccountRole)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-[120px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="owner">owner</SelectItem>
        <SelectItem value="admin">admin</SelectItem>
        <SelectItem value="member">member</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CreateMemberDialog({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const createMember = useCreateAccountMember();

  const passwordMismatch = password.length > 0 && confirm.length > 0 && password !== confirm;
  const canSubmit =
    email.includes('@') &&
    password.length >= 8 &&
    password === confirm &&
    !createMember.isPending;

  const reset = () => {
    setEmail('');
    setPassword('');
    setConfirm('');
    setRole('member');
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    createMember.mutate(
      { accountId, email: email.trim().toLowerCase(), password, accountRole: role },
      {
        onSuccess: (d) => {
          toast.success(`已创建 ${d.email}（角色: ${d.accountRole}）`);
          reset();
          setOpen(false);
        },
        onError: (e) => {
          toast.error(e.message || '创建失败');
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="w-3.5 h-3.5" />
          新建成员 Add member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建成员 Create member</DialogTitle>
          <DialogDescription>
            管理员直接建账号并指定初始密码。新用户会以指定角色加入当前账号，首次登录
            建议让他自行修改密码。
            <br />
            The admin provisions the account and sets the initial password. The user
            is added to this account with the chosen role; have them rotate the
            password on first login.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-member-email">邮箱 Email</Label>
            <Input
              id="new-member-email"
              type="email"
              autoComplete="off"
              placeholder="employee@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-member-password">初始密码 Password（≥ 8 字符）</Label>
            <Input
              id="new-member-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-member-confirm">再次输入密码 Confirm password</Label>
            <Input
              id="new-member-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={passwordMismatch || undefined}
            />
            {passwordMismatch && (
              <p className="text-[11px] text-red-500">两次输入不一致 Passwords do not match</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>账号内角色 Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AccountRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">member（默认）</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="owner">owner</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              owner 不可逆地拥有删除账号的权限，谨慎使用。owner has destructive rights; grant sparingly.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={createMember.isPending}>
            取消 Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {createMember.isPending ? '创建中… Creating…' : '创建 Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersTable({
  accountId,
  members,
}: {
  accountId: string;
  members: AdminAccountMember[];
}) {
  const setRole = useSetMemberRole();
  const removeMember = useRemoveMember();
  const [pendingRemove, setPendingRemove] = useState<AdminAccountMember | null>(null);

  const ownerCount = members.filter((m) => m.accountRole === 'owner').length;

  const handleRoleChange = (m: AdminAccountMember, next: AccountRole) => {
    if (next === m.accountRole) return;
    setRole.mutate(
      { accountId, userId: m.userId, role: next },
      {
        onSuccess: () => toast.success(`${m.email ?? m.userId} 已改为 ${next}`),
        onError: (e) => toast.error(e.message || '修改失败'),
      },
    );
  };

  const handleRemove = (m: AdminAccountMember) => {
    removeMember.mutate(
      { accountId, userId: m.userId },
      {
        onSuccess: () => {
          toast.success(`${m.email ?? m.userId} 已移除`);
          setPendingRemove(null);
        },
        onError: (e) => {
          toast.error(e.message || '移除失败');
          setPendingRemove(null);
        },
      },
    );
  };

  return (
    <section className="rounded-lg border">
      <div className="p-4 border-b flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Crown className="w-4 h-4" /> 账号成员 Members
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            管理该账号内的角色（owner / admin / member）。不能移除或降级最后一个 owner。
            Manage in-account roles. The last owner cannot be removed or demoted.
          </p>
        </div>
        <CreateMemberDialog accountId={accountId} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>邮箱 Email</TableHead>
            <TableHead>加入时间</TableHead>
            <TableHead>角色 Role</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                暂无成员 No members
              </TableCell>
            </TableRow>
          ) : (
            members.map((m) => {
              const isLastOwner = m.accountRole === 'owner' && ownerCount <= 1;
              return (
                <TableRow key={m.userId}>
                  <TableCell className="font-mono text-sm">{m.email ?? m.userId}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(m.joinedAt)}
                  </TableCell>
                  <TableCell>
                    <MemberRoleSelect
                      currentRole={m.accountRole}
                      onChange={(next) => handleRoleChange(m, next)}
                      disabled={setRole.isPending || (isLastOwner)}
                    />
                    {isLastOwner && (
                      <div className="text-[10px] text-amber-500 mt-1">末位 owner 锁定</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={removeMember.isPending || isLastOwner}
                      onClick={() => setPendingRemove(m)}
                      aria-label="移除成员 Remove member"
                    >
                      <UserMinus className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除成员 Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              移除后 <strong>{pendingRemove?.email ?? pendingRemove?.userId}</strong>{' '}
              将无法访问该账号。此操作不会删除用户，只解除与账号的关联。
              <br />
              The user will lose access to this account. The user record itself is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消 Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingRemove && handleRemove(pendingRemove)}
              disabled={removeMember.isPending}
            >
              移除 Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default function AdminAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: roleData, isLoading: roleLoading } = useAdminRole();
  const { data, isLoading, error } = useAdminAccountDetail(id);

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
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 text-sm text-red-500">
        加载失败 Failed to load: {error?.message || 'not found'}
      </div>
    );
  }

  const callerRole = (roleData?.role ?? 'admin') as PlatformRole;

  return (
    <div className="flex flex-col gap-4 p-6">
      <button
        type="button"
        onClick={() =>
          openTabAndNavigate({
            id: 'page:/admin/accounts',
            title: '账号与角色',
            type: 'page',
            href: '/admin/accounts',
          })
        }
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 w-fit bg-transparent border-0 p-0 cursor-pointer"
      >
        <ArrowLeft className="w-3 h-3" /> 返回账号列表 Back to accounts
      </button>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {data.account.name}
            {data.account.personalAccount && (
              <Badge variant="secondary">personal</Badge>
            )}
          </h1>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {data.account.accountId}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground space-y-1">
          <div>创建 Created: {formatDateTime(data.account.createdAt)}</div>
          <div>更新 Updated: {formatDateTime(data.account.updatedAt)}</div>
          {data.account.setupCompleteAt && (
            <div>安装完成 Setup: {formatDateTime(data.account.setupCompleteAt)}</div>
          )}
        </div>
      </header>

      <PlatformRoleSection
        accountId={data.account.accountId}
        currentRole={data.platformRole}
        callerRole={callerRole}
      />

      <MembersTable accountId={data.account.accountId} members={data.members} />
    </div>
  );
}
