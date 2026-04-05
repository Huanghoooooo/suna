'use client';

import { use, useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, FolderOpen, MessageSquare, Trash2,
  ListTodo, Cpu, CheckCircle2, Circle, Loader2, Ban, AlertTriangle,
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

type Tab = 'tasks' | 'agents' | 'sessions' | 'files';

function ago(t?: string | number) {
  if (!t) return '';
  const ms = Date.now() - (typeof t === 'string' ? +new Date(t) : t);
  const m = ms / 60000 | 0;
  if (m < 1) return 'now'; if (m < 60) return m + 'm';
  const h = m / 60 | 0; if (h < 24) return h + 'h';
  const d = h / 24 | 0;
  return d < 30 ? d + 'd' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const statusIcon: Record<string, { icon: typeof Circle; color: string }> = {
  pending: { icon: Circle, color: 'text-muted-foreground/40' },
  in_progress: { icon: Loader2, color: 'text-blue-400' },
  done: { icon: CheckCircle2, color: 'text-emerald-500' },
  blocked: { icon: AlertTriangle, color: 'text-amber-500' },
  cancelled: { icon: Ban, color: 'text-muted-foreground/30' },
  // Agent statuses
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
  const [tab, setTab] = useState<Tab>('tasks');

  const { data: project, isLoading } = useKortixProject(pid);
  const { data: sessions } = useKortixProjectSessions(pid);
  const { data: tasks } = useKortixTasks(project?.id);
  const { data: agents } = useKortixAgents(project?.id);
  const nav = useFilesStore(s => s.navigateToPath);
  const deleteProject = useDeleteProject();

  const sessionList = sessions ?? [];
  const taskList = tasks ?? [];
  const agentList = agents ?? [];

  // Task stats
  const taskStats = useMemo(() => {
    const done = taskList.filter(t => t.status === 'done').length;
    const inProgress = taskList.filter(t => t.status === 'in_progress').length;
    const pending = taskList.filter(t => t.status === 'pending').length;
    return { done, inProgress, pending, total: taskList.length };
  }, [taskList]);

  useEffect(() => { if (tab === 'files' && project?.path && project.path !== '/') nav(project.path); }, [tab, project?.path, nav]);

  if (isLoading) return (
    <div className="flex-1 p-8 space-y-4">
      <Skeleton className="h-3 w-16 rounded-lg" />
      <Skeleton className="h-7 w-48 rounded-lg" />
      <Skeleton className="h-[400px] rounded-2xl" />
    </div>
  );

  if (!project) return (
    <div className="flex-1 flex items-center justify-center flex-col gap-3">
      <FolderOpen className="h-10 w-10 text-muted-foreground/10" />
      <p className="text-sm font-medium text-muted-foreground/40">Project not found</p>
    </div>
  );

  const tabs: Array<{ id: Tab; label: string; n: number; I: typeof ListTodo }> = [
    { id: 'tasks', label: 'Tasks', n: taskList.length, I: ListTodo },
    { id: 'agents', label: 'Agents', n: agentList.length, I: Cpu },
    { id: 'sessions', label: 'Sessions', n: sessionList.length, I: MessageSquare },
    { id: 'files', label: 'Files', n: 0, I: FolderOpen },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
        {/* Back button */}
        <button onClick={() => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' })}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors mb-5 cursor-pointer group">
          <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />Projects
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            {taskStats.total > 0 && (
              <Badge variant="secondary" className="text-[10px] tabular-nums h-5 rounded-lg px-2">
                {taskStats.done}/{taskStats.total} tasks
              </Badge>
            )}
            <button
              onClick={() => {
                if (!confirm(`Delete project "${project.name}" from registry? Files on disk will NOT be deleted.`)) return;
                deleteProject.mutate(project.id, {
                  onSuccess: () => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' }),
                });
              }}
              disabled={deleteProject.isPending}
              className="ml-auto text-muted-foreground/30 hover:text-destructive transition-colors cursor-pointer p-1.5 rounded-md hover:bg-destructive/10"
              title="Delete project from registry"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {project.description && <p className="text-sm text-muted-foreground/50 max-w-lg">{project.description}</p>}

          {/* Task progress bar */}
          {taskStats.total > 0 && (
            <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden max-w-xs">
              <div
                className="h-full bg-emerald-500/60 rounded-full transition-colors duration-500"
                style={{ width: `${(taskStats.done / taskStats.total) * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center border-b border-border mb-6">
          <div className="flex -mb-px">
             {tabs.map(t => (
              <Button key={t.id} onClick={() => setTab(t.id)}
                variant="ghost"
                className={cn('flex items-center gap-1.5 h-10 px-4 rounded-none border-b-2',
                  tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground')}>
                <t.I className="h-4 w-4" />{t.label}
                {t.n > 0 && <span className="text-[10px] text-muted-foreground/20 tabular-nums ml-1">{t.n}</span>}
              </Button>
            ))}
          </div>
        </div>

        {/* ── Tasks tab ── */}
        {tab === 'tasks' && (!taskList.length
          ? <EmptyState icon={ListTodo} text="No tasks yet" sub="Tasks appear here as the agent works on this project" />
          : <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {taskList.map((t: KortixTask) => {
                const si = statusIcon[t.status] || statusIcon.pending;
                const SI = si.icon;
                const isDone = t.status === 'done' || t.status === 'cancelled';
                return (
                  <div key={t.id}
                    className={cn('flex items-center h-11 px-4 gap-3 w-full border-b border-border last:border-0 transition-colors',
                      isDone && 'opacity-40')}>
                    <SI className={cn('h-3.5 w-3.5 shrink-0', si.color, t.status === 'in_progress' && 'animate-spin')} />
                    <span className={cn('text-sm truncate flex-1', isDone && 'line-through text-muted-foreground')}>
                      {t.title}
                    </span>
                    {t.priority && t.priority !== 'medium' && (
                      <span className={cn('text-[0.5625rem] font-medium px-1.5 py-px rounded border shrink-0', priorityBadge[t.priority] || '')}>
                        {t.priority}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/20 tabular-nums shrink-0">{ago(t.updated_at)}</span>
                  </div>
                );
              })}
            </div>
        )}

        {/* ── Agents tab ── */}
        {tab === 'agents' && (!agentList.length
          ? <EmptyState icon={Cpu} text="No agents spawned" sub="Agents appear here when Kortix delegates work to sub-agents" />
          : <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {agentList.map((a: KortixAgent) => {
                const si = statusIcon[a.status] || statusIcon.running;
                const SI = si.icon;
                return (
                  <button key={a.id}
                    onClick={() => openTabAndNavigate({ id: a.session_id, title: a.description || 'Agent', type: 'session', href: `/sessions/${a.session_id}` })}
                    className="flex items-center h-11 px-4 gap-3 w-full hover:bg-accent/50 transition-colors cursor-pointer text-left border-b border-border last:border-0">
                    <SI className={cn('h-3.5 w-3.5 shrink-0', si.color, a.status === 'running' && 'animate-spin')} />
                    <Badge variant="outline" className="text-[0.5625rem] h-4 px-1.5 font-mono shrink-0">{a.agent_type}</Badge>
                    <span className="text-sm text-foreground/70 truncate flex-1">{a.description}</span>
                    <span className="text-[10px] text-muted-foreground/20 tabular-nums shrink-0">{ago(a.created_at)}</span>
                  </button>
                );
              })}
            </div>
        )}

        {/* ── Sessions tab ── */}
        {tab === 'sessions' && (!sessionList.length
          ? <EmptyState icon={MessageSquare} text="No sessions linked" sub="Sessions are linked when you use project_select" />
          : <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {sessionList.map((s: any) => (
                <button key={s.id} onClick={() => openTabAndNavigate({ id: s.id, title: s.title || 'Session', type: 'session', href: `/sessions/${s.id}` })}
                  className="flex items-center h-11 px-4 gap-3 w-full hover:bg-accent/50 transition-colors cursor-pointer text-left border-b border-border last:border-0">
                  <MessageSquare className="h-4 w-4 text-muted-foreground/15 shrink-0" />
                  <span className="text-sm text-foreground/70 truncate flex-1">{s.title || 'Untitled'}</span>
                  <span className="text-[10px] text-muted-foreground/20 tabular-nums shrink-0">{ago(s.time?.updated)}</span>
                </button>
              ))}
            </div>
        )}

        {/* ── Files tab ── */}
        {tab === 'files' && project.path && project.path !== '/' && <FileExplorerPage />}
        {tab === 'files' && (!project.path || project.path === '/') && (
          <EmptyState icon={FolderOpen} text="No project path" />
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text, sub }: { icon: typeof ListTodo; text: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/10 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground/30">{text}</p>
      {sub && <p className="text-xs text-muted-foreground/15 mt-1">{sub}</p>}
    </div>
  );
}
