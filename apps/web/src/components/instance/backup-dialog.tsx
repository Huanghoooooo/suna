'use client';

import * as React from 'react';
import { useState } from 'react';
import {
  Archive,
  Plus,
  RotateCcw,
  Trash2,
  Loader2,
  HardDrive,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useBackups } from '@/hooks/instance/use-backups';
import { toast as sonnerToast } from 'sonner';
import { cn } from '@/lib/utils';

interface BackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sandboxId: string | undefined;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BackupDialog({ open, onOpenChange, sandboxId }: BackupDialogProps) {
  const {
    backups,
    backupsEnabled,
    isLoading,
    create,
    restore,
    remove,
  } = useBackups(sandboxId);

  const [description, setDescription] = useState('');
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function handleCreate() {
    try {
      await create.mutateAsync(description || undefined);
      setDescription('');
      sonnerToast.success('Backup started');
    } catch (err: any) {
      sonnerToast.error(err?.message || 'Failed to create backup');
    }
  }

  async function handleRestore(backupId: string) {
    setConfirmRestore(null);
    try {
      await restore.mutateAsync(backupId);
      sonnerToast.success('Restore initiated. Your machine will reboot with the backup data.');
    } catch (err: any) {
      sonnerToast.error(err?.message || 'Failed to restore backup');
    }
  }

  async function handleDelete(backupId: string) {
    setConfirmDelete(null);
    try {
      await remove.mutateAsync(backupId);
      sonnerToast.success('Backup deleted');
    } catch (err: any) {
      sonnerToast.error(err?.message || 'Failed to delete backup');
    }
  }

  const restoreTarget = backups.find((b) => b.id === confirmRestore);
  const deleteTarget = backups.find((b) => b.id === confirmDelete);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="p-0 gap-0 overflow-hidden flex flex-col max-h-[88vh] w-[min(92vw,520px)] sm:max-w-lg"
          aria-describedby="backup-dialog-desc"
        >
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Archive className="h-4 w-4 text-muted-foreground" />
              Backups
            </DialogTitle>
            <DialogDescription id="backup-dialog-desc" className="text-xs">
              {backupsEnabled
                ? 'Automatic daily backups are enabled. You can also create manual backups.'
                : 'Manage your instance backups.'}
            </DialogDescription>
          </DialogHeader>

          {/* Create backup */}
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Backup description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !create.isPending && handleCreate()}
                className="flex-1 h-9 text-xs px-3 rounded-lg bg-muted/40 border border-border/40 outline-none placeholder:text-muted-foreground/40 focus:border-primary/30 focus:bg-muted/60 transition-colors"
              />
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={create.isPending}
                className="gap-1.5 "
              >
                {create.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Backup Now
              </Button>
            </div>
          </div>

          {/* Backup list */}
          <div className="flex-1 overflow-y-auto px-3 pb-3 max-h-[400px]">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && backups.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-muted/50">
                  <HardDrive className="h-6 w-6 text-muted-foreground/40" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground/80">No backups yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {backupsEnabled
                      ? 'Your first automatic backup will appear here soon.'
                      : 'Create a manual backup to get started.'}
                  </p>
                </div>
              </div>
            )}

            {!isLoading && backups.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {backups.map((backup) => (
                  <div
                    key={backup.id}
                    className="rounded-lg border border-border/40 bg-card px-3.5 py-3 group hover:border-border/60 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">
                          {backup.description || `Backup ${backup.id}`}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
                            <Clock className="h-3 w-3" />
                            <span title={formatFullDate(backup.created)}>
                              {formatDate(backup.created)}
                            </span>
                          </span>
                          {backup.size > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
                              <HardDrive className="h-3 w-3" />
                              {formatBytes(backup.size * 1024 * 1024 * 1024)}
                            </span>
                          )}
                          <span
                            className={cn(
                              'text-[10px] font-medium px-1.5 py-px rounded-full',
                              backup.status === 'available'
                                ? 'text-emerald-500/80 bg-emerald-500/10'
                                : 'text-amber-500/80 bg-amber-500/10',
                            )}
                          >
                            {backup.status}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => setConfirmRestore(backup.id)}
                          disabled={restore.isPending || backup.status !== 'available'}
                          title="Restore from this backup"
                          className="flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {restore.isPending && restore.variables === backup.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(backup.id)}
                          disabled={remove.isPending}
                          title="Delete this backup"
                          className="flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {remove.isPending && remove.variables === backup.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {backupsEnabled && backups.length > 0 && (
            <div className="border-t border-border/40 px-5 py-3">
              <p className="text-[11px] text-muted-foreground/50">
                Automatic daily backups are enabled. Up to the latest backups are retained by the provider.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Restore confirmation */}
      <AlertDialog open={!!confirmRestore} onOpenChange={() => setConfirmRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Restore from Backup
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will rebuild your machine from the backup
              {restoreTarget ? ` "${restoreTarget.description || `Backup ${restoreTarget.id}`}"` : ''}.
              <span className="block mt-2 font-medium text-foreground/80">
                All current data will be replaced with the backup contents. This cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRestore && handleRestore(confirmRestore)}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete
              {deleteTarget ? ` "${deleteTarget.description || `Backup ${deleteTarget.id}`}"` : ' this backup'}?
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
