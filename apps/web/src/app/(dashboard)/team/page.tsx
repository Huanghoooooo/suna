'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useMyAccounts,
  useTeamMembers,
  useCreateTeamMember,
  useSetTeamMemberRole,
  useRemoveTeamMember,
} from '@/hooks/account/use-team';
import type { AccountRole, AdminAccountMember } from '@/hooks/admin/use-admin-accounts';
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
import { Crown, UserMinus, UserPlus, Users } from 'lucide-react';

function formatDateTime(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('zh-CN');
}

function RoleBadge({ role }: { role: AccountRole }) {
  if (role === 'owner') return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30">owner</Badge>;
  if (role === 'admin') return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30">admin</Badge>;
  return <Badge variant="secondary">member</Badge>;
}

function CreateDialog({
  accountId,
  callerRole,
}: {
  accountId: string;
  callerRole: AccountRole;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const createMember = useCreateTeamMember();

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
          toast.success(`已创建 ${d.email}（${d.accountRole}）`);
          reset();
          setOpen(false);
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
            账号内 owner/admin 自助新建成员。新用户会直接加入当前账号，
            建议首次登录后让他自改密码。
            <br />
            Owners/admins can create a member directly. The user joins this
            account immediately; have them rotate the password on first login.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-email">邮箱 Email</Label>
            <Input
              id="team-email"
              type="email"
              autoComplete="off"
              placeholder="employee@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-pass">初始密码 Password（≥ 8 字符）</Label>
            <Input
              id="team-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-pass2">再次输入密码 Confirm</Label>
            <Input
              id="team-pass2"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={passwordMismatch || undefined}
            />
            {passwordMismatch && (
              <p className="text-[11px] text-red-500">两次输入不一致</p>
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
                <SelectItem value="owner" disabled={callerRole !== 'owner'}>
                  owner{callerRole !== 'owner' && '（需 owner）'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={createMember.isPending}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {createMember.isPending ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersSection({ accountId }: { accountId: string }) {
  const { data, isLoading, error } = useTeamMembers(accountId);
  const setRole = useSetTeamMemberRole();
  const removeMember = useRemoveTeamMember();
  const [pendingRemove, setPendingRemove] = useState<AdminAccountMember | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-lg border p-6">
        <Skeleton className="h-6 w-32 mb-4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border p-6 text-sm text-red-500">
        加载失败 Failed to load: {error?.message || 'not found'}
      </div>
    );
  }

  const { callerRole, members } = data;
  const canEdit = callerRole === 'owner' || callerRole === 'admin';
  const ownerCount = members.filter((m) => m.accountRole === 'owner').length;

  const handleRoleChange = (m: AdminAccountMember, next: AccountRole) => {
    if (next === m.accountRole) return;
    setRole.mutate(
      { accountId, userId: m.userId, role: next },
      {
        onSuccess: () => toast.success(`${m.email ?? m.userId} → ${next}`),
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
            <Crown className="w-4 h-4" /> 成员 Members
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            你在该账号的角色：
            <RoleBadge role={callerRole} />
            {canEdit
              ? '　可管理成员；admin 不能动 owner、不能移除末位 owner。'
              : '　只读；要管理需要 owner/admin 权限。'}
          </p>
        </div>
        {canEdit && <CreateDialog accountId={accountId} callerRole={callerRole} />}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>邮箱</TableHead>
            <TableHead>加入时间</TableHead>
            <TableHead>角色</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                暂无成员
              </TableCell>
            </TableRow>
          ) : (
            members.map((m) => {
              const isLastOwner = m.accountRole === 'owner' && ownerCount <= 1;
              // admin cannot edit owners; owner can edit anyone
              const disabledByHierarchy =
                callerRole === 'admin' && m.accountRole === 'owner';
              const editableRow = canEdit && !disabledByHierarchy;
              return (
                <TableRow key={m.userId}>
                  <TableCell className="font-mono text-sm">{m.email ?? m.userId}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(m.joinedAt)}
                  </TableCell>
                  <TableCell>
                    {editableRow ? (
                      <Select
                        value={m.accountRole}
                        onValueChange={(v) => handleRoleChange(m, v as AccountRole)}
                        disabled={setRole.isPending || isLastOwner}
                      >
                        <SelectTrigger className="h-8 w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">member</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                          <SelectItem value="owner" disabled={callerRole !== 'owner'}>
                            owner
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <RoleBadge role={m.accountRole} />
                    )}
                    {isLastOwner && (
                      <div className="text-[10px] text-amber-500 mt-1">末位 owner 锁定</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {editableRow && (
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={removeMember.isPending || isLastOwner}
                        onClick={() => setPendingRemove(m)}
                        aria-label="移除"
                      >
                        <UserMinus className="w-4 h-4" />
                      </Button>
                    )}
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
            <AlertDialogTitle>确认移除？ Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{pendingRemove?.email ?? pendingRemove?.userId}</strong>{' '}
              将失去对该账号的访问。不会删用户本身。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingRemove && handleRemove(pendingRemove)}
              disabled={removeMember.isPending}
            >
              移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default function TeamPage() {
  const { data: myAccounts, isLoading } = useMyAccounts();
  const [selected, setSelected] = useState<string | null>(null);

  const manageable = useMemo(
    () => (myAccounts ?? []).filter((a) => !a.personal_account),
    [myAccounts],
  );

  useEffect(() => {
    if (selected) return;
    if (manageable.length > 0) setSelected(manageable[0]!.account_id);
  }, [manageable, selected]);

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (manageable.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <header>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" /> 团队管理 Team
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            你目前只有个人账号，还没有加入任何团队/部门账号。
            You're only in your personal account; no team accounts to manage yet.
            <br />
            联系平台超管（super_admin）为你创建团队账号。
            Contact the platform super_admin to create a team account for you.
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" /> 团队管理 Team
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理你所在账号（部门/工作区）的成员。你需要 owner 或 admin 权限才能编辑。
            Manage members of accounts you belong to. Editing requires owner or
            admin role.
          </p>
        </div>
        {manageable.length > 1 && (
          <div className="min-w-[240px]">
            <Label className="text-xs text-muted-foreground">切换账号 Account</Label>
            <Select
              value={selected ?? undefined}
              onValueChange={(v) => setSelected(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                {manageable.map((a) => (
                  <SelectItem key={a.account_id} value={a.account_id}>
                    {a.name} · {a.account_role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      {selected && <MembersSection accountId={selected} />}
    </div>
  );
}
