'use client';

/**
 * TaskDetailView — 50/50 split layout.
 *
 *   ┌──────────────────────┬──────────────────────┐
 *   │ ← Back   KTX-1234   │  ACTIVITY             │
 *   │ Task title           │                       │
 *   ├──────────────────────│  [timeline scrolls]   │
 *   │ Properties row       │                       │
 *   │ Description          │                       │
 *   │ Verification         │                       │
 *   │ Result               │───────────────────────│
 *   │ (scrolls)            │  [fixed comment input]│
 *   └──────────────────────┴──────────────────────┘
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { InlineTextEditor } from '@/components/ui/inline-text-editor';
import {
  Loader2,
  CircleDashed,
  ArrowUp,
  User,
  Bot,
  Play,
  CheckCircle2,
  CheckSquare,
  AlertOctagon,
  ArrowLeft,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useKortixTask,
  useUpdateKortixTask,
  useStartKortixTask,
  useApproveKortixTask,
  useDeleteKortixTask,
  useKortixTaskComments,
  useAddKortixTaskComment,
  type KortixTaskComment,
} from '@/hooks/kortix/use-kortix-tasks';
import { useKortixProject } from '@/hooks/kortix/use-kortix-projects';
import { openTabAndNavigate } from '@/stores/tab-store';
import { StatusPill } from '@/components/kortix/task-pills';
import {
  shortTaskId,
  relativeTime,
  fullDate,
} from '@/lib/kortix/task-meta';

export interface TaskDetailViewProps {
  taskId: string;
  onClose?: () => void;
  embedded?: boolean;
  projectName?: string;
}

export function TaskDetailView({
  taskId,
  onClose,
  embedded,
  projectName: projectNameOverride,
}: TaskDetailViewProps) {
  const { data: task, isLoading } = useKortixTask(taskId);
  const { data: project } = useKortixProject(task?.project_id || '');
  const { data: comments } = useKortixTaskComments(taskId);
  const updateTask = useUpdateKortixTask();
  const startTask = useStartKortixTask();
  const approveTask = useApproveKortixTask();
  const deleteTaskMutation = useDeleteKortixTask();
  const addComment = useAddKortixTaskComment();
  const activityEndRef = useRef<HTMLDivElement>(null);

  const [titleVal, setTitleVal] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [descVal, setDescVal] = useState('');
  const [verVal, setVerVal] = useState('');
  const [commentDraft, setCommentDraft] = useState('');

  useEffect(() => {
    if (task) {
      setTitleVal(task.title);
      setDescVal(task.description || '');
      setVerVal(task.verification_condition || '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.title, task?.description, task?.verification_condition]);

  // Auto-scroll activity to bottom on new comments
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments?.length]);

  const goToWorkspace = useCallback(() => {
    openTabAndNavigate({ id: 'page:/workspace', title: 'Workspace', type: 'page', href: '/workspace' });
  }, []);

  const goToProject = useCallback(() => {
    if (onClose) { onClose(); return; }
    if (!project) return;
    openTabAndNavigate({
      id: `project:${project.id}`, title: project.name, type: 'project',
      href: `/projects/${encodeURIComponent(project.id)}`,
    });
  }, [project, onClose]);

  if (isLoading && !task) return <TaskSkeleton />;
  if (!task)
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3">
        <CircleDashed className="h-12 w-12 text-muted-foreground/10" />
        <p className="text-sm font-medium text-muted-foreground/40">Task not found</p>
        <Button variant="ghost" size="sm" onClick={goToWorkspace}>Back to Workspace</Button>
      </div>
    );

  const projectName = projectNameOverride || project?.name;

  const saveTitle = () => {
    const v = titleVal.trim();
    if (v && v !== task.title) updateTask.mutate({ id: task.id, title: v });
    setEditingTitle(false);
  };
  const commitDesc = () => {
    const v = descVal.trim();
    if (v !== (task.description || '')) updateTask.mutate({ id: task.id, description: v });
  };
  const commitVer = () => {
    const v = verVal.trim();
    if (v !== (task.verification_condition || '')) updateTask.mutate({ id: task.id, verification_condition: v });
  };
  const submitComment = () => {
    const v = commentDraft.trim();
    if (!v) return;
    addComment.mutate(
      { task_id: task.id, body: v, author_role: 'user' },
      { onSuccess: () => setCommentDraft('') },
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ── Split body ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* ─── Left: Details ────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto lg:border-r border-border/40">
          <div className="max-w-[640px] px-4 sm:px-6 lg:px-8 py-5">
            {/* Back + ID + Delete */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={embedded ? onClose : goToProject}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3 w-3" />
                {embedded ? 'Back' : (projectName || 'Back')}
              </button>
              <span className="text-[11px] font-mono text-muted-foreground/25">
                {shortTaskId(task.id)}
              </span>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground/30 hover:text-destructive"
                  title="Delete task"
                  onClick={() => {
                    if (!confirm('Delete this task?')) return;
                    deleteTaskMutation.mutate(task.id, { onSuccess: () => goToProject() });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Title */}
            <div className="mb-5">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleVal}
                  onChange={(e) => setTitleVal(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setTitleVal(task.title); setEditingTitle(false); }
                    if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
                  }}
                  className="w-full text-[20px] font-semibold bg-transparent border-0 outline-none text-foreground tracking-tight"
                />
              ) : (
                <button
                  onClick={() => setEditingTitle(true)}
                  className="block w-full text-left text-[20px] font-semibold text-foreground tracking-tight hover:text-foreground/80 transition-colors cursor-text"
                >
                  {task.title}
                </button>
              )}
            </div>

            {/* Properties */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-5 mb-5 border-b border-border/40">
              <PropInline label="Status">
                <StatusPill status={task.status} onChange={() => {}} variant="pill" className="pointer-events-none" />
              </PropInline>
              {/* Start button — only on todo tasks */}
              {task.status === 'todo' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[12px] gap-1.5"
                  onClick={() => startTask.mutate({ id: task.id })}
                >
                  <Play className="h-3 w-3" />
                  Start task
                </Button>
              )}
              {/* Approve button — only on in_review tasks */}
              {task.status === 'in_review' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[12px] gap-1.5 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={() => approveTask.mutate(task.id)}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Approve
                </Button>
              )}
              {projectName && (
                <PropInline label="Project">
                  <button onClick={goToProject} className="text-[13px] text-foreground/80 hover:text-foreground transition-colors cursor-pointer">
                    {projectName}
                  </button>
                </PropInline>
              )}
              {task.owner_session_id && (
                <PropInline label="Owner">
                  <button
                    onClick={() => openTabAndNavigate({
                      id: task.owner_session_id!, title: 'Owner session', type: 'session',
                      href: `/sessions/${task.owner_session_id}`,
                    })}
                    className="inline-flex items-center gap-1.5 text-[13px] text-foreground/80 hover:text-foreground transition-colors cursor-pointer"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {task.owner_agent || 'session'}
                  </button>
                </PropInline>
              )}
              <PropInline label="Updated">
                <span className="text-[13px] text-muted-foreground/50" title={fullDate(task.updated_at)}>
                  {relativeTime(task.updated_at)}
                </span>
              </PropInline>
            </div>

            {/* Description */}
            <div className="mb-5">
              <SectionLabel>Description</SectionLabel>
              <InlineTextEditor
                value={descVal}
                onChange={setDescVal}
                onCommit={commitDesc}
                placeholder="Add a description…"
              />
            </div>

            {/* Verification condition */}
            <div className="mb-5">
              <SectionLabel>Verification condition</SectionLabel>
              <InlineTextEditor
                value={verVal}
                onChange={setVerVal}
                onCommit={commitVer}
                placeholder="How will we know this task is actually done?"
              />
            </div>

            {/* Result */}
            {task.result && (
              <div className="mb-5">
                <SectionLabel>Result</SectionLabel>
                <pre className="text-[12px] text-foreground/85 bg-muted/20 border border-border/60 rounded-xl p-4 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                  {task.result}
                </pre>
              </div>
            )}

            {/* Verification summary */}
            {task.verification_summary && (
              <div className="mb-5">
                <SectionLabel>Verification summary</SectionLabel>
                <pre className="text-[12px] text-foreground/85 bg-emerald-500/[0.04] border border-emerald-500/20 rounded-xl p-4 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                  {task.verification_summary}
                </pre>
              </div>
            )}

            {/* Blocking question */}
            {task.blocking_question && (
              <div className="mb-5">
                <SectionLabel>Blocking question</SectionLabel>
                <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3">
                  <AlertOctagon className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[13px] text-foreground/85 leading-relaxed whitespace-pre-wrap">
                    {task.blocking_question}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right: Activity ──────────────────────────── */}
        <div className="lg:w-[400px] shrink-0 flex flex-col min-h-0 border-t lg:border-t-0 border-border/40">
          {/* Timeline — scrollable */}
          <div className="flex-1 overflow-y-auto px-5 pt-5 pb-4">
            <SectionLabel>Activity</SectionLabel>
            <ActivityTimeline task={task} comments={comments ?? []} />
            <div ref={activityEndRef} />
          </div>

          {/* Fixed comment input — session chat style */}
          <div className="shrink-0 px-4 pb-4">
            <div className="bg-card border border-border rounded-2xl overflow-hidden transition-colors focus-within:border-primary/30">
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitComment();
                  }
                }}
                placeholder="Leave a comment…"
                rows={2}
                className="w-full text-[13px] bg-transparent border-0 outline-none resize-none placeholder:text-muted-foreground/40 text-foreground/90 leading-relaxed px-4 pt-3 pb-1"
              />
              <div className="flex items-center justify-end px-3 pb-2.5">
                <Button
                  size="icon"
                  onClick={submitComment}
                  disabled={!commentDraft.trim() || addComment.isPending}
                  className="h-7 w-7 rounded-full"
                >
                  {addComment.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/40 font-semibold mb-2">
      {children}
    </h3>
  );
}

function PropInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground/40 font-medium">{label}</span>
      {children}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Activity timeline
// ───────────────────────────────────────────────────────────────

interface LifecycleEvent {
  kind: 'created' | 'started' | 'completed';
  at: string;
}

function lifecycleEvents(task: any): LifecycleEvent[] {
  const out: LifecycleEvent[] = [];
  if (task.created_at) out.push({ kind: 'created', at: task.created_at });
  if (task.started_at) out.push({ kind: 'started', at: task.started_at });
  if (task.completed_at) out.push({ kind: 'completed', at: task.completed_at });
  return out;
}

function ActivityTimeline({ task, comments }: { task: any; comments: KortixTaskComment[] }) {
  const events: Array<
    | (LifecycleEvent & { kind: LifecycleEvent['kind'] })
    | { kind: 'comment'; at: string; body: string; role: string }
  > = [
    ...lifecycleEvents(task),
    ...comments.map((c) => ({
      kind: 'comment' as const,
      at: c.created_at,
      body: c.body,
      role: c.author_role,
    })),
  ].sort((a, b) => +new Date(a.at) - +new Date(b.at));

  if (events.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground/25 text-center py-8">No activity yet</p>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((e, i) => {
        if (e.kind === 'comment') {
          const isOwner = e.role === 'owner' || e.role === 'agent';
          return (
            <div key={i} className="flex gap-3 py-3">
              <div
                className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center shrink-0',
                  isOwner ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05] text-muted-foreground',
                )}
              >
                {isOwner ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[12px] font-medium text-foreground">
                    {isOwner ? 'Agent' : e.role || 'You'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/30 tabular-nums" title={fullDate(e.at)}>
                    {relativeTime(e.at)}
                  </span>
                </div>
                <p className="text-[13px] text-foreground/70 leading-relaxed whitespace-pre-wrap">
                  {e.body}
                </p>
              </div>
            </div>
          );
        }
        const config = {
          created: { icon: CircleDashed, label: 'Task created' },
          started: { icon: Play, label: 'Execution started' },
          completed: { icon: CheckSquare, label: 'Task completed' },
        }[e.kind]!;
        const I = config.icon;
        return (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <div className="h-7 w-7 rounded-full bg-foreground/[0.03] flex items-center justify-center shrink-0">
              <I className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <span className="text-[12px] text-muted-foreground/50">{config.label}</span>
            <span className="text-[10px] text-muted-foreground/40 tabular-nums ml-auto" title={fullDate(e.at)}>
              {relativeTime(e.at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TaskSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="px-6 pt-6">
        <Skeleton className="h-3 w-20 mb-4" />
        <Skeleton className="h-6 w-2/3 mb-6" />
        <Skeleton className="h-px w-full mb-6" />
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}
