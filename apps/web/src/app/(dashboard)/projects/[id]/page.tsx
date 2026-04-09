'use client';

/**
 * Project page — Vercel-grade.
 *
 * Thin orchestrator. All real UI lives in extracted components:
 *   • <ProjectHeader>     — identity, meta, tabs, contextual CTA
 *   • <IssuesTab>          — kanban / list with toolbar
 *   • <ProjectOverview>    — description + details
 *   • <FileExplorerPage>   — files
 *   • <SessionsTab>        — inline sessions list
 *   • <IssueDetailView>    — in-tab issue detail (no new tabs)
 *
 * All four tabs are PRE-MOUNTED and CSS-hidden when inactive — switching
 * is instant, no skeleton flash.
 */

import { use, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FolderGit2, Plus, ExternalLink, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useKortixProject,
  useKortixProjectSessions,
  useDeleteProject,
  useUpdateProject,
} from '@/hooks/kortix/use-kortix-projects';
import {
  useKortixTasks,
  useUpdateKortixTask,
  type KortixTask,
  type KortixTaskStatus,
} from '@/hooks/kortix/use-kortix-tasks';
import { useKortixAgents } from '@/hooks/kortix/use-kortix-agents';
import { openTabAndNavigate } from '@/stores/tab-store';
import {
  createFilesStore,
  FilesStoreProvider,
} from '@/features/files/store/files-store';
import { FileExplorerPage } from '@/features/files/components/file-explorer-page';
import { relativeTime } from '@/lib/kortix/task-meta';
import {
  ProjectHeader,
  type ProjectTab,
} from '@/components/kortix/project-header';
import { ProjectOverview } from '@/components/kortix/project-overview';
import {
  IssuesTab,
  QUICK_FILTER_STATUSES,
  type IssueView,
  type SortKey,
  type QuickFilter,
} from '@/components/kortix/issues-tab';
import { IssueDetailView } from '@/components/kortix/issue-detail-view';
import { NewIssueDialog } from '@/components/kortix/new-issue-dialog';

