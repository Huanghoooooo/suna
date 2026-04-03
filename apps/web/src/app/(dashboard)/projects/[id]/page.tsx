'use client';

import { use, useState, useEffect } from 'react';
import { ArrowLeft, FolderOpen, MessageSquare, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useKortixProject, useKortixProjectSessions, useDeleteProject } from '@/hooks/kortix/use-kortix-projects';
import { openTabAndNavigate } from '@/stores/tab-store';
import { useFilesStore } from '@/features/files/store/files-store';
import { FileExplorerPage } from '@/features/files/components/file-explorer-page';

type Tab = 'sessions' | 'files';

function ago(t?: string | number) {
  if (!t) return '';
  const ms = Date.now() - (typeof t === 'string' ? +new Date(t) : t);
  const m = ms / 60000 | 0;
  if (m < 1) return 'now'; if (m < 60) return m + 'm';
  const h = m / 60 | 0; if (h < 24) return h + 'h';
  const d = h / 24 | 0;
  return d < 30 ? d + 'd' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ProjectPage({ params }: { params?: Promise<{ id: string }> }) {
  const { id: raw } = params ? use(params) : { id: '' };
  const pid = raw ? decodeURIComponent(raw) : '';
  const [tab, setTab] = useState<Tab>('sessions');

  const { data: project, isLoading } = useKortixProject(pid);
  const { data: sessions } = useKortixProjectSessions(pid);
  const nav = useFilesStore(s => s.navigateToPath);
  const deleteProject = useDeleteProject();

  const sessionList = sessions ?? [];

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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
        <button onClick={() => openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' })}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors mb-5 cursor-pointer group">
          <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />Projects
        </button>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            {sessionList.length > 0 && (
              <Badge variant="secondary" className="text-[10px] tabular-nums h-5 rounded-lg px-2">
                {sessionList.length} session{sessionList.length !== 1 ? 's' : ''}
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
        </div>

        <div className="flex items-center border-b border-border mb-6">
          <div className="flex -mb-px">
            {([
              { id: 'sessions' as Tab, label: 'Sessions', n: sessionList.length, I: MessageSquare },
              { id: 'files' as Tab, label: 'Files', n: 0, I: FolderOpen },
            ]).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn('flex items-center gap-1.5 h-10 px-4 text-sm font-medium border-b-2 cursor-pointer transition-colors',
                  tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground')}>
                <t.I className="h-4 w-4" />{t.label}
                {t.n > 0 && <span className="text-[10px] text-muted-foreground/20 tabular-nums ml-1">{t.n}</span>}
              </button>
            ))}
          </div>
        </div>

        {tab === 'sessions' && (!sessionList.length
          ? <div className="rounded-2xl border border-border bg-card p-12 text-center"><MessageSquare className="h-8 w-8 text-muted-foreground/10 mx-auto mb-3" /><p className="text-sm text-muted-foreground/30">No sessions linked to this project yet</p><p className="text-xs text-muted-foreground/15 mt-1">Sessions are linked when you use <code className="bg-muted px-1 rounded">project_select</code> in a session</p></div>
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

        {tab === 'files' && project.path && project.path !== '/' && <FileExplorerPage />}
        {tab === 'files' && (!project.path || project.path === '/') && (
          <div className="rounded-2xl border border-border bg-card p-12 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground/10 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground/30">No project path</p>
          </div>
        )}
      </div>
    </div>
  );
}
