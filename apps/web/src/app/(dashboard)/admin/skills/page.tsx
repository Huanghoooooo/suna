'use client';

import { useRef, useState } from 'react';
import {
  useAdminRole,
  useAdminSkills,
  useUploadSkill,
  useDeleteSkill,
} from '@/hooks/admin';
import type { AdminSkill } from '@/hooks/admin/use-admin-skills';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Upload, Trash2, Blocks, FolderCode } from 'lucide-react';

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function UploadDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const upload = useUploadSkill();

  const nameValid = SKILL_NAME_REGEX.test(name.trim());
  const canSubmit = nameValid && !!file && !upload.isPending;

  const reset = () => {
    setName('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = () => {
    if (!canSubmit || !file) return;
    upload.mutate(
      { name: name.trim(), file },
      {
        onSuccess: (r) => {
          toast.success(`已安装 skill：${r.skill.name}`);
          reset();
          setOpen(false);
        },
        onError: (e) => toast.error(e.message || '上传失败'),
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
          <Upload className="w-3.5 h-3.5" />
          上传 Skill Upload skill
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>上传 Skill</DialogTitle>
          <DialogDescription>
            zip 内容需包含 <code>SKILL.md</code>（放在 zip 根，或放在单个顶层目录里）。
            可选的 <code>scripts/</code> 目录会一并解压。skill 落到仓库 custom/ 目录下，
            沙盒下次重启 / instance dispose 时生效。
            <br />
            The zip must contain <code>SKILL.md</code> (at its root, or inside a
            single top-level folder). Optional <code>scripts/</code> is preserved.
            The skill is extracted under the custom/ category; sandboxes pick it
            up on next restart or instance dispose.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-name">Skill 名 Name</Label>
            <Input
              id="skill-name"
              placeholder="my-skill"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!name && !nameValid || undefined}
            />
            <p className="text-[11px] text-muted-foreground">
              小写字母、数字、连字符（例如 <code>account-research</code>）。
              Lowercase letters, digits, hyphens.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-file">Zip 文件</Label>
            <Input
              id="skill-file"
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-[11px] text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={upload.isPending}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {upload.isPending ? '上传中…' : '上传'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(s: string) {
  return new Date(s).toLocaleString('zh-CN');
}

export default function AdminSkillsPage() {
  const { data: roleData, isLoading: roleLoading } = useAdminRole();
  const isSuperAdmin = roleData?.role === 'super_admin';
  const { data, isLoading } = useAdminSkills();
  const deleteSkill = useDeleteSkill();
  const [pendingDelete, setPendingDelete] = useState<AdminSkill | null>(null);

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
  if (!isSuperAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Skill 管理仅限 super_admin。
        Skill management is super_admin only.
      </div>
    );
  }

  const skills = data?.skills ?? [];

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Blocks className="w-5 h-5" /> Skill 管理 Skill Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            上传 / 删除自定义 skill，仓库里 custom/ 目录下。沙盒下次重启后看到新变化。
            Upload / delete custom skills stored under custom/. Sandboxes pick up
            changes on next restart.
          </p>
        </div>
        <UploadDialog />
      </header>

      {data?.skillsDir && (
        <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
          <FolderCode className="w-3 h-3" />
          {data.skillsDir}
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称 Name</TableHead>
              <TableHead>描述</TableHead>
              <TableHead>Scripts</TableHead>
              <TableHead>修改时间</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}><Skeleton className="h-5 w-full" /></TableCell>
                </TableRow>
              ))
            ) : skills.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  暂无自定义 skill。点右上角上传一个吧。
                  No custom skills yet. Use Upload to add one.
                </TableCell>
              </TableRow>
            ) : (
              skills.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="font-mono text-sm">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.description ?? '—'}
                  </TableCell>
                  <TableCell>
                    {s.hasScripts ? (
                      <Badge variant="secondary" className="text-xs">scripts/</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(s.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPendingDelete(s)}
                      disabled={deleteSkill.isPending}
                      aria-label="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 skill？Delete skill?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{pendingDelete?.name}</strong> 目录会被递归删除。沙盒下次
              重启后该 skill 不再可用。
              <br />
              The skill directory is rm -rf'd. It will no longer be available to
              sandboxes after their next restart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                deleteSkill.mutate(pendingDelete.name, {
                  onSuccess: () => {
                    toast.success(`已删除 ${pendingDelete.name}`);
                    setPendingDelete(null);
                  },
                  onError: (e) => {
                    toast.error(e.message || '删除失败');
                    setPendingDelete(null);
                  },
                });
              }}
              disabled={deleteSkill.isPending}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
