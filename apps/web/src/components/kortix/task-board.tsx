'use client';

/**
 * Task Board — grouped pipeline view.
 *
 * Groups:
 *   Planning (Backlog + Todo)
 *   Running (in_progress)
 *   Needs Input (input_needed)
 *   Done (completed + cancelled)
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Play, CheckCircle2, Plus, Trash2, ArrowLeft, Copy, Loader2, ExternalLink } from 'lucide-react';
import {
  STATUS_META,
  shortTaskId,
  relativeTime,
} from '@/lib/kortix/task-meta';
import { openTabAndNavigate } from '@/stores/tab-store';
import type {
  KortixTask,
  KortixTaskStatus,
} from '@/hooks/kortix/use-kortix-tasks';

const DROPPABLE: Set<KortixTaskStatus> = new Set<KortixTaskStatus>(['todo']);

interface TaskBoardProps {
  tasks: KortixTask[];
  onUpdateStatus: (taskId: string, status: KortixTaskStatus) => void;
  onStartTask: (taskId: string) => void;
  onApproveTask: (taskId: string) => void;
  onOpenTask: (task: KortixTask) => void;
  onNewTask: (status?: KortixTaskStatus) => void;
  onDeleteTask: (taskId: string) => void;
}

export function TaskBoard({
  tasks,
  onUpdateStatus,
  onStartTask,
  onApproveTask,
  onOpenTask,
  onNewTask,
  onDeleteTask,
}: TaskBoardProps) {
  const [deleteTarget, setDeleteTarget] = useState<KortixTask | null>(null);

  const planning = useMemo(() => tasks.filter((t) => t.status === 'todo'), [tasks]);
  const running = useMemo(() => tasks.filter((t) => t.status === 'in_progress'), [tasks]);
  const needsInput = useMemo(() => tasks.filter((t) => t.status === 'input_needed'), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.status === 'completed' || t.status === 'cancelled'), [tasks]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-8">

        {/* ─── Planning ─────────────────────────────────── */}
        <section>
          <SectionHeader
            icon={<STATUS_META.todo.icon className="h-4 w-4 text-muted-foreground/60" />}
            label="Planning"
            count={planning.length}
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px] gap-1.5 text-muted-foreground/50 hover:text-foreground"
                onClick={() => onNewTask('todo')}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            }
          />
          {planning.length === 0 ? (
            <button
              onClick={() => onNewTask('todo')}
              className="w-full py-8 rounded-xl border border-dashed border-border/50 text-[13px] text-muted-foreground/30 hover:text-foreground hover:border-border hover:bg-muted/20 transition-all cursor-pointer"
            >
              + Create your first task
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {planning.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onSelect={() => onOpenTask(task)}
                  onDelete={() => setDeleteTarget(task)}
                  action={task.status === 'todo' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[12px] gap-1.5 shrink-0"
                      onClick={(e) => { e.stopPropagation(); onStartTask(task.id); }}
                    >
                      <Play className="h-3 w-3" />
                      Start
                    </Button>
                  ) : undefined}
                  badge={undefined}
                />
              ))}
            </div>
          )}
        </section>

        {/* ─── Running ────────────────────────────────────── */}
        <section>
          <SectionHeader
            icon={<Loader2 className={`h-4 w-4 ${running.length > 0 ? 'text-blue-500 animate-spin' : 'text-muted-foreground/30'}`} />}
            label="Running"
            count={running.length}
          />
          {running.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {running.map((task) => (
                <RunningCard
                  key={task.id}
                  task={task}
                  onSelect={() => onOpenTask(task)}
                  onDelete={() => setDeleteTarget(task)}
                />
              ))}
            </div>
          ) : (
            <EmptySection text="No active workers" />
          )}
        </section>

        {/* ─── Needs Input ────────────────────────────────── */}
        <section>
          <SectionHeader
            icon={<STATUS_META.input_needed.icon className="h-4 w-4 text-violet-500/50" />}
            label="Needs Input"
            count={needsInput.length}
          />
          {needsInput.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {needsInput.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onSelect={() => onOpenTask(task)}
                  onDelete={() => setDeleteTarget(task)}
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[12px] gap-1.5 shrink-0"
                      onClick={(e) => { e.stopPropagation(); onApproveTask(task.id); }}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Approve
                    </Button>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptySection text="No tasks awaiting input" />
          )}
        </section>

        {/* ─── Done ───────────────────────────────────────── */}
        <section>
          <SectionHeader
            icon={<STATUS_META.completed.icon className="h-4 w-4 text-emerald-500/50" />}
            label="Done"
            count={done.length}
          />
          {done.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {done.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onSelect={() => onOpenTask(task)}
                  onDelete={() => setDeleteTarget(task)}
                  dimmed
                  badge={task.status === 'cancelled' ? 'Cancelled' : undefined}
                />
              ))}
            </div>
          ) : (
            <EmptySection text="No completed tasks" />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete task"
        description={<>Are you sure you want to delete <span className="font-semibold text-foreground">&quot;{deleteTarget?.title}&quot;</span>? This action cannot be undone.</>}
        confirmLabel="Delete"
        onConfirm={() => { if (deleteTarget) { onDeleteTask(deleteTarget.id); setDeleteTarget(null); } }}
      />
    </div>
  );
}

