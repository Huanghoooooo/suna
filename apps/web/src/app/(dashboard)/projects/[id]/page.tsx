'use client';

import { use, useState, useEffect, useMemo } from 'react';
import {
  FolderOpen, MessageSquare, Trash2,
  ListTodo, Cpu, CheckCircle2, Circle, Loader2, Ban, AlertTriangle,
  Code2, GitBranch, Clock, MoreHorizontal,
  ExternalLink, FolderGit2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useKortixProject, useKortixProjectSessions, useDeleteProject } from '@/hooks/kortix/use-kortix-projects';
import { useKortixTasks, type KortixTask } from '@/hooks/kortix/use-kortix-tasks';
import { useKortixAgents, type KortixAgent } from '@/hooks/kortix/use-kortix-agents';
import { openTabAndNavigate } from '@/stores/tab-store';
import { useFilesStore } from '@/features/files/store/files-store';
import { FileExplorerPage } from '@/features/files/components/file-explorer-page';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Tab = 'files' | 'tasks' | 'agents' | 'sessions';

function ago(t?: string | number) {
  if (!t) return '';
  const ms = Date.now() - (typeof t === 'string' ? +new Date(t) : t);
  const m = ms / 60000 | 0;
  if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
  const h = m / 60 | 0; if (h < 24) return h + 'h ago';
  const d = h / 24 | 0;
  return d < 30 ? d + 'd ago' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const statusIcon: Record<string, { icon: typeof Circle; color: string }> = {
  pending: { icon: Circle, color: 'text-muted-foreground/40' },
  in_progress: { icon: Loader2, color: 'text-blue-400' },
  done: { icon: CheckCircle2, color: 'text-emerald-500' },
  blocked: { icon: AlertTriangle, color: 'text-amber-500' },
  cancelled: { icon: Ban, color: 'text-muted-foreground/30' },
  running: { icon: Loader2, color: 'text-blue-400' },
  completed: { icon: CheckCircle2, color: 'text-emerald-500' },
  failed: { icon: AlertTriangle, color: 'text-red-500' },
  stopped: { icon: Ban, color: 'text-muted-foreground/40' },
};

const priorityBadge: Record<string, string> = {
  high: 'bg-red-500/10 text-red-500 border-red-500/20',
  medium: 'bg-amber-500/10 text-amber-500/70 border-amber-500/20',
  low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

export default function ProjectPage({ params }: { params?: Promise<{ id: string }> }) {
  const { id: raw } = params ? use(params) : { id: '' };
  const pid = raw ? decodeURIComponent(raw) : '';
  const [tab, setTab] = useState<Tab>('files');

  const { data: project, isLoading } = useKortixProject(pid);
  const { data: sessions } = useKortixProjectSessions(pid);
  const { data: tasks } = useKortixTasks(project?.id);
  const { data: agents } = useKortixAgents(project?.id);
  const nav = useFilesStore(s => s.navigateToPath);
  const deleteProject = useDeleteProject();

  const sessionList = sessions ?? [];
  const taskList = tasks ?? [];
  const agentList = agents ?? [];

  const taskStats = useMemo(() => {
    const done = taskList.filter(t => t.status === 'done').length;
    const inProgress = taskList.filter(t => t.status === 'in_progress').length;
    const pending = taskList.filter(t => t.status === 'pending').length;
    return { done, inProgress, pending, total: taskList.length };
  }, [taskList]);

  useEffect(() => { if (tab === 'files' && project?.path && project.path !== '/') nav(project.path); }, [tab, project?.path, nav]);

  const hasFiles = project?.path && project.path !== '/';

  // GitHub-style tab definitions
  const tabs: Array<{ id: Tab; label: string; count: number; icon: typeof Code2 }> = [
    { id: 'files', label: 'Files', count: 0, icon: Code2 },
    { id: 'tasks', label: 'Tasks', count: taskList.length, icon: ListTodo },
    { id: 'agents', label: 'Agents', count: agentList.length, icon: Cpu },
    { id: 'sessions', label: 'Sessions', count: sessionList.length, icon: MessageSquare },
  ];

  // Loading skeleton
  if (isLoading) return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-border bg-background">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Skeleton className="h-5 w-48 rounded mb-3" />
          <Skeleton className="h-4 w-96 rounded mb-4" />
          <div className="flex gap-6">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-20 rounded" />)}
          </div>
        </div>
      </div>
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Skeleton className="h-[500px] rounded-lg" />
      </div>
    </div>
  );

  // Not found
  if (!project) return (
    <div className="flex-1 flex items-center justify-center flex-col gap-3">
      <FolderGit2 className="h-12 w-12 text-muted-foreground/10" />
      <p className="text-sm font-medium text-muted-foreground/40">Project not found</p>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground/30"
        onClick={() => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' })}
      >
        Back to Workspace
      </Button>
    </div>
  );

  // Extract project path basename for breadcrumb display
  const pathParts = project.path?.split('/').filter(Boolean) ?? [];
  const parentDir = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'workspace';

  return (
    <div className="flex-1 overflow-y-auto bg-background">

      {/* ── GitHub-style sticky header ─────────────────────────────── */}
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8">

          {/* Row 1: Repo name + actions */}
          <div className="flex items-center gap-3 py-4">
            <FolderGit2 className="h-5 w-5 text-muted-foreground/50 shrink-0" />
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={() => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' })}
                className="text-sm font-semibold text-primary hover:underline cursor-pointer truncate"
              >
                {parentDir}
              </button>
              <span className="text-muted-foreground/40 text-sm">/</span>
              <span className="text-sm font-bold text-foreground truncate">{project.name}</span>
              <Badge variant="outline" size="sm" className="ml-1.5 text-[10px] text-muted-foreground/50 border-border">
                Private
              </Badge>
            </div>

            {/* Right-side action buttons */}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {taskStats.total > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground/50 border border-border rounded-md px-2.5 py-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span className="tabular-nums">{taskStats.done}/{taskStats.total} tasks</span>
                </div>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 px-2">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {project.path && project.path !== '/' && (
                    <DropdownMenuItem onClick={() => openTabAndNavigate({ id: `file:${project.path}`, title: project.name, type: 'file', href: `/files/${encodeURIComponent(project.path)}` })}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      Open in file viewer
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      if (!confirm(`Delete project "${project.name}" from registry? Files on disk will NOT be deleted.`)) return;
                      deleteProject.mutate(project.id, {
                        onSuccess: () => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' }),
                      });
                    }}
                    disabled={deleteProject.isPending}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Row 2: GitHub-style tab navigation */}
          <nav className="flex gap-0 -mb-px overflow-x-auto">
            {tabs.map(t => {
              const isActive = tab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'border-primary text-foreground font-semibold'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                  {t.count > 0 && (
                    <span className={cn(
                      'text-[11px] tabular-nums rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none',
                      isActive
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-muted/50 text-muted-foreground/60',
                    )}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── Main content area ──────────────────────────────────────── */}
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Left: Main content */}
          <div className="flex-1 min-w-0">

            {/* ── Files tab ── */}
            {tab === 'files' && (
              <>
                {hasFiles ? (
                  <div className="rounded-lg border border-border bg-card overflow-hidden">
                    {/* Commit-like info bar */}
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border text-sm">
                      <GitBranch className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <span className="text-muted-foreground/60 font-mono text-xs truncate">{project.path}</span>
                      {taskStats.total > 0 && (
                        <>
                          <span className="text-muted-foreground/20 mx-1">·</span>
                          <Clock className="h-3.5 w-3.5 text-muted-foreground/40" />
                          <span className="text-xs text-muted-foreground/50">
                            {taskStats.inProgress > 0
                              ? `${taskStats.inProgress} task${taskStats.inProgress > 1 ? 's' : ''} in progress`
                              : taskStats.done === taskStats.total
                                ? 'All tasks complete'
                                : `${taskStats.pending} task${taskStats.pending > 1 ? 's' : ''} pending`
                            }
                          </span>
                        </>
                      )}
                    </div>
                    {/* File explorer */}
                    <div className="h-[calc(100vh-280px)] min-h-[400px]">
                      <FileExplorerPage />
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={FolderOpen}
                    text="No project path configured"
                    sub="This project doesn't have a file path associated with it yet"
                  />
                )}
              </>
            )}

            {/* ── Tasks tab ── */}
            {tab === 'tasks' && (!taskList.length
              ? <EmptyState icon={ListTodo} text="No tasks yet" sub="Tasks appear here as the agent works on this project" />
              : <div className="rounded-lg border border-border bg-card overflow-hidden">
                  {/* Task list header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="font-semibold text-foreground">{taskStats.done} done</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground/60">
                      <Circle className="h-4 w-4" />
                      <span>{taskStats.pending + taskStats.inProgress} open</span>
                    </div>
                  </div>
                  {taskList.map((t: KortixTask) => {
                    const si = statusIcon[t.status] || statusIcon.pending;
                    const SI = si.icon;
                    const isDone = t.status === 'done' || t.status === 'cancelled';
                    return (
                      <div key={t.id}
                        className={cn('flex items-center h-11 px-4 gap-3 w-full border-b border-border last:border-0 transition-colors hover:bg-muted/30',
                          isDone && 'opacity-40')}>
                        <SI className={cn('h-4 w-4 shrink-0', si.color, t.status === 'in_progress' && 'animate-spin')} />
                        <span className={cn('text-sm truncate flex-1', isDone && 'line-through text-muted-foreground')}>
                          {t.title}
                        </span>
                        {t.priority && t.priority !== 'medium' && (
                          <span className={cn('text-[0.5625rem] font-medium px-1.5 py-px rounded border shrink-0', priorityBadge[t.priority] || '')}>
                            {t.priority}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground/30 tabular-nums shrink-0">{ago(t.updated_at)}</span>
                      </div>
                    );
                  })}
                </div>
            )}

            {/* ── Agents tab ── */}
            {tab === 'agents' && (!agentList.length
              ? <EmptyState icon={Cpu} text="No agents spawned" sub="Agents appear here when Kortix delegates work to sub-agents" />
              : <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border text-sm">
                    <Cpu className="h-4 w-4 text-muted-foreground/40" />
                    <span className="font-semibold text-foreground">{agentList.length} agent{agentList.length > 1 ? 's' : ''}</span>
                  </div>
                  {agentList.map((a: KortixAgent) => {
                    const si = statusIcon[a.status] || statusIcon.running;
                    const SI = si.icon;
                    return (
                      <button key={a.id}
                        onClick={() => openTabAndNavigate({ id: a.session_id, title: a.description || 'Agent', type: 'session', href: `/sessions/${a.session_id}` })}
                        className="flex items-center h-11 px-4 gap-3 w-full hover:bg-muted/30 transition-colors cursor-pointer text-left border-b border-border last:border-0">
                        <SI className={cn('h-4 w-4 shrink-0', si.color, a.status === 'running' && 'animate-spin')} />
                        <Badge variant="outline" className="text-[0.5625rem] h-4 px-1.5 font-mono shrink-0">{a.agent_type}</Badge>
                        <span className="text-sm text-foreground/70 truncate flex-1">{a.description}</span>
                        <span className="text-xs text-muted-foreground/30 tabular-nums shrink-0">{ago(a.created_at)}</span>
                      </button>
                    );
                  })}
                </div>
            )}

            {/* ── Sessions tab ── */}
            {tab === 'sessions' && (!sessionList.length
              ? <EmptyState icon={MessageSquare} text="No sessions linked" sub="Sessions are linked when you use project_select" />
              : <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border text-sm">
                    <MessageSquare className="h-4 w-4 text-muted-foreground/40" />
                    <span className="font-semibold text-foreground">{sessionList.length} session{sessionList.length > 1 ? 's' : ''}</span>
                  </div>
                  {sessionList.map((s: any) => (
                    <button key={s.id} onClick={() => openTabAndNavigate({ id: s.id, title: s.title || 'Session', type: 'session', href: `/sessions/${s.id}` })}
                      className="flex items-center h-11 px-4 gap-3 w-full hover:bg-muted/30 transition-colors cursor-pointer text-left border-b border-border last:border-0">
                      <MessageSquare className="h-4 w-4 text-muted-foreground/20 shrink-0" />
                      <span className="text-sm text-foreground/70 truncate flex-1">{s.title || 'Untitled'}</span>
                      <span className="text-xs text-muted-foreground/30 tabular-nums shrink-0">{ago(s.time?.updated)}</span>
                    </button>
                  ))}
                </div>
            )}
          </div>

          {/* Right sidebar — About (shown on all tabs) */}
          <aside className="shrink-0 w-full lg:w-72">
            <div className="space-y-6">

              {/* About section */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  About
                </h3>
                {project.description ? (
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{project.description}</p>
                ) : (
                  <p className="text-sm text-muted-foreground/40 italic mb-4">No description provided</p>
                )}

                {/* Meta list */}
                <div className="space-y-2.5">
                  {project.path && project.path !== '/' && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FolderOpen className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <span className="truncate font-mono text-xs">{project.path}</span>
                    </div>
                  )}
                  {project.created_at && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <span>Created {ago(project.created_at)}</span>
                    </div>
                  )}
                  {sessionList.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MessageSquare className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <span>{sessionList.length} session{sessionList.length > 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {agentList.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Cpu className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <span>{agentList.length} agent{agentList.length > 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Task progress section */}
              {taskStats.total > 0 && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Task Progress</h3>
                    <div className="space-y-3">
                      {/* Progress bar */}
                      <div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                          <span>{Math.round((taskStats.done / taskStats.total) * 100)}% complete</span>
                          <span className="tabular-nums">{taskStats.done}/{taskStats.total}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                            style={{ width: `${(taskStats.done / taskStats.total) * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* Status breakdown */}
                      <div className="grid grid-cols-3 gap-2">
                        {taskStats.done > 0 && (
                          <div className="text-center p-2 rounded-md bg-emerald-500/5 border border-emerald-500/10">
                            <div className="text-lg font-bold text-emerald-500 tabular-nums">{taskStats.done}</div>
                            <div className="text-[10px] text-emerald-500/60 uppercase tracking-wider">Done</div>
                          </div>
                        )}
                        {taskStats.inProgress > 0 && (
                          <div className="text-center p-2 rounded-md bg-blue-500/5 border border-blue-500/10">
                            <div className="text-lg font-bold text-blue-400 tabular-nums">{taskStats.inProgress}</div>
                            <div className="text-[10px] text-blue-400/60 uppercase tracking-wider">Active</div>
                          </div>
                        )}
                        {taskStats.pending > 0 && (
                          <div className="text-center p-2 rounded-md bg-muted/30 border border-border">
                            <div className="text-lg font-bold text-muted-foreground tabular-nums">{taskStats.pending}</div>
                            <div className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Open</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border" />
                </>
              )}

              {/* Active agents section */}
              {agentList.some(a => a.status === 'running') && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Active Agents</h3>
                    <div className="space-y-2">
                      {agentList.filter(a => a.status === 'running').map(a => (
                        <button
                          key={a.id}
                          onClick={() => openTabAndNavigate({ id: a.session_id, title: a.description || 'Agent', type: 'session', href: `/sessions/${a.session_id}` })}
                          className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors cursor-pointer"
                        >
                          <Loader2 className="h-3 w-3 text-blue-400 animate-spin shrink-0" />
                          <span className="text-xs text-foreground/70 truncate">{a.description || a.agent_type}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-border" />
                </>
              )}

              {/* Recent sessions */}
              {sessionList.length > 0 && tab !== 'sessions' && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Recent Sessions</h3>
                  <div className="space-y-1">
                    {sessionList.slice(0, 5).map((s: any) => (
                      <button
                        key={s.id}
                        onClick={() => openTabAndNavigate({ id: s.id, title: s.title || 'Session', type: 'session', href: `/sessions/${s.id}` })}
                        className="flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors cursor-pointer"
                      >
                        <MessageSquare className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                        <span className="text-xs text-foreground/70 truncate flex-1">{s.title || 'Untitled'}</span>
                        <span className="text-[10px] text-muted-foreground/30 tabular-nums shrink-0">{ago(s.time?.updated)}</span>
                      </button>
                    ))}
                    {sessionList.length > 5 && (
                      <button
                        onClick={() => setTab('sessions')}
                        className="text-xs text-primary hover:underline cursor-pointer px-2 py-1"
                      >
                        + {sessionList.length - 5} more
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text, sub }: { icon: typeof ListTodo; text: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/10 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground/30">{text}</p>
      {sub && <p className="text-xs text-muted-foreground/15 mt-1">{sub}</p>}
    </div>
  );
}
