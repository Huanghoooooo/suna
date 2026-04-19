'use client';

import { cn } from '@/lib/utils';
import React, { useState, useMemo, useCallback } from 'react';
import { Key, Plus, Trash2, Copy, Check, Shield, RefreshCw, Bot, AlertCircle, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  apiKeysApi,
  APIKeyCreateRequest,
  APIKeyResponse,
  APIKeyCreateResponse,
  APIKeyRegenerateResponse,
} from '@/lib/api/api-keys';
import { getActiveServer, getActiveOpenCodeUrl } from '@/stores/server-store';
import { getAuthToken } from '@/lib/auth-token';
import { useServerStore } from '@/stores/server-store';
import { getEnv } from '@/lib/env-config';
// ── Helpers ────────────────────────────────────────────────────────────────

interface NewAPIKeyData {
  title: string;
  description: string;
  expiresInDays: string;
}

interface ShareFormData {
  port: string;
  ttl: string;
  label: string;
}

interface PublicShareEntry {
  url: string;
  port: number;
  token: string;
  expiresAt: string;
  label?: string;
}

function CopyButton({ value, label, size = 'sm' }: { value: string; label?: string; size?: 'sm' | 'icon' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.warning('复制到剪贴板失败');
    }
  }, [value]);

  if (size === 'icon') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        title="Copy"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={handleCopy}>
      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
      {label && <span className="ml-1.5">{label}</span>}
    </Button>
  );
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateFull(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isKeyExpired(expiresAt?: string) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {'活跃'}
        </span>
      );
    case 'revoked':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          {'已撤销'}
        </span>
      );
    case 'expired':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
          {'已过期'}
        </span>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function APIKeysPage() {
  // Use instanceId (the stable DB UUID) so the api-keys backend can resolve
  // ownership unambiguously. Using sandboxId (external_id) breaks for cloud
  // providers like Daytona where the external_id is also a UUID — the backend
  // would mistakenly treat it as the DB primary key and return 404.
  // Subscribing to both activeServerId and servers ensures reactivity when
  // the server entry is updated without an activeServerId change.
  const activeSandboxId = useServerStore((s) => {
    const server = s.servers.find((e) => e.id === s.activeServerId);
    return server?.instanceId;
  });
  const activeSandboxExternalId = useServerStore((s) => {
    const server = s.servers.find((e) => e.id === s.activeServerId);
    return server?.sandboxId;
  });
  const activeServer = getActiveServer();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newKeyData, setNewKeyData] = useState<NewAPIKeyData>({
    title: '',
    description: '',
    expiresInDays: 'never',
  });
  const [createdApiKey, setCreatedApiKey] = useState<APIKeyCreateResponse | APIKeyRegenerateResponse | null>(null);
  const [showCreatedKey, setShowCreatedKey] = useState(false);
  const [shareForm, setShareForm] = useState<ShareFormData>({
    port: '8000',
    ttl: '1h',
    label: '',
  });
  const queryClient = useQueryClient();
  const activeInstanceUrl = getActiveOpenCodeUrl()?.replace(/\/+$/, '');
  const backendBase = useMemo(
    () => (getEnv().BACKEND_URL || 'http://localhost:8008/v1').replace(/\/+$/, ''),
    [],
  );

  // ── Queries & mutations ────────────────────────────────────────────────

  const {
    data: apiKeysResponse,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['api-keys', activeSandboxId],
    queryFn: () => apiKeysApi.list(activeSandboxId!),
    enabled: !!activeSandboxId,
  });

  const apiKeysData = apiKeysResponse?.data?.data;
  const { sandboxKeys, userKeys } = useMemo(() => {
    const all = apiKeysData || [];
    const sandbox: APIKeyResponse[] = [];
    const user: APIKeyResponse[] = [];
    for (const key of all) {
      if (key.type === 'sandbox') sandbox.push(key);
      else user.push(key);
    }
    return { sandboxKeys: sandbox, userKeys: user };
  }, [apiKeysData]);

  const createMutation = useMutation({
    mutationFn: (request: APIKeyCreateRequest) => apiKeysApi.create(request),
    onSuccess: (response) => {
      if (response.success && response.data?.data) {
        setCreatedApiKey(response.data.data);
        setShowCreatedKey(true);
        setIsCreateDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ['api-keys'] });
        setNewKeyData({ title: '', description: '', expiresInDays: 'never' });
      } else {
        toast.warning(response.error?.message || '创建 API 密钥失败');
      }
    },
    onError: () => toast.warning('创建 API 密钥失败'),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => apiKeysApi.revoke(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.info('API 密钥已撤销');
    },
    onError: () => toast.warning('撤销 API 密钥失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (keyId: string) => apiKeysApi.delete(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.info('API 密钥已删除');
    },
    onError: () => toast.warning('删除 API 密钥失败'),
  });

  const regenerateMutation = useMutation({
    mutationFn: (keyId: string) => apiKeysApi.regenerate(keyId),
    onSuccess: (response) => {
      if (response.success && response.data?.data) {
        setCreatedApiKey(response.data.data);
        setShowCreatedKey(true);
        queryClient.invalidateQueries({ queryKey: ['api-keys'] });
        toast.info('令牌已重新生成');
      } else {
        toast.warning(response.error?.message || '重新生成密钥失败');
      }
    },
    onError: () => toast.warning('重新生成沙箱密钥失败'),
  });

  const [publicUrlResult, setPublicUrlResult] = useState<{ url: string; expiresAt?: string; label?: string } | null>(null);
  const {
    data: publicShares,
    isLoading: isSharesLoading,
    refetch: refetchShares,
  } = useQuery({
    queryKey: ['public-shares', activeSandboxExternalId],
    enabled: !!activeSandboxExternalId,
    queryFn: async (): Promise<PublicShareEntry[]> => {
      const sandboxId = activeSandboxExternalId;
      if (!sandboxId) throw new Error('No active sandbox external id');
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');
      const url = new URL(`${backendBase}/p/share`);
      url.searchParams.set('sandbox_id', sandboxId);
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || (data as any)?.message || 'Failed to load public links');
      return (data as { shares?: PublicShareEntry[] }).shares ?? [];
    },
  });

  const publicUrlMutation = useMutation({
    mutationFn: async () => {
      const sandboxId = activeSandboxExternalId;
      if (!sandboxId) throw new Error('No active sandbox external id');
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${backendBase}/p/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          sandbox_id: sandboxId,
          port: Number(shareForm.port),
          ttl: shareForm.ttl,
          label: shareForm.label.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to generate public URL');
      return data as { url: string; expiresAt?: string; label?: string };
    },
    onSuccess: (data) => {
      setPublicUrlResult(data);
      refetchShares();
      toast.info('公共 URL 已就绪');
    },
    onError: (err: any) => toast.warning(err?.message || '生成公共 URL 失败'),
  });

  const revokeShareMutation = useMutation({
    mutationFn: async (token: string) => {
      const sandboxId = activeSandboxExternalId;
      if (!sandboxId) throw new Error('No active sandbox external id');
      const authToken = await getAuthToken();
      if (!authToken) throw new Error('Not authenticated');
      const url = new URL(`${backendBase}/p/share/${encodeURIComponent(token)}`);
      url.searchParams.set('sandbox_id', sandboxId);
      const res = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to revoke public link');
      }
      return res.json();
    },
    onSuccess: () => {
      refetchShares();
      toast.info('公共链接已撤销');
    },
    onError: (err: any) => toast.warning(err?.message || '撤销公共链接失败'),
  });

  const handleCreateAPIKey = () => {
    if (!activeSandboxId) {
      toast.warning('没有活跃的沙箱，请等待沙箱启动。');
      return;
    }
    createMutation.mutate({
      sandbox_id: activeSandboxId,
      title: newKeyData.title.trim(),
      description: newKeyData.description.trim() || undefined,
      expires_in_days:
        newKeyData.expiresInDays && newKeyData.expiresInDays !== 'never'
          ? parseInt(newKeyData.expiresInDays)
          : undefined,
    });
  };

  const activeSandboxKey = sandboxKeys.find((k) => k.status === 'active');
  const createdKeyDisplayValue = createdApiKey && 'secret_key' in createdApiKey
    ? createdApiKey.secret_key
    : '';

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-4xl px-3 sm:px-4 py-4 sm:py-8">
      <div className="space-y-6 sm:space-y-8">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold">{'API 密钥'}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {'管理用于以编程方式访问沙箱的密钥。'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const base = getActiveOpenCodeUrl().replace(/\/+$/, '');
              const docsUrl = `${base}/docs`;
              const token = await getAuthToken();
              if (token) {
                try {
                  const url = new URL(docsUrl);
                  url.searchParams.set('token', token);
                  window.open(url.toString(), '_blank');
                } catch {
                  const sep = docsUrl.includes('?') ? '&' : '?';
                  window.open(`${docsUrl}${sep}token=${encodeURIComponent(token)}`, '_blank');
                }
              } else {
                window.open(docsUrl, '_blank');
              }
            }}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            {'API 文档'}
          </Button>
        </div>

        {/* ── Sandbox Token ───────────────────────────────────────────── */}
        {!isLoading && activeSandboxKey && (
          <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{'沙箱令牌'}</span>
                  <StatusBadge status={activeSandboxKey.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {'由沙箱内的智能体用于调用平台 API'}
                </p>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  {'重新生成'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{'重新生成沙箱令牌'}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {'这将撤销当前令牌并创建一个新令牌，新令牌将自动应用到沙箱。'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{'取消'}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => regenerateMutation.mutate(activeSandboxKey.key_id)}
                    disabled={regenerateMutation.isPending}
                  >
                    {regenerateMutation.isPending ? '重新生成中...' : '重新生成'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* ── Public Access Links ─────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">{'公共链接'}</h2>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1.5" />
                  {'新建链接'}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>{'创建公共链接'}</DialogTitle>
                  <DialogDescription>
                    {'为沙箱端口生成基于令牌的公共 URL。'}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="share-port" className="text-xs text-muted-foreground">{'端口'}</Label>
                    <Input type="text"
                      id="share-port"
                      inputMode="numeric"
                      value={shareForm.port}
                      onChange={(e) => setShareForm((prev) => ({ ...prev, port: e.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder="8000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="share-ttl" className="text-xs text-muted-foreground">{'过期时间'}</Label>
                    <Select value={shareForm.ttl} onValueChange={(value) => setShareForm((prev) => ({ ...prev, ttl: value }))}>
                      <SelectTrigger id="share-ttl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1h">{'1 小时'}</SelectItem>
                        <SelectItem value="1d">{'1 天'}</SelectItem>
                        <SelectItem value="7d">{'7 天'}</SelectItem>
                        <SelectItem value="30d">{'30 天'}</SelectItem>
                        <SelectItem value="365d">{'1 年'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="share-label" className="text-xs text-muted-foreground">{'标签（可选）'}</Label>
                    <Input type="text"
                      id="share-label"
                      value={shareForm.label}
                      onChange={(e) => setShareForm((prev) => ({ ...prev, label: e.target.value }))}
                      placeholder="e.g. channels-master"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    onClick={() => publicUrlMutation.mutate()}
                    disabled={!activeSandboxExternalId || !shareForm.port || publicUrlMutation.isPending}
                  >
                    {publicUrlMutation.isPending ? '创建中...' : '创建链接'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Created link callout */}
          {publicUrlResult && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">{'链接已创建'}</span>
                </div>
                <CopyButton value={publicUrlResult.url} label={'复制'} />
              </div>
              <Input type="text" value={publicUrlResult.url} readOnly className="font-mono text-xs" />
              {publicUrlResult.expiresAt && (
                <p className="text-[11px] text-muted-foreground">{`过期时间 ${formatDateFull(publicUrlResult.expiresAt)}`}</p>
              )}
            </div>
          )}

          {/* Active links list */}
          <div className="rounded-2xl border bg-card overflow-hidden">
            {!activeSandboxExternalId ? (
              <div className="px-4 py-12 text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">{'没有活跃的沙箱'}</p>
                <p className="text-xs text-muted-foreground">{'管理公共链接需要运行中的沙箱。'}</p>
              </div>
            ) : isSharesLoading ? (
              <div className="divide-y">
                {[1, 2].map((i) => (
                  <div key={i} className="px-4 py-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 bg-muted rounded w-1/4" />
                        <div className="h-3 bg-muted rounded w-1/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !publicShares || publicShares.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <ExternalLink className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium mb-1">{'没有公共链接'}</p>
                <p className="text-xs text-muted-foreground">{'创建链接以公开暴露沙箱端口。'}</p>
              </div>
            ) : (
              <div className="divide-y">
                {publicShares.map((share) => (
                  <div
                    key={share.token}
                    className="px-4 py-3.5 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Port {share.port}</span>
                        {share.label && <Badge variant="secondary" className="text-[11px]">{share.label}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono truncate max-w-[260px]">{share.url.replace(/^https?:\/\//, '')}</span>
                        <span>{`过期时间 ${formatDate(share.expiresAt)}`}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <CopyButton value={share.url} size="icon" />
                      <Button variant="ghost" size="sm" onClick={() => window.open(share.url, '_blank', 'noopener,noreferrer')} className="text-muted-foreground hover:text-foreground">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => revokeShareMutation.mutate(share.token)} disabled={revokeShareMutation.isPending} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── User API Keys ───────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">{'你的密钥'}</h2>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1.5" />
                  {'创建密钥'}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>{'新建 API 密钥'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="title" className="text-xs text-muted-foreground">{'名称'}</Label>
                    <Input type="text"
                      id="title"
                      placeholder={'例如：CI/CD 流水线'}
                      value={newKeyData.title}
                      onChange={(e) => setNewKeyData((prev) => ({ ...prev, title: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newKeyData.title.trim()) handleCreateAPIKey();
                      }}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description" className="text-xs text-muted-foreground">{'描述'}</Label>
                    <Input type="text"
                      id="description"
                      placeholder={'这个密钥用于什么？'}
                      value={newKeyData.description}
                      onChange={(e) => setNewKeyData((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expires" className="text-xs text-muted-foreground">{'过期时间'}</Label>
                    <Select
                      value={newKeyData.expiresInDays}
                      onValueChange={(value) => setNewKeyData((prev) => ({ ...prev, expiresInDays: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={'永不过期'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">{'永不过期'}</SelectItem>
                        <SelectItem value="7">{'7 天'}</SelectItem>
                        <SelectItem value="30">{'30 天'}</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                        <SelectItem value="365">{'1 年'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)}>
                    {'取消'}
                  </Button>
                  <Button
                    onClick={handleCreateAPIKey}
                    disabled={!newKeyData.title.trim() || createMutation.isPending}
                  >
                    {createMutation.isPending ? '创建中...' : '创建'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Keys list */}
          <div className="rounded-2xl border bg-card overflow-hidden">
            {!activeSandboxId ? (
              <div className="px-4 py-12 text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">{'没有活跃的沙箱'}</p>
                <p className="text-xs text-muted-foreground">
                  {'管理 API 密钥需要运行中的沙箱。'}
                </p>
              </div>
            ) : isLoading ? (
              <div className="divide-y">
                {[1, 2].map((i) => (
                  <div key={i} className="px-4 py-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 bg-muted rounded w-1/4" />
                        <div className="h-3 bg-muted rounded w-1/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error || (apiKeysResponse && !apiKeysResponse.success) ? (
              <div className="px-4 py-12 text-center space-y-3">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-muted-foreground text-sm">
                  {(error as Error)?.message || apiKeysResponse?.error?.message || '加载 API 密钥失败。'}
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  {'重试'}
                </Button>
              </div>
            ) : userKeys.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <Key className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium mb-1">{'没有 API 密钥'}</p>
                <p className="text-xs text-muted-foreground mb-4">
                  {'创建密钥以编程方式访问你的沙箱。'}
                </p>
                <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  {'创建密钥'}
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {userKeys.map((apiKey: APIKeyResponse) => (
                  <div
                    key={apiKey.key_id}
                    className={cn('px-4 py-3.5 flex items-center gap-3', 
                      isKeyExpired(apiKey.expires_at) ? 'bg-yellow-500/5' : ''
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Key className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{apiKey.title}</span>
                        <StatusBadge status={apiKey.status} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span>{`创建于 ${formatDate(apiKey.created_at)}`}</span>
                        {apiKey.expires_at && (
                          <span className={isKeyExpired(apiKey.expires_at) ? 'text-yellow-600 dark:text-yellow-400' : ''}>
                            {isKeyExpired(apiKey.expires_at) ? `已过期 ${formatDate(apiKey.expires_at)}` : `过期于 ${formatDate(apiKey.expires_at)}`}
                          </span>
                        )}
                        {apiKey.last_used_at && (
                          <span>{`最后使用 ${formatDate(apiKey.last_used_at)}`}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0">
                      {apiKey.status === 'active' ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{`撤销 "${apiKey.title}"`}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {'这将立即使密钥失效，使用该密钥的所有应用将停止工作。'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{'取消'}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => revokeMutation.mutate(apiKey.key_id)}
                                className="bg-destructive hover:bg-destructive/90 text-white"
                              >
                                {'撤销'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{`删除 "${apiKey.title}"`}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {'这将永久删除该密钥，此操作无法撤销。'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{'取消'}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(apiKey.key_id)}
                                className="bg-destructive hover:bg-destructive/90 text-white"
                              >
                                {'删除'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Usage hint ──────────────────────────────────────────────── */}
        <div className="rounded-2xl border bg-card px-4 py-3">
          <div className="flex items-start gap-3">
            <Shield className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                {'将密钥作为 Bearer 令牌传递：Authorization: Bearer kortix_...'}
              </p>
              <p>
                {'密钥在服务器端经过哈希处理，从不以明文存储。密钥仅在创建时显示一次。'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Created Key Dialog ──────────────────────────────────────────── */}
      <Dialog open={showCreatedKey} onOpenChange={setShowCreatedKey}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {createdApiKey?.type === 'sandbox' ? '令牌已重新生成' : '密钥已创建'}
            </DialogTitle>
            <DialogDescription>
              {createdApiKey?.type === 'sandbox'
                ? '新令牌已应用到你的沙箱。'
                : '请立即复制你的密钥，关闭此对话框后将无法再次查看。'}
            </DialogDescription>
          </DialogHeader>

          {createdApiKey && 'secret_key' in createdApiKey && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{createdApiKey.type === 'sandbox' ? '沙箱令牌' : '密钥'}</Label>
                <div className="flex gap-2">
                  <Input type="text"
                    value={createdKeyDisplayValue}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <CopyButton value={createdKeyDisplayValue} label={'复制'} />
                </div>
              </div>

              <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-3 py-2.5">
                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                  {'请安全存储此密钥，关闭此对话框后将无法找回。'}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button onClick={() => setShowCreatedKey(false)}>{'完成'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
