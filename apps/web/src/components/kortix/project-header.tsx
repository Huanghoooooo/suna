'use client';

/**
 * Project header — two-row layout, responsive.
 */

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MessageSquare, Plus } from 'lucide-react';

export type ProjectTab = 'overview' | 'orchestrator' | 'tasks' | 'files' | 'sessions';

export interface ProjectHeaderProps {
  project: any;
  tab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  onNewTask?: () => void;
  onOpenThread?: () => void;
}

const TAB_DEFS: Array<{ id: ProjectTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'orchestrator', label: 'Orchestrator' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'files', label: 'Files' },
  { id: 'sessions', label: 'Sessions' },
];

export function ProjectHeader({ project, tab, onTabChange, onNewTask, onOpenThread }: ProjectHeaderProps) {
  return (
    <div className="shrink-0 bg-background border-b border-border/60">
      <div className="container mx-auto max-w-7xl px-3 sm:px-4">
        {/* Row 1: Name + action */}
        <div className="flex items-center justify-between h-11 pt-1 gap-3">
          <h1
            className="text-[15px] font-semibold text-foreground truncate min-w-0"
            title={project.name}
          >
            {project.name}
          </h1>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenThread && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 sm:px-3 text-[12px] gap-1.5"
                onClick={onOpenThread}
                title="Open project orchestrator"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Open orchestrator</span>
              </Button>
            )}

            {onNewTask && (
              <Button
                size="sm"
                className="h-7 px-2 sm:px-3 text-[12px] gap-1.5 shrink-0"
                onClick={onNewTask}
                title="New task (C)"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New task</span>
                <kbd className="hidden sm:inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded border border-white/20 bg-white/10 text-[10px] font-mono font-medium leading-none text-white/90">
                  C
                </kbd>
              </Button>
            )}
          </div>
        </div>

        {/* Row 2: Tab bar — scrollable on mobile */}
        <nav className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-none" role="tablist">
          {TAB_DEFS.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(t.id)}
                className={cn(
                  'relative h-9 px-3 text-[13px] font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground/60 hover:text-foreground',
                )}
              >
                {t.label}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-foreground rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
