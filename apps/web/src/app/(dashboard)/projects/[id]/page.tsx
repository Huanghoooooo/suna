'use client';

/**
 * Project page — Vercel-grade.
 *
 * Thin orchestrator. All real UI lives in extracted components:
 *   • <ProjectHeader>     — identity, meta, tabs, new task CTA
 *   • <TasksTab>          — kanban / list with toolbar
 *   • <ProjectOverview>   — context + history
 *   • <FileExplorerPage>  — files
 *   • <SessionsTab>       — inline sessions list
 *   • <TaskDetailView>    — in-tab task detail (no new tabs)
 *
 * All four tabs are PRE-MOUNTED and CSS-hidden when inactive — switching
 * is instant, no skeleton flash.
 */

import { use, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FolderGit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useKortixProject,
  useKortixProjectSessions,
  useUpdateProject,
} from '@/hooks/kortix/use-kortix-projects';
import {
  useKortixTasks,
  useUpdateKortixTask,
  useStartKortixTask,
  useApproveKortixTask,
  useDeleteKortixTask,
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
  TasksTab,
  type TaskView,
  type SortKey,
} from '@/components/kortix/tasks-tab';
import { TaskDetailView } from '@/components/kortix/task-detail-view';
import { NewTaskDialog } from '@/components/kortix/new-task-dialog';

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
  const updateProject = useUpdateProject();
  const updateTask = useUpdateKortixTask();
  const startTask = useStartKortixTask();
  const approveTask = useApproveKortixTask();
  const deleteTask = useDeleteKortixTask();

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
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const setTab = useCallback((next: ProjectTab) => {
    setTabState(next);
    setOpenTaskId(null);
  }, []);
  const openTask = useCallback((task: KortixTask) => {
    setOpenTaskId(task.id);
    setTabState('tasks');
  }, []);
  const closeTask = useCallback(() => setOpenTaskId(null), []);

  // Re-navigate file explorer when files tab activated
  useEffect(() => {
    if (tab === 'files' && project?.path && project.path !== '/') {
      projectFilesStore.getState().navigateToPath(project.path);
    }
  }, [tab, project?.path, projectFilesStore]);

  // ── Tasks view state ────────────────────────────────────────
  const [view, setView] = useState<TaskView>('board');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<KortixTaskStatus>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const searchRef = useRef<HTMLInputElement>(null);

  // ── New task dialog ─────────────────────────────────────────
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDefault, setNewTaskDefault] = useState<KortixTaskStatus | undefined>();
  const openNewTask = useCallback((status?: KortixTaskStatus) => {
    setNewTaskDefault(status);
    setNewTaskOpen(true);
  }, []);

  // ── Filtered tasks ──────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    let out = taskList;
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
  }, [taskList, search, statusFilter, sortKey]);

  // ── Keyboard shortcuts (tasks tab only) ─────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA';
      if (e.key === '/' && tab === 'tasks' && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (
        (e.key === 'c' || e.key === 'C') &&
        !inField &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        setNewTaskOpen(true);
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

  return (
    <div className="flex-1 bg-background flex flex-col overflow-hidden">
      <ProjectHeader
        project={project}
        tab={tab}
        onTabChange={setTab}
        onNewTask={() => openNewTask()}
      />

      {/* ── Pre-mounted tab bodies ─────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        <TabPanel active={tab === 'overview' && !openTaskId}>
          <ProjectOverview
            project={project}
            tasks={taskList}
            sessions={sessionList}
            agents={agentList}
            onUpdateProject={(data) => updateProject.mutate({ id: project.id, ...data })}
            isUpdating={updateProject.isPending}
            onJumpToTasks={() => setTab('tasks')}
          />
        </TabPanel>

        <TabPanel active={tab === 'tasks' && !openTaskId}>
          <TasksTab
            tasks={taskList}
            filteredTasks={filteredTasks}
            view={view}
            setView={setView}
            search={search}
            setSearch={setSearch}
            searchRef={searchRef}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            sortKey={sortKey}
            setSortKey={setSortKey}
            onUpdateStatus={(id, s) => updateTask.mutate({ id, status: s })}
            onStartTask={(id) => startTask.mutate({ id })}
            onApproveTask={(id) => approveTask.mutate(id)}
            onOpenTask={openTask}
            onNewTask={openNewTask}
            onDeleteTask={(id) => deleteTask.mutate(id)}
            hasFilters={hasFilters}
            clearFilters={() => {
              setSearch('');
              setStatusFilter(new Set());
            }}
          />
        </TabPanel>

        <TabPanel active={tab === 'tasks' && !!openTaskId}>
          {openTaskId && (
            <TaskDetailView
              taskId={openTaskId}
              onClose={closeTask}
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

      {/* New task dialog — always mounted */}
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={project.id}
        projectName={project.name}
        defaultStatus={newTaskDefault}
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
      <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-4">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Session</TableHead>
              <TableHead className="w-[90px] text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s: any) => (
              <TableRow
                key={s.id}
                onClick={() =>
                  openTabAndNavigate({
                    id: s.id,
                    title: s.title || 'Session',
                    type: 'session',
                    href: `/sessions/${s.id}`,
                  })
                }
                className="cursor-pointer group"
              >
                <TableCell className="text-[13px] text-foreground/85 truncate max-w-0 group-hover:text-foreground">
                  {s.title || 'Untitled session'}
                </TableCell>
                <TableCell className="text-[11px] text-muted-foreground/35 tabular-nums text-right">
                  {relativeTime(s.time?.updated)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
