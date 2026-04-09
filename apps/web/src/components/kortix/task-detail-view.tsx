'use client';

/**
 * TaskDetailView — single-column task page.
 * No comment system — the session IS the activity. Click through to it.
 */

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import {
  CircleDashed,
  Play,
  CheckCircle2,
  AlertOctagon,
  ArrowLeft,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UnifiedMarkdown } from '@/components/markdown';
import {
  useKortixTask,
  useUpdateKortixTask,
  useStartKortixTask,
  useApproveKortixTask,
  useDeleteKortixTask,
} from '@/hooks/kortix/use-kortix-tasks';
import { useKortixProject } from '@/hooks/kortix/use-kortix-projects';
import { openTabAndNavigate } from '@/stores/tab-store';
import { StatusPill } from '@/components/kortix/task-pills';
import {
  shortTaskId,
  relativeTime,
  fullDate,
} from '@/lib/kortix/task-meta';

export interface TaskDetailViewProps {
  taskId: string;
  onClose?: () => void;
  embedded?: boolean;
  projectName?: string;
}

export function TaskDetailView({
  taskId,
  onClose,
  embedded,
  projectName: projectNameOverride,
}: TaskDetailViewProps) {
  const { data: task, isLoading } = useKortixTask(taskId);
  const { data: project } = useKortixProject(task?.project_id || '');
  const updateTask = useUpdateKortixTask();
  const startTask = useStartKortixTask();
  const approveTask = useApproveKortixTask();
  const deleteTaskMutation = useDeleteKortixTask();

  const [titleVal, setTitleVal] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [descVal, setDescVal] = useState('');
  const [verVal, setVerVal] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (task) {
      setTitleVal(task.title);
      setDescVal(task.description || '');
      setVerVal(task.verification_condition || '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.title, task?.description, task?.verification_condition]);

  const goToWorkspace = useCallback(() => {
    openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' });
  }, []);

  const goToProject = useCallback(() => {
    if (onClose) { onClose(); return; }
    if (!project) return;
    openTabAndNavigate({
      id: `project:${project.id}`, title: project.name, type: 'project',
      href: `/projects/${encodeURIComponent(project.id)}`,
    });
  }, [project, onClose]);

  const openSession = useCallback(() => {
    if (!task?.owner_session_id) return;
    openTabAndNavigate({
      id: task.owner_session_id,
      title: task.title || 'Worker session',
      type: 'session',
      href: `/sessions/${task.owner_session_id}`,
    });
  }, [task?.owner_session_id, task?.title]);

  if (isLoading && !task) return <TaskSkeleton />;
  if (!task)
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3">
        <CircleDashed className="h-12 w-12 text-muted-foreground/10" />
        <p className="text-sm font-medium text-muted-foreground/40">Task not found</p>
        <Button variant="ghost" size="sm" onClick={goToWorkspace}>Back to Workspace</Button>
      </div>
    );

  const projectName = projectNameOverride || project?.name;

  const saveTitle = () => {
    const v = titleVal.trim();
    if (v && v !== task.title) updateTask.mutate({ id: task.id, title: v });
    setEditingTitle(false);
  };
  const commitDesc = () => {
    const v = descVal.trim();
    if (v !== (task.description || '')) updateTask.mutate({ id: task.id, description: v });
  };
  const commitVer = () => {
    const v = verVal.trim();
    if (v !== (task.verification_condition || '')) updateTask.mutate({ id: task.id, verification_condition: v });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          {/* Back + ID + Delete */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={embedded ? onClose : goToProject}
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3 w-3" />
              {embedded ? 'Back' : (projectName || 'Back')}
            </button>
            <span className="text-[11px] font-mono text-muted-foreground/25">
              {shortTaskId(task.id)}
            </span>
            <div className="ml-auto">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground/30 hover:text-foreground"
                title="Delete task"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Title */}
          <div className="mb-5">
            {editingTitle ? (
              <input
                autoFocus
                value={titleVal}
                onChange={(e) => setTitleVal(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setTitleVal(task.title); setEditingTitle(false); }
                  if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
                }}
                className="w-full text-[20px] font-semibold bg-transparent border-0 outline-none text-foreground tracking-tight"
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="block w-full text-left text-[20px] font-semibold text-foreground tracking-tight hover:text-foreground/80 transition-colors cursor-text"
              >
                {task.title}
              </button>
            )}
          </div>

          {/* Properties + Actions */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-5 mb-5 border-b border-border/40">
            <PropInline label="Status">
              <StatusPill status={task.status} onChange={() => {}} variant="pill" className="pointer-events-none" />
            </PropInline>
            {task.status === 'todo' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px] gap-1.5"
                onClick={() => startTask.mutate({ id: task.id })}
              >
                <Play className="h-3 w-3" />
                Start task
              </Button>
            )}
            {task.status === 'in_review' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px] gap-1.5"
                onClick={() => approveTask.mutate(task.id)}
              >
                <CheckCircle2 className="h-3 w-3" />
                Approve
              </Button>
            )}
            {projectName && (
              <PropInline label="Project">
                <button onClick={goToProject} className="text-[13px] text-foreground/80 hover:text-foreground transition-colors cursor-pointer">
                  {projectName}
                </button>
              </PropInline>
            )}
            <PropInline label="Updated">
              <span className="text-[13px] text-muted-foreground/50" title={fullDate(task.updated_at)}>
                {relativeTime(task.updated_at)}
              </span>
            </PropInline>
          </div>

          {/* Session link — prominent when task has an owner */}
          {task.owner_session_id && (
            <div className="mb-5">
              <button
                onClick={openSession}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-card hover:border-border hover:bg-muted/30 transition-colors cursor-pointer group"
              >
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <ExternalLink className="h-4 w-4 text-primary/70" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[13px] font-medium text-foreground/90 group-hover:text-foreground">
                    Worker session
                  </p>
                  <p className="text-[11px] text-muted-foreground/40 font-mono truncate">
                    {task.owner_session_id}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground/30 group-hover:text-foreground/60 shrink-0">
                  Open →
                </span>
              </button>
            </div>
          )}

          {/* Description */}
          <div className="mb-5">
            <SectionLabel>Description</SectionLabel>
            <InlineMarkdownEditor
              value={descVal}
              onChange={setDescVal}
              onCommit={commitDesc}
              placeholder="Add a description…"
            />
          </div>

          {/* Verification condition */}
          <div className="mb-5">
            <SectionLabel>Verification condition</SectionLabel>
            <InlineMarkdownEditor
              value={verVal}
              onChange={setVerVal}
              onCommit={commitVer}
              placeholder="How will we know this task is actually done?"
            />
          </div>

          {/* Result */}
          {task.result && (
            <div className="mb-5">
              <SectionLabel>Result</SectionLabel>
              <div className="text-sm text-foreground/85 bg-muted/20 border border-border/60 rounded-xl p-4 overflow-x-auto">
                <UnifiedMarkdown content={task.result} />
              </div>
            </div>
          )}

          {/* Verification summary */}
          {task.verification_summary && (
            <div className="mb-5">
              <SectionLabel>Verification summary</SectionLabel>
              <div className="text-sm text-foreground/85 bg-emerald-500/[0.04] border border-emerald-500/20 rounded-xl p-4 overflow-x-auto">
                <UnifiedMarkdown content={task.verification_summary} />
              </div>
            </div>
          )}

          {/* Blocking question */}
          {task.blocking_question && (
            <div className="mb-5">
              <SectionLabel>Blocking question</SectionLabel>
              <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3">
                <AlertOctagon className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-[13px] text-foreground/85 leading-relaxed min-w-0 flex-1">
                  <UnifiedMarkdown content={task.blocking_question} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete task"
        description={<>Are you sure you want to delete <span className="font-semibold text-foreground">&quot;{task.title}&quot;</span>? This action cannot be undone.</>}
        confirmLabel="Delete"
        onConfirm={() => deleteTaskMutation.mutate(task.id, { onSuccess: () => { setDeleteOpen(false); goToProject(); } })}
        isPending={deleteTaskMutation.isPending}
      />
    </div>
  );
}