// ── Section Header ───────────────────────────────────────────────────────

function EmptySection({ text }: { text: string }) {
  return (
    <div className="py-4 text-center text-[12px] text-muted-foreground/25 rounded-xl border border-dashed border-border/30">
      {text}
    </div>
  );
}

function SectionHeader({ icon, label, count, action }: {
  icon: React.ReactNode;
  label: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      {icon}
      <span className="text-[14px] font-semibold text-foreground tracking-tight">{label}</span>
      <span className="text-[12px] text-muted-foreground/40 tabular-nums">{count}</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// ── Running Card ─────────────────────────────────────────────────────────

function RunningCard({ task, onSelect, onDelete }: {
  task: KortixTask;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={onSelect}
          className="rounded-xl border border-blue-500/15 bg-blue-500/[0.03] p-4 cursor-pointer transition-colors hover:bg-blue-500/[0.06] group"
        >
          <div className="flex items-start gap-3 mb-3">
            <span className="relative flex h-2.5 w-2.5 mt-1.5 shrink-0">
              <span className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-40" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-blue-500" />
            </span>
            <p className="text-[15px] font-medium text-foreground leading-snug line-clamp-2 tracking-tight flex-1">
              {task.title}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/40">
            <span className="font-mono tabular-nums">{shortTaskId(task.id)}</span>
            {task.owner_session_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openTabAndNavigate({
                    id: task.owner_session_id!,
                    title: task.title,
                    type: 'session',
                    href: `/sessions/${task.owner_session_id}`,
                  });
                }}
                className="inline-flex items-center gap-1 text-blue-500/60 hover:text-blue-500 transition-colors cursor-pointer"
              >
                <ExternalLink className="h-3 w-3" />
                Session
              </button>
            )}
            <span className="ml-auto tabular-nums">{relativeTime(task.created_at)}</span>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onSelect}>Open</ContextMenuItem>
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(task.id)}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete}>
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Cancel
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Task Card ────────────────────────────────────────────────────────────

function TaskCard({ task, onSelect, onDelete, action, badge, dimmed }: {
  task: KortixTask;
  onSelect: () => void;
  onDelete: () => void;
  action?: React.ReactNode;
  badge?: string;
  dimmed?: boolean;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={onSelect}
          className={cn(
            'rounded-xl border border-border/50 bg-card p-4 cursor-pointer transition-colors',
            'hover:border-border hover:bg-muted/30',
            dimmed && 'opacity-50',
          )}
        >
          <div className="flex items-start gap-3">
            <p className={cn(
              'text-[15px] font-medium leading-snug line-clamp-2 tracking-tight flex-1',
              dimmed ? 'text-muted-foreground/60 line-through decoration-muted-foreground/20' : 'text-foreground/90',
            )}>
              {task.title}
            </p>
            {action}
          </div>

          <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground/40">
            <span className="font-mono tabular-nums">{shortTaskId(task.id)}</span>
            {badge && (
              <span className="text-[10px] text-muted-foreground/30 bg-muted/40 px-1.5 py-0.5 rounded">
                {badge}
              </span>
            )}
            <span className="ml-auto tabular-nums">{relativeTime(task.created_at)}</span>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onSelect}>Open</ContextMenuItem>
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(task.id)}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete}>
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
