'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminSandboxes, useDeleteAdminSandbox } from '@/hooks/admin/use-admin-sandboxes';
import type { AdminSandbox } from '@/hooks/admin/use-admin-sandboxes';
import { useAdminRole } from '@/hooks/admin/use-admin-role';
import {
  useSandboxPoolHealth,
  useSandboxPoolList,
  useSandboxPoolReplenish,
  useSandboxPoolForceCreate,
  useSandboxPoolCleanup,
  useCreatePoolResource,
} from '@/hooks/admin/use-sandbox-pool';
import { toast } from '@/lib/toast';
import {
  Server, ShieldCheck, Trash2, RefreshCw, Search,
  ChevronLeft, ChevronRight, Database, Plus, Minus,
  CheckCircle, AlertTriangle, XCircle, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useServerTypes } from '@/hooks/instance/use-server-types';
import { INSTANCE_CONFIG } from '@/components/instance/config';
import { RegionToggle } from '@/components/instance/globe-region-picker';
import { SizePickerSkeleton, formatMemory, formatDisk, getSizeLabel } from '@/components/instance/size-picker';

const PAGE_SIZE = 50;

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">unknown</Badge>;
  switch (status.toLowerCase()) {
    case 'active':
    case 'running':
      return <Badge variant="highlight">{status}</Badge>;
    case 'pooled':
      return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 gap-1">{status}</Badge>;
    case 'provisioning':
      return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 gap-1">{status}</Badge>;
    case 'stopped':
    case 'paused':
    case 'archived':
      return <Badge variant="secondary">{status}</Badge>;
    case 'error':
    case 'failed':
      return <Badge variant="destructive">{status}</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-foreground/[0.06] last:border-0">
      <span className="text-muted-foreground text-sm shrink-0">{label}</span>
      <span className="text-sm font-mono text-right break-all">{value ?? '\u2014'}</span>
    </div>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function PoolHealthBadge({ status }: { status: string }) {
  switch (status) {
    case 'healthy':
      return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1 px-2.5 py-0.5"><CheckCircle className="w-3 h-3" /> Healthy</Badge>;
    case 'warning':
      return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 gap-1 px-2.5 py-0.5"><AlertTriangle className="w-3 h-3" /> Warning</Badge>;
    case 'critical':
      return <Badge className="bg-red-500/10 text-red-400 border-red-500/30 gap-1 px-2.5 py-0.5"><XCircle className="w-3 h-3" /> Critical</Badge>;
    default:
      return <Badge variant="secondary" className="gap-1 px-2.5 py-0.5">Disabled</Badge>;
  }
}

// ─── Sandboxes Tab ───────────────────────────────────────────────────────────

function SandboxesTab() {
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounce(searchInput, 350);

  useEffect(() => { setPage(1); }, [search, statusFilter, providerFilter]);

  const { data, isLoading, isFetching, refetch } = useAdminSandboxes({
    search, status: statusFilter, provider: providerFilter, page, limit: PAGE_SIZE,
  });

  const deleteMutation = useDeleteAdminSandbox();
  const [infoDialog, setInfoDialog] = useState<AdminSandbox | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminSandbox | null>(null);

  const list  = data?.sandboxes ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.sandboxId);
      toast.success(`Deleted sandbox ${confirmDelete.sandboxId.slice(0, 8)}`, {
        description: confirmDelete.provider === 'justavps'
          ? 'Removed from DB and JustaVPS machine deleted.'
          : 'Removed from DB.',
      });
      setInfoDialog(null);
    } catch (err: any) {
      toast.error('Failed to delete sandbox', { description: err.message });
    }
    setConfirmDelete(null);
  }, [confirmDelete, deleteMutation]);

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search by sandbox ID, name, account, email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 w-[130px] text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pooled">Pooled</SelectItem>
            <SelectItem value="provisioning">Provisioning</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={providerFilter || 'all'} onValueChange={(v) => setProviderFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 w-[130px] text-sm"><SelectValue placeholder="Provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="justavps">JustAVPS</SelectItem>
            <SelectItem value="daytona">Daytona</SelectItem>
            <SelectItem value="local_docker">Local</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8 gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching ? 'animate-spin' : '')} />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : list.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-foreground/[0.08] rounded-xl">
          <Server className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No sandboxes match your filters</p>
        </div>
      ) : (
        <div className={cn('border border-foreground/[0.08] rounded-xl overflow-hidden transition-opacity', isFetching ? 'opacity-60' : '')}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[90px]">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Account / Email</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((sandbox) => (
                <TableRow key={sandbox.sandboxId} className="group cursor-pointer" onClick={() => setInfoDialog(sandbox)}>
                  <TableCell className="font-mono text-xs text-muted-foreground" title={sandbox.sandboxId}>{sandbox.sandboxId.slice(0, 8)}</TableCell>
                  <TableCell className="text-sm max-w-[140px] truncate" title={sandbox.name ?? undefined}>{sandbox.name ?? <span className="text-muted-foreground">&mdash;</span>}</TableCell>
                  <TableCell>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm truncate">{sandbox.accountName ?? '\u2014'}</span>
                      {sandbox.ownerEmail && <span className="text-xs text-muted-foreground truncate">{sandbox.ownerEmail}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm capitalize">{sandbox.provider ?? <span className="text-muted-foreground">&mdash;</span>}</TableCell>
                  <TableCell><StatusBadge status={sandbox.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(sandbox.createdAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(sandbox.lastUsedAt)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-500 hover:bg-red-500/10" onClick={() => setConfirmDelete(sandbox)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages} &mdash; {total.toLocaleString()} results</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={page === 1} title="First page">&laquo;</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 gap-1" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="h-3.5 w-3.5" /> Prev</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 gap-1" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(pages)} disabled={page === pages} title="Last page">&raquo;</Button>
          </div>
        </div>
      )}

      <Dialog open={!!infoDialog} onOpenChange={() => setInfoDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{infoDialog?.sandboxId}</DialogTitle>
            <DialogDescription>Full sandbox details</DialogDescription>
          </DialogHeader>
          {infoDialog && (
            <div className="space-y-0.5 max-h-[60vh] overflow-y-auto pr-1">
              <InfoRow label="Name" value={infoDialog.name} />
              <InfoRow label="Account" value={infoDialog.accountName} />
              <InfoRow label="Email" value={infoDialog.ownerEmail} />
              <InfoRow label="Account ID" value={infoDialog.accountId} />
              <InfoRow label="Provider" value={infoDialog.provider} />
              <InfoRow label="Status" value={<StatusBadge status={infoDialog.status} />} />
              <InfoRow label="External ID" value={infoDialog.externalId} />
              <InfoRow label="Base URL" value={infoDialog.baseUrl} />
              <InfoRow label="Created" value={formatDate(infoDialog.createdAt)} />
              <InfoRow label="Updated" value={formatDate(infoDialog.updatedAt)} />
              <InfoRow label="Last Used" value={formatDate(infoDialog.lastUsedAt)} />
              {!!infoDialog.metadata && (
                <div className="pt-2">
                  <p className="text-muted-foreground text-xs mb-1">Metadata</p>
                  <pre className="text-xs bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg p-3 overflow-auto max-h-40">{JSON.stringify(infoDialog.metadata as Record<string, unknown>, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(infoDialog)} disabled={deleteMutation.isPending}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete</Button>
            <Button variant="outline" onClick={() => setInfoDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Sandbox</DialogTitle>
            <DialogDescription>
              Permanently delete <span className="font-mono text-foreground">{confirmDelete?.sandboxId.slice(0, 8)}</span>
              {confirmDelete?.provider === 'justavps' && ' and terminate the JustaVPS machine'}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {confirmDelete && (
            <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span>{confirmDelete.accountName ?? '\u2014'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span className="capitalize">{confirmDelete.provider ?? '\u2014'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{confirmDelete.status ?? '\u2014'}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleteMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? 'Deleting\u2026' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Pool Tab ────────────────────────────────────────────────────────────────

function PoolTab() {
  const [replenishOpen, setReplenishOpen] = useState(false);
  const [location, setLocation] = useState<string>(INSTANCE_CONFIG.fallbackRegion);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: health } = useSandboxPoolHealth();
  const { data: poolList, isLoading: poolLoading } = useSandboxPoolList(50);
  const { data: serverTypesData, isLoading: typesLoading } = useServerTypes(location);

  const serverTypes = serverTypesData?.serverTypes ?? [];

  const forceCreateMutation = useSandboxPoolForceCreate();
  const cleanupMutation = useSandboxPoolCleanup();
  const createResourceMutation = useCreatePoolResource();

  const totalToCreate = Object.values(quantities).reduce((sum, n) => sum + n, 0);

  const updateQuantity = (name: string, delta: number) => {
    setQuantities((prev) => {
      const current = prev[name] || 0;
      const next = Math.max(0, Math.min(20, current + delta));
      if (next === 0) {
        const { [name]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [name]: next };
    });
  };

  const handleReplenish = () => {
    const entries = Object.entries(quantities).filter(([, count]) => count > 0);
    if (entries.length === 0) return;

    const totalRequested = entries.reduce((sum, [, count]) => sum + count, 0);

    setReplenishOpen(false);
    setQuantities({});

    toast.success(`Provisioning ${totalRequested} pool ${totalRequested === 1 ? 'sandbox' : 'sandboxes'}`, {
      description: 'They will appear in the pool once ready.',
    });

    (async () => {
      for (const [serverType, count] of entries) {
        try {
          const res = await createResourceMutation.mutateAsync({
            provider: 'justavps',
            server_type: serverType,
            location,
            desired_count: count,
          });

          await forceCreateMutation.mutateAsync({ count, resource_id: res.resource.id });
        } catch (err) {
          toast.error(`Failed to create ${serverType} sandboxes`);
        }
      }
    })();
  };

  const handleCleanup = () => {
    cleanupMutation.mutate(undefined, {
      onSuccess: (data) => toast.success(`Cleaned up ${data.cleaned_count} stale sandboxes`),
      onError: () => toast.error('Failed to cleanup'),
    });
  };

  const isCreating = forceCreateMutation.isPending || createResourceMutation.isPending;

  return (
    <>
      {health?.issues && health.issues.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            {health.issues.map((issue, i) => (
              <p key={i} className="text-sm text-muted-foreground">{issue}</p>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => setReplenishOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add to Pool
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCleanup} disabled={cleanupMutation.isPending}>
          {cleanupMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Cleanup Stale
        </Button>
      </div>

      {/* Pooled Sandboxes List */}
      {poolLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !poolList?.sandboxes?.length ? (
        <div className="text-center py-16 text-muted-foreground border border-foreground/[0.08] rounded-xl">
          <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No sandboxes in pool</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Click &ldquo;Add to Pool&rdquo; to pre-provision machines</p>
        </div>
      ) : (
        <div className="border border-foreground/[0.08] rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[60px]">#</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead>Server Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pooled At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {poolList.sandboxes.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.external_id?.slice(0, 8) ?? '\u2014'}</TableCell>
                  <TableCell className="text-sm font-mono">{(s as any).server_type ?? '\u2014'}</TableCell>
                  <TableCell className="text-sm">{(s as any).location ?? '\u2014'}</TableCell>
                  <TableCell><StatusBadge status={s.status ?? 'pooled'} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.pooled_at ? formatDate(s.pooled_at) : 'Provisioning\u2026'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Replenish Dialog */}
      <Dialog open={replenishOpen} onOpenChange={(open) => { setReplenishOpen(open); if (!open) setQuantities({}); }}>
        <DialogContent className="w-lg max-w-lg">
          <DialogHeader>
            <DialogTitle>Add to Pool</DialogTitle>
            <DialogDescription>Choose machine sizes to pre-provision</DialogDescription>
          </DialogHeader>

          {/* Region Toggle */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Region</p>
            <RegionToggle location={location} onLocationChange={setLocation} />
          </div>

          {/* Server Types with quantity counters */}
          <div className="max-h-[400px] overflow-y-auto -mx-1 px-1">
            {typesLoading ? (
              <SizePickerSkeleton count={4} />
            ) : (
              <div className="grid grid-cols-1 gap-1.5">
                {serverTypes.map((t) => {
                  const qty = quantities[t.name] || 0;
                  return (
                    <div
                      key={t.name}
                      className={cn(
                        'flex items-center gap-3.5 w-full px-3 py-2.5 rounded-xl border text-left transition-colors',
                        qty > 0
                          ? 'border-foreground/20 bg-foreground/[0.04] shadow-sm'
                          : 'border-border/40',
                      )}
                    >
                      <div className={cn(
                        'shrink-0 w-11 h-11 rounded-lg border flex flex-col items-center justify-center',
                        qty > 0 ? 'bg-foreground text-background' : 'bg-muted/60 text-foreground/70',
                      )}>
                        <span className="text-[15px] font-bold tabular-nums leading-none">{t.cores}</span>
                        <span className="text-[8px] font-medium opacity-60 mt-0.5">vCPU</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-semibold text-foreground">{getSizeLabel(t.cores)}</span>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground/60">
                          <span>{formatMemory(t.memory)} RAM</span>
                          <span className="text-muted-foreground/20">{'\u00B7'}</span>
                          <span>{formatDisk(t.disk)} SSD</span>
                        </div>
                      </div>

                      {/* Quantity counter */}
                      <div className="shrink-0 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateQuantity(t.name, -1)}
                          disabled={qty === 0}
                          className={cn(
                            'w-8 h-8 rounded-full border flex items-center justify-center transition-colors',
                            qty === 0
                              ? 'border-border/30 text-muted-foreground/30 cursor-not-allowed'
                              : 'border-border hover:bg-muted cursor-pointer',
                          )}
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-sm font-semibold tabular-nums">{qty}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(t.name, 1)}
                          disabled={qty >= 20}
                          className={cn(
                            'w-8 h-8 rounded-full border flex items-center justify-center transition-colors',
                            qty >= 20
                              ? 'border-border/30 text-muted-foreground/30 cursor-not-allowed'
                              : 'border-border hover:bg-muted cursor-pointer',
                          )}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReplenishOpen(false)}>Cancel</Button>
            <Button onClick={handleReplenish} disabled={totalToCreate === 0 || isCreating}>
              {isCreating ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Creating...</>
              ) : (
                <>Create {totalToCreate} {totalToCreate === 1 ? 'sandbox' : 'sandboxes'}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminSandboxesPage() {
  const { data: adminRole, isLoading: roleLoading } = useAdminRole();
  const [activeTab, setActiveTab] = useState<string>('sandboxes');
  const { data: health } = useSandboxPoolHealth();
  const { data: poolList } = useSandboxPoolList(50);

  if (roleLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto p-6">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72 mb-8" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!adminRole?.isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <ShieldCheck className="h-12 w-12 text-muted-foreground/40 mx-auto" />
          <h2 className="text-lg font-medium text-foreground/80">Admin access required</h2>
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Server className="h-6 w-6" />
              Sandboxes
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage all sandboxes and the warm pool
            </p>
          </div>
          <div className="flex gap-3">
            <div className="bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-4 py-2 text-center min-w-[80px]">
              <p className="text-lg font-semibold text-blue-400">{poolList?.count ?? 0}</p>
              <p className="text-[11px] text-muted-foreground">Pooled</p>
            </div>
            {health && (
              <div className="flex items-center">
                <PoolHealthBadge status={health.status} />
              </div>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="sandboxes" className="gap-1.5">
              <Server className="h-3.5 w-3.5" />
              All Sandboxes
            </TabsTrigger>
            <TabsTrigger value="pool" className="gap-1.5">
              <Database className="h-3.5 w-3.5" />
              Pool
              {(poolList?.count ?? 0) > 0 && (
                <span className="ml-1 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full font-medium">
                  {poolList?.count}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === 'sandboxes' ? <SandboxesTab /> : <PoolTab />}
      </div>
    </div>
  );
}
