'use client';

/**
 * Task list — uses the brand Table component.
 * Status icon is read-only (no dropdown). Status changes follow the state machine.
 */

import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  STATUS_META,
  shortTaskId,
  relativeTime,
} from '@/lib/kortix/task-meta';
import type {
  KortixTask,
  KortixTaskStatus,
} from '@/hooks/kortix/use-kortix-tasks';

interface TaskListProps {
  tasks: KortixTask[];
  onUpdateStatus: (taskId: string, status: KortixTaskStatus) => void;
  onOpenTask: (task: KortixTask) => void;
}

export function TaskList({ tasks, onOpenTask }: TaskListProps) {
  return (
    <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-4">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Task</TableHead>
            <TableHead className="w-[80px] hidden sm:table-cell">ID</TableHead>
            <TableHead className="w-[90px] text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const terminal =
              task.status === 'completed' ||
              task.status === 'cancelled';
            const meta = STATUS_META[task.status];
            const Icon = meta?.icon;

            return (
              <TableRow
                key={task.id}
                onClick={() => onOpenTask(task)}
                className="cursor-pointer group"
              >
                <TableCell className="max-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {Icon && (
                      <span title={meta.label} className="shrink-0">
                        <Icon className={cn('h-4 w-4', meta.color)} />
                      </span>
                    )}
                    <span
                      className={cn(
                        'text-[13px] truncate',
                        terminal
                          ? 'text-muted-foreground/50 line-through decoration-muted-foreground/20'
                          : 'text-foreground/85 group-hover:text-foreground',
                      )}
                    >
                      {task.title}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-[10px] font-mono text-muted-foreground/30 tabular-nums hidden sm:table-cell">
                  {shortTaskId(task.id)}
                </TableCell>
                <TableCell className="text-[11px] text-muted-foreground/35 tabular-nums text-right">
                  {relativeTime(task.updated_at)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
