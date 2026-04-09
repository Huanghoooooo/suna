'use client';

/**
 * New Task dialog — sleek modal with Kortix aesthetics.
 */

import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  Loader2,
  X,
  Paperclip,
  FolderGit2,
} from 'lucide-react';
import { useCreateKortixTask } from '@/hooks/kortix/use-kortix-tasks';
import type { KortixTaskStatus } from '@/hooks/kortix/use-kortix-tasks';
import { StatusPill } from '@/components/kortix/task-pills';
import { toast } from '@/lib/toast';

export function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  defaultStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName?: string;
  defaultStatus?: KortixTaskStatus;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [verification, setVerification] = useState('');
  const [showVerification, setShowVerification] = useState(false);
  const [status, setStatus] = useState<KortixTaskStatus>(defaultStatus || 'todo');
  const [createMore, setCreateMore] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const create = useCreateKortixTask();

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setVerification('');
      setShowVerification(false);
      setStatus(defaultStatus || 'todo');
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open, defaultStatus]);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    create.mutate(
      {
        project_id: projectId,
        title: t,
        description: description.trim(),
        verification_condition: verification.trim(),
        status,
      },
      {
        onSuccess: () => {
          toast(`Task created${createMore ? ' — ready for next' : ''}`, {
            description: t,
          });
          if (createMore) {
            setTitle('');
            setDescription('');
            setVerification('');
            setShowVerification(false);
            setTimeout(() => titleRef.current?.focus(), 0);
          } else {
            onOpenChange(false);
          }
        },
        onError: () => {
          toast('Failed to create task', {
            description: 'Something went wrong. Please try again.',
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="sm:max-w-[680px] p-0 overflow-visible gap-0 rounded-2xl border-border shadow-2xl"
      >
        <DialogTitle className="sr-only">New task</DialogTitle>
        <DialogDescription className="sr-only">
          Create a new task {projectName ? `in ${projectName}` : ''}
        </DialogDescription>

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 text-sm">
            <div className="h-6 w-6 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <FolderGit2 className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="font-semibold text-foreground tracking-tight">
              {projectName || 'KORTIX'}
            </span>
            <span className="text-muted-foreground/40">›</span>
            <span className="text-muted-foreground">New task</span>
          </div>

          <div className="ml-auto">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
              onClick={() => onOpenChange(false)}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Content ────────────────────────────────────────── */}
        <div className="px-5 pt-2 pb-4 space-y-3">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Task title"
            className="w-full text-[22px] font-semibold bg-transparent border-0 outline-none placeholder:text-muted-foreground/35 text-foreground tracking-tight leading-tight"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add description…"
            rows={5}
            className="w-full text-sm bg-transparent border-0 outline-none resize-none placeholder:text-muted-foreground/35 text-foreground/90 leading-relaxed min-h-[100px]"
          />

          {/* Verification condition (collapsible) */}
          {showVerification ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/50 font-semibold">
                  Verification condition
                </span>
                <button
                  onClick={() => {
                    setShowVerification(false);
                    setVerification('');
                  }}
                  className="text-[11px] text-muted-foreground/40 hover:text-foreground cursor-pointer"
                >
                  Remove
                </button>
              </div>
              <textarea
                value={verification}
                onChange={(e) => setVerification(e.target.value)}
                placeholder="How will we know this task is actually done?"
                rows={2}
                className="w-full text-sm bg-transparent border-0 outline-none resize-none placeholder:text-muted-foreground/35 text-foreground/90 leading-relaxed"
              />
            </div>
          ) : (
            <button
              onClick={() => setShowVerification(true)}
              className="text-[11px] text-muted-foreground/40 hover:text-foreground font-medium transition-colors cursor-pointer"
            >
              + Add verification condition
            </button>
          )}
        </div>

        {/* ── Property pills row ─────────────────────────────── */}
        <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
          <StatusPill status={status} onChange={setStatus} contentClassName="z-[10000]" />

          {projectName && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1.5 font-medium cursor-default"
            >
              <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground/70" />
              <span className="truncate max-w-[140px]">{projectName}</span>
            </Button>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="border-t border-border px-5 py-3 flex items-center justify-between bg-muted/15 rounded-b-2xl">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground/60 hover:text-foreground"
            title="Attach"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <Switch checked={createMore} onCheckedChange={setCreateMore} />
              Create more
            </label>
            <Button
              size="sm"
              onClick={submit}
              disabled={!title.trim() || create.isPending}
              className="h-8 px-4"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create task
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