export default function ProjectPage({ params }: { params?: Promise<{ id: string }> }) {
  const { id: raw } = params ? use(params) : { id: '' };
  const pid = raw ? decodeURIComponent(raw) : '';
  const projectFilesStoreRef = useRef(createFilesStore());
  const projectFilesStore = projectFilesStoreRef.current;

  // ── Data ────────────────────────────────────────────────────
  const { data: project, isLoading } = useKortixProject(pid);
  const { data: sessions } = useKortixProjectSessions(pid);
  const { data: tasks } = useKortixTasks(project?.id);
  const { data: agents } = useKortixAgents(project?.id);
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  const updateTask = useUpdateKortixTask();

  const sessionList = sessions ?? [];
  const taskList: KortixTask[] = tasks ?? [];
  const agentList = agents ?? [];

  // ── File explorer scoping ───────────────────────────────────
  useEffect(() => {
    const { setRootPath, navigateToPath } = projectFilesStore.getState();
    if (project?.path && project.path !== '/') {
      setRootPath(project.path);
      navigateToPath(project.path);
    }
    return () => {
      setRootPath(null);
      projectFilesStore.setState({ currentPath: '/workspace' });
    };
  }, [project?.path, projectFilesStore]);

  // ── Tabs ────────────────────────────────────────────────────
  const [tab, setTabState] = useState<ProjectTab>('overview');
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const setTab = useCallback((next: ProjectTab) => {
    setTabState(next);
    setOpenIssueId(null);
  }, []);
  const openIssue = useCallback((task: KortixTask) => {
    setOpenIssueId(task.id);
    setTabState('issues');
  }, []);
  const closeIssue = useCallback(() => setOpenIssueId(null), []);

  // Re-navigate file explorer when files tab activated
  useEffect(() => {
    if (tab === 'files' && project?.path && project.path !== '/') {
      projectFilesStore.getState().navigateToPath(project.path);
    }
  }, [tab, project?.path, projectFilesStore]);

  // ── Issues view state ───────────────────────────────────────
  const [view, setView] = useState<IssueView>('board');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<KortixTaskStatus>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const searchRef = useRef<HTMLInputElement>(null);

  // ── New issue dialog ────────────────────────────────────────
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [newIssueDefault, setNewIssueDefault] = useState<KortixTaskStatus | undefined>();
  const openNewIssue = useCallback((status?: KortixTaskStatus) => {
    setNewIssueDefault(status);
    setNewIssueOpen(true);
  }, []);

  // ── Filtered tasks ──────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    let out = taskList;
    const quickStatuses = QUICK_FILTER_STATUSES[quickFilter];
    if (quickStatuses) out = out.filter((t) => quickStatuses.includes(t.status));
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q),
      );
    }
    if (statusFilter.size) out = out.filter((t) => statusFilter.has(t.status));
    return [...out].sort((a, b) => {
      if (sortKey === 'title') return a.title.localeCompare(b.title);
      if (sortKey === 'created')
        return +new Date(b.created_at) - +new Date(a.created_at);
      return +new Date(b.updated_at) - +new Date(a.updated_at);
    });
  }, [taskList, quickFilter, search, statusFilter, sortKey]);

  // ── Keyboard shortcuts (issues tab only) ────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA';
      if (e.key === '/' && tab === 'issues' && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (
        (e.key === 'c' || e.key === 'C') &&
        tab === 'issues' &&
        !inField &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        setNewIssueOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);

  // ── Loading / 404 ───────────────────────────────────────────
  if (isLoading && !project) return <ProjectSkeleton />;
  if (!project)
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3">
        <FolderGit2 className="h-12 w-12 text-muted-foreground/10" />
        <p className="text-sm font-medium text-muted-foreground/40">Project not found</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            openTabAndNavigate({
              id: 'page:/workspace',
              title: 'Workspace',
              type: 'page',
              href: '/workspace',
            })
          }
        >
          Back to Workspace
        </Button>
      </div>
    );

  const hasFiles = project.path && project.path !== '/';
  const hasFilters = !!search || statusFilter.size > 0;
  const activeOwnerCount = taskList.filter((t) => !!t.owner_session_id).length;

  // ── Per-tab CTA ─────────────────────────────────────────────
  const tabCTA: Record<ProjectTab, React.ReactNode> = {
    issues: (
      <Button
        size="sm"
        className="h-8 px-3.5 text-[13px] gap-1.5 font-medium"
        onClick={() => openNewIssue()}
        title="New issue (C)"
      >
        <Plus className="h-3.5 w-3.5" />
        New issue
      </Button>
    ),
    files: hasFiles ? (
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-3 text-[13px] gap-1.5"
        onClick={() =>
          openTabAndNavigate({
            id: `file:${project.path}`,
            title: project.name,
            type: 'file',
            href: `/files/${encodeURIComponent(project.path)}`,
          })
        }
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open in editor
      </Button>
    ) : null,
    overview: null,
    sessions: null,
  };

  return (
    <div className="flex-1 bg-background flex flex-col overflow-hidden">
      {/* Header is hidden when an issue is open (issue detail has its own breadcrumb) */}
      {!openIssueId && (
        <ProjectHeader
          project={project}
          tab={tab}
          onTabChange={setTab}
          taskCount={taskList.length}
          sessionCount={sessionList.length}
          activeOwnerCount={activeOwnerCount}
          onDelete={() => {
            if (
              !confirm(
                `Delete project "${project.name}" from registry? Files on disk will NOT be deleted.`,
              )
            )
              return;
            deleteProject.mutate(project.id, {
              onSuccess: () =>
                openTabAndNavigate({
                  id: 'page:/workspace',
                  title: 'Workspace',
                  type: 'page',
                  href: '/workspace',
                }),
            });
          }}
          cta={tabCTA[tab]}
        />
      )}

      {/* ── Pre-mounted tab bodies ─────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        <TabPanel active={tab === 'overview' && !openIssueId}>
          <ProjectOverview
            project={project}
            tasks={taskList}
            sessions={sessionList}
            agents={agentList}
            onUpdateProject={(data) => updateProject.mutate({ id: project.id, ...data })}
            isUpdating={updateProject.isPending}
            onJumpToIssues={() => setTab('issues')}
          />
        </TabPanel>

        <TabPanel active={tab === 'issues' && !openIssueId}>
          <IssuesTab
            tasks={taskList}
            filteredTasks={filteredTasks}
            view={view}
            setView={setView}
            quickFilter={quickFilter}
            setQuickFilter={setQuickFilter}
            search={search}
            setSearch={setSearch}
            searchRef={searchRef}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            sortKey={sortKey}
            setSortKey={setSortKey}
            onUpdateStatus={(id, s) => updateTask.mutate({ id, status: s })}
            onOpenIssue={openIssue}
            onNewIssue={openNewIssue}
            hasFilters={hasFilters}
            clearFilters={() => {
              setSearch('');
              setStatusFilter(new Set());
            }}
          />
        </TabPanel>

        <TabPanel active={tab === 'issues' && !!openIssueId}>
          {openIssueId && (
            <IssueDetailView
              taskId={openIssueId}
              onClose={closeIssue}
              embedded
              projectName={project.name}
            />
          )}
        </TabPanel>

        <TabPanel active={tab === 'files'}>
          {hasFiles ? (
            <div className="flex-1 min-h-0">
              <FilesStoreProvider store={projectFilesStore}>
                <FileExplorerPage />
              </FilesStoreProvider>
            </div>
          ) : (
            <EmptyState text="No project path configured" />
          )}
        </TabPanel>

        <TabPanel active={tab === 'sessions'}>
          <SessionsList sessions={sessionList} />
        </TabPanel>
      </div>

      {/* New issue dialog — always mounted */}
      <NewIssueDialog
        open={newIssueOpen}
        onOpenChange={setNewIssueOpen}
        projectId={project.id}
        projectName={project.name}
        defaultStatus={newIssueDefault}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Tiny helpers
// ───────────────────────────────────────────────────────────────

function TabPanel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('absolute inset-0 flex flex-col overflow-hidden', !active && 'hidden')}>
      {children}
    </div>
  );
}

