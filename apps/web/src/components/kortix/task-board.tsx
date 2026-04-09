'use client';

/**
 * Task Board — Kortix kanban with context menu actions.
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
import { Play, CheckCircle2, Plus, Trash2, ArrowLeft, Copy } from 'lucide-react';
import {
  STATUS_META,
  KANBAN_COLUMNS,
  shortTaskId,
  relativeTime,
  getStatusMeta,
} from '@/lib/kortix/task-meta';
import type {
  KortixTask,
  KortixTaskStatus,
} from '@/hooks/kortix/use-kortix-tasks';

const DROPPABLE: Set<KortixTaskStatus> = new Set(['backlog', 'todo']);

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
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KortixTaskStatus | null>(null);

  const byStatus = useMemo(() => {
    const m = new Map<KortixTaskStatus, KortixTask[]>();
    KANBAN_COLUMNS.forEach((s) => m.set(s, []));
    tasks.forEach((t) => {
      const bucket = m.get(t.status);
      if (bucket) bucket.push(t);
    });
    return m;
  }, [tasks]);

  const handleDrop = (status: KortixTaskStatus) => {
    if (!dragId || !DROPPABLE.has(status)) return;
    const t = tasks.find((x) => x.id === dragId);
    if (t && t.status !== status) onUpdateStatus(dragId, status);
    setDragId(null);
    setDragOverCol(null);
  };

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden">
      <div className="container mx-auto max-w-7xl flex gap-3 px-3 sm:px-4 py-4 h-full min-w-max">
        {KANBAN_COLUMNS.map((status) => {
          const meta = STATUS_META[status];
          const Icon = meta.icon;
          const items = byStatus.get(status) || [];
          const droppable = DROPPABLE.has(status);
          const isOver = dragOverCol === status && droppable;

          return (
            <section
              key={status}
              onDragOver={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setDragOverCol(status);
              }}
              onDragLeave={() =>
                setDragOverCol((prev) => (prev === status ? null : prev))
              }
              onDrop={() => handleDrop(status)}
              className={cn(
                'flex-1 min-w-[200px] flex flex-col rounded-lg transition-colors',
                isOver && 'bg-primary/[0.04]',
              )}
            >
              <header className="flex items-center gap-2 h-7 mb-2 px-1">
                <Icon className={cn('h-3 w-3', meta.color)} />
                <span className="text-[12px] font-semibold text-foreground/90 tracking-tight">
                  {meta.label}
                </span>
                <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                  {items.length}
                </span>
                {droppable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-6 w-6 text-muted-foreground/40 hover:text-foreground"
                    onClick={() => onNewTask(status)}
                    title={`New task in ${meta.label}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </header>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {items.length === 0 ? (
                  droppable ? (
                    <button
                      onClick={() => onNewTask(status)}
                      className="w-full py-5 rounded-lg border border-dashed border-border/50 text-[11px] text-muted-foreground/30 hover:text-foreground hover:border-border hover:bg-muted/20 transition-all cursor-pointer"
                    >
                      + New task
                    </button>
                  ) : (
                    <div className="py-5 text-center text-[11px] text-muted-foreground/20">—</div>
                  )
                ) : (
                  items.map((t) => (
                    <BoardCard
                      key={t.id}
                      task={t}
                      onSelect={() => onOpenTask(t)}
                      onStart={status === 'todo' ? () => onStartTask(t.id) : undefined}
                      onApprove={status === 'in_review' ? () => onApproveTask(t.id) : undefined}
                      onDelete={() => onDeleteTask(t.id)}
                      onMoveTo={
                        status === 'backlog' ? () => onUpdateStatus(t.id, 'todo') :
                        status === 'todo' ? () => onUpdateStatus(t.id, 'backlog') :
                        undefined
                      }
                      moveToLabel={status === 'backlog' ? 'Move to Todo' : status === 'todo' ? 'Move to Backlog' : undefined}
                      onDragStart={droppable ? () => setDragId(t.id) : undefined}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOverCol(null);
                      }}
                      dragging={dragId === t.id}
                      draggable={droppable}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface BoardCardProps {
  task: KortixTask;
  onSelect: () => void;
  onStart?: () => void;
  onApprove?: () => void;
  onDelete: () => void;
  onMoveTo?: () => void;
  moveToLabel?: string;
  onDragStart?: () => void;
  onDragEnd: () => void;
  dragging: boolean;
  draggable: boolean;
}

function BoardCard({
  task,
  onSelect,
  onStart,
  onApprove,
  onDelete,
  onMoveTo,
  moveToLabel,
  onDragStart,
  onDragEnd,
  dragging,
  draggable,
}: BoardCardProps) {
  const sMeta = getStatusMeta(task.status);
  const SIcon = sMeta.icon;
  const hasOwner = !!task.owner_session_id;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={onSelect}
          className={cn(
            'rounded-xl border border-border/50 bg-card p-3 cursor-pointer transition-colors',
            'hover:border-border hover:bg-muted/30',
            draggable && 'active:cursor-grabbing active:scale-[0.98]',
            dragging && 'opacity-40',
          )}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-mono text-muted-foreground/50 tabular-nums">
              {shortTaskId(task.id)}
            </span>
            {hasOwner && (
              <span className="ml-auto inline-flex items-center" title={`Owned by ${task.owner_agent || 'session'}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
            )}
          </div>

          <p className="text-[13px] font-medium text-foreground/90 leading-snug line-clamp-3 tracking-tight mb-2">
            {task.title}
          </p>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
            <SIcon className={cn('h-3 w-3', sMeta.color)} />
            {task.verification_condition && (
              <span className="text-violet-400/80" title={task.verification_condition}>✓</span>
            )}
            <span className="ml-auto tabular-nums">{relativeTime(task.created_at)}</span>
          </div>

          {(onStart || onApprove) && (
            <div className="mt-2 pt-2 border-t border-border/30">
              {onStart && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-full text-[11px] gap-1.5"
                  onClick={(e) => { e.stopPropagation(); onStart(); }}
                >
                  <Play className="h-3 w-3" />
                  Start
                </Button>
              )}
              {onApprove && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-full text-[11px] gap-1.5 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={(e) => { e.stopPropagation(); onApprove(); }}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Approve
                </Button>
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onSelect}>Open</ContextMenuItem>
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(task.id)}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy ID
        </ContextMenuItem>
        {onStart && (
          <ContextMenuItem onClick={onStart}>
            <Play className="mr-2 h-3.5 w-3.5" />
            Start task
          </ContextMenuItem>
        )}
        {onApprove && (
          <ContextMenuItem onClick={onApprove}>
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
            Approve
          </ContextMenuItem>
        )}
        {onMoveTo && (
          <ContextMenuItem onClick={onMoveTo}>
            <ArrowLeft className="mr-2 h-3.5 w-3.5" />
            {moveToLabel}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