/**
 * Inline markdown editor — shows rendered markdown by default,
 * switches to a textarea on click. Commits on blur, reverts on Escape.
 */
function InlineMarkdownEditor({
  value,
  onChange,
  onCommit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastCommittedRef = useRef(value);

  useEffect(() => { lastCommittedRef.current = value; }, [value]);

  // Auto-grow textarea
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <div>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            lastCommittedRef.current = value;
            onCommit();
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onChange(lastCommittedRef.current);
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          rows={3}
          spellCheck
          className={cn(
            'w-full resize-none overflow-hidden',
            'bg-muted/10 border border-border/40 rounded-lg outline-none',
            'text-[14px] text-foreground/85 leading-[1.7] tracking-normal',
            'placeholder:text-muted-foreground/40 placeholder:italic',
            'focus:border-border/60 focus:ring-0 transition-colors',
            'px-3 py-2',
          )}
        />
        <p className="text-[11px] text-muted-foreground/30 mt-1">Markdown supported &middot; Esc to cancel</p>
      </div>
    );
  }

  if (!value) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left text-[14px] text-muted-foreground/40 italic hover:text-muted-foreground/60 transition-colors cursor-text px-3 py-1 -mx-3 rounded-md hover:bg-muted/10"
      >
        {placeholder}
      </button>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="group relative cursor-text rounded-lg px-3 py-1 -mx-3 transition-colors hover:bg-muted/10"
    >
      <div className="text-sm text-foreground/85">
        <UnifiedMarkdown content={value} />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/40 font-semibold mb-2">
      {children}
    </h3>
  );
}

function PropInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground/40 font-medium">{label}</span>
      {children}
    </div>
  );
}

function TaskSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6">
        <Skeleton className="h-3 w-20 mb-4" />
        <Skeleton className="h-6 w-2/3 mb-6" />
        <Skeleton className="h-px w-full mb-6" />
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}