function SessionsList({ sessions }: { sessions: any[] }) {
  if (sessions.length === 0)
    return <EmptyState text="No sessions linked" sub="Sessions appear here when you select this project" />;

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-8">
        <ul className="divide-y divide-border border-y border-border">
          {sessions.map((s: any) => (
            <li key={s.id}>
              <button
                onClick={() =>
                  openTabAndNavigate({
                    id: s.id,
                    title: s.title || 'Session',
                    type: 'session',
                    href: `/sessions/${s.id}`,
                  })
                }
                className="flex items-center w-full h-12 gap-3 hover:bg-muted/20 transition-colors cursor-pointer text-left px-2 -mx-2 rounded-md"
              >
                <MessageSquare className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                <span className="text-[13px] text-foreground/85 truncate flex-1">
                  {s.title || 'Untitled session'}
                </span>
                <span className="text-[11px] text-muted-foreground/40 tabular-nums shrink-0">
                  {relativeTime(s.time?.updated)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="text-[13px] text-muted-foreground">{text}</p>
        {sub && <p className="text-[12px] text-muted-foreground/50 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1100px] mx-auto px-6 lg:px-10 pt-12">
        <Skeleton className="h-3 w-24 rounded mb-6" />
        <Skeleton className="h-9 w-2/3 rounded mb-3" />
        <Skeleton className="h-4 w-3/4 rounded mb-2" />
        <Skeleton className="h-4 w-1/2 rounded mb-8" />
        <div className="flex gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-6 w-16 rounded" />
          ))}
        </div>
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    </div>
  );
}
