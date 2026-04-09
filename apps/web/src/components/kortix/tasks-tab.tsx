'use client';

/**
 * Tasks tab — toolbar + board/list view.
 *
 * Uses brand UI components: FilterBar, FilterBarItem, Badge,
 * Button, DropdownMenu. No inline-styled controls.
 */

import { useMemo } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  LayoutGrid,
  List as ListIcon,
  Plus,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterBarItem } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { STATUS_META, ALL_STATUSES } from '@/lib/kortix/task-meta';
import { EmptyState } from '@/components/ui/empty-state';
import { IconInbox } from '@/components/ui/kortix-icons';
import { TaskBoard } from '@/components/kortix/task-board';
import { TaskList } from '@/components/kortix/task-list';
import type {
  KortixTask,
  KortixTaskStatus,
} from '@/hooks/kortix/use-kortix-tasks';

export type TaskView = 'board' | 'list';
export type SortKey = 'updated' | 'created' | 'title';

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'updated', label: 'Last updated' },
  { id: 'created', label: 'Created' },
  { id: 'title', label: 'Title' },
];

interface TasksTabProps {
  tasks: KortixTask[];
  filteredTasks: KortixTask[];
  view: TaskView;
  setView: (v: TaskView) => void;
  search: string;
  setSearch: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  statusFilter: Set<KortixTaskStatus>;
  setStatusFilter: React.Dispatch<React.SetStateAction<Set<KortixTaskStatus>>>;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
  onUpdateStatus: (id: string, s: KortixTaskStatus) => void;
  onStartTask: (id: string) => void;
  onApproveTask: (id: string) => void;
  onOpenTask: (task: KortixTask) => void;
  onNewTask: (status?: KortixTaskStatus) => void;
  onDeleteTask: (id: string) => void;
  hasFilters: boolean;
  clearFilters: () => void;
}

export function TasksTab({
  tasks,
  filteredTasks,
  view,
  setView,
  search,
  setSearch,
  searchRef,
  statusFilter,
  setStatusFilter,
  sortKey,
  setSortKey,
  onUpdateStatus,
  onStartTask,
  onApproveTask,
  onOpenTask,
  onNewTask,
  onDeleteTask,
  hasFilters,
  clearFilters,
}: TasksTabProps) {
  const toggleStatus = (s: KortixTaskStatus) =>
    setStatusFilter((prev) => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });

  const filterCount = useMemo(() => statusFilter.size, [statusFilter]);
  const currentSort = SORT_OPTIONS.find((o) => o.id === sortKey);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ─── Toolbar ─────────────────────────────────────── */}
      <div className="shrink-0 bg-background border-b border-border/50">
        <div className="container mx-auto max-w-7xl px-3 sm:px-4 h-11 flex items-center justify-end gap-1.5 sm:gap-2">
          {/* Search */}
          <div className="relative mr-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
            <input
              ref={searchRef as React.RefObject<HTMLInputElement>}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              data-slot="input"
              className="h-7 w-[140px] sm:w-[200px] pl-7 pr-7 text-[11px] bg-transparent border border-border/50 rounded-full outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/35 transition-[color,box-shadow]"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center text-muted-foreground/40 hover:text-foreground cursor-pointer rounded-full"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Filter">
                <Filter className="h-3.5 w-3.5" />
                {filterCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-semibold">
                    {filterCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {ALL_STATUSES.map((s) => {
                const M = STATUS_META[s];
                const I = M.icon;
                const isActive = statusFilter.has(s);
                return (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => toggleStatus(s)}
                    className="text-[12px] gap-2"
                  >
                    <I className={cn('h-3.5 w-3.5', M.color)} />
                    <span className="flex-1">{M.label}</span>
                    {isActive && <Check className="h-3 w-3 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Sort">
                <ArrowUpDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {SORT_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.id}
                  onClick={() => setSortKey(o.id)}
                  className="text-[12px] gap-2"
                >
                  <span className="flex-1">{o.label}</span>
                  {sortKey === o.id && <Check className="h-3 w-3 text-foreground/60" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View toggle */}
          <FilterBar className="h-7">
            <FilterBarItem
              data-state={view === 'board' ? 'active' : 'inactive'}
              onClick={() => setView('board')}
              className="px-2"
              title="Board"
            >
              <LayoutGrid className="h-3 w-3" />
            </FilterBarItem>
            <FilterBarItem
              data-state={view === 'list' ? 'active' : 'inactive'}
              onClick={() => setView('list')}
              className="px-2"
              title="List"
            >
              <ListIcon className="h-3 w-3" />
            </FilterBarItem>
          </FilterBar>
        </div>
      </div>

      {/* ─── Body ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {tasks.length === 0 ? (
          <EmptyTasks onNewTask={() => onNewTask()} />
        ) : filteredTasks.length === 0 ? (
          <NoMatch hasFilters={hasFilters} clearFilters={clearFilters} />
        ) : view === 'board' ? (
          <TaskBoard
            tasks={filteredTasks}
            onUpdateStatus={onUpdateStatus}
            onStartTask={onStartTask}
            onApproveTask={onApproveTask}
            onOpenTask={onOpenTask}
            onNewTask={onNewTask}
            onDeleteTask={onDeleteTask}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            <TaskList
              tasks={filteredTasks}
              onUpdateStatus={onUpdateStatus}
              onOpenTask={onOpenTask}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyTasks({ onNewTask }: { onNewTask: () => void }) {
  return (
    <EmptyState
      icon={IconInbox}
      title="No tasks yet"
      description={
        <>
          Tasks track work that needs doing. Press{' '}
          <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded border border-border bg-muted/50 text-[11px] font-mono text-foreground/70">C</kbd>{' '}
          any time to create one.
        </>
      }
      action={
        <Button size="sm" onClick={onNewTask} className="h-8 px-4 text-[13px]">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create task
        </Button>
      }
    />
  );
}

function NoMatch({
  hasFilters,
  clearFilters,
}: {
  hasFilters: boolean;
  clearFilters: () => void;
}) {
  return (
    <EmptyState
      icon={IconInbox}
      size="sm"
      title="No matches"
      description="No tasks match your filters."
      action={
        hasFilters ? (
          <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}
