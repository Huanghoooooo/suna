'use client';

/**
 * TaskDetailView — modal dialog matching the New Task dialog style.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  CircleDashed,
  Play,
  CheckCircle2,
  AlertOctagon,
  Trash2,
  ExternalLink,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InlineTextEditor } from '@/components/ui/inline-text-editor';
import {
  useKortixTask,
  useKortixTaskEvents,
  useKortixTaskRuns,
  useKortixTaskStatus,
  useUpdateKortixTask,
  useStartKortixTask,
  useApproveKortixTask,
  useDeleteKortixTask,
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
  taskId: string | null;
  onClose: () => void;
  projectName?: string;
  pollingEnabled?: boolean;
}

export function TaskDetailView({
  taskId,
  onClose,
  projectName: projectNameOverride,
  pollingEnabled = true,
}: TaskDetailViewProps) {
  const { data: task, isLoading } = useKortixTask(taskId || '', {
    enabled: !!taskId && pollingEnabled,
    pollingEnabled: !!taskId && pollingEnabled,
  });
  const { data: events } = useKortixTaskEvents(taskId || '', {
    enabled: !!taskId && pollingEnabled,
    pollingEnabled: !!taskId && pollingEnabled,
  });
  const { data: runs } = useKortixTaskRuns(taskId || '', {
    enabled: !!taskId && pollingEnabled,
    pollingEnabled: !!taskId && pollingEnabled,
  });
  const { data: liveStatus } = useKortixTaskStatus(taskId || '', {
    enabled: !!taskId && pollingEnabled,
    pollingEnabled: !!taskId && pollingEnabled,
  });
  const { data: project } = useKortixProject(task?.project_id || '');
  const updateTask = useUpdateKortixTask();
  const startTask = useStartKortixTask();
  const approveTask = useApproveKortixTask();
  const deleteTaskMutation = useDeleteKortixTask();

  const [titleVal, setTitleVal] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [descVal, setDescVal] = useState('');
  const [verVal, setVerVal] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (task) {
      setTitleVal(task.title);
      setDescVal(task.description || '');
      setVerVal(task.verification_condition || '');
    }
  }, [task?.id, task?.title, task?.description, task?.verification_condition]);

  const projectName = projectNameOverride || project?.name;

  const saveTitle = () => {
    if (!task) return;
    const v = titleVal.trim();
    if (v && v !== task.title) updateTask.mutate({ id: task.id, title: v });
    setEditingTitle(false);
  };
  const commitDesc = () => {
    if (!task) return;
    const v = descVal.trim();
    if (v !== (task.description || '')) updateTask.mutate({ id: task.id, description: v });
  };
  const commitVer = () => {
    if (!task) return;
    const v = verVal.trim();
    if (v !== (task.verification_condition || '')) updateTask.mutate({ id: task.id, verification_condition: v });
  };

  return (
    <>
      <Dialog open={!!taskId} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent
          hideCloseButton
          className="sm:max-w-[680px] max-h-[85vh] p-0 gap-0 rounded-2xl border-border shadow-2xl overflow-hidden flex flex-col"
        >
          <DialogTitle className="sr-only">{task?.title || 'Task'}</DialogTitle>
          <DialogDescription className="sr-only">Task detail</DialogDescription>

          {!task && isLoading ? (
            <div className="flex items-center justify-center py-20">
              <CircleDashed className="h-6 w-6 text-muted-foreground/20 animate-spin" />
            </div>
          ) : !task ? (
            <div className="flex items-center justify-center flex-col gap-3 py-16">
              <CircleDashed className="h-6 w-6 text-muted-foreground/10" />
              <p className="text-sm text-muted-foreground/40">Task not found</p>
            </div>
          ) : (
            <>
              {/* ── Header ─────────────────────────────────── */}
              <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-foreground tracking-tight">
                    {projectName || 'KORTIX'}
                  </span>
                  <span className="text-muted-foreground/40">›</span>
                  <span className="text-muted-foreground font-mono text-[12px]">
                    {shortTaskId(task.id)}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground/30 hover:text-foreground"
                    onClick={() => setDeleteOpen(true)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                    onClick={onClose}
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* ── Title (editable) ───────────────────────── */}
              <div className="px-5 pt-2 pb-3">
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
                    className="w-full text-[22px] font-semibold bg-transparent border-0 outline-none text-foreground tracking-tight leading-tight"
                  />
                ) : (
                  <button
                    onClick={() => setEditingTitle(true)}
                    className="block w-full text-left text-[22px] font-semibold text-foreground tracking-tight leading-tight hover:text-foreground/80 transition-colors cursor-text"
                  >
                    {task.title}
                  </button>
                )}
              </div>


              {/* ── Scrollable body ─────────────────────────── */}
              <div className="flex-1 overflow-y-auto min-h-0">

              {/* ── Worker session ──────────────────────────── */}
              {task.owner_session_id && (
                <div className="px-5 pb-3">
                  <button
                    onClick={() => {
                      openTabAndNavigate({
                        id: task.owner_session_id!,
                        title: task.title || 'Worker session',
                        type: 'session',
                        href: `/sessions/${task.owner_session_id}`,
                      });
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-border/40 hover:bg-muted/30 hover:border-border transition-colors cursor-pointer group"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-foreground/60 shrink-0" />
                    <span className="text-[13px] text-foreground/70 group-hover:text-foreground flex-1 text-left">
                      Worker session
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/25">
                      {task.owner_session_id.slice(-12)}
                    </span>
                  </button>
                </div>
              )}

              {/* ── Result (prominent when available) ────────── */}
              {task.result && (
                <div className="px-5 pb-3">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-400 font-semibold">
                      Result
                    </span>
                    <pre className="mt-2 text-[13px] text-foreground/85 whitespace-pre-wrap leading-relaxed">
                      {task.result}
                    </pre>
                    {task.verification_summary && (
                      <>
                        <span className="block mt-3 text-[11px] uppercase tracking-[0.08em] text-emerald-600/60 dark:text-emerald-400/60 font-semibold">
                          Verification
                        </span>
                        <pre className="mt-1 text-[12px] text-foreground/70 whitespace-pre-wrap leading-relaxed">
                          {task.verification_summary}
                        </pre>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── Blocking question ───────────────────────── */}
              {task.blocking_question && (
                <div className="px-5 pb-3">
                  <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3">
                    <AlertOctagon className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[13px] text-foreground/85 leading-relaxed whitespace-pre-wrap">
                      {task.blocking_question}
                    </p>
                  </div>
                </div>
              )}

              {liveStatus && (
                <div className="px-5 pb-4">
                  <div className="rounded-xl border border-border/40 bg-muted/[0.18] p-4">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60 font-semibold">
                      Live status
                    </span>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                      <div>
                        <div className="text-muted-foreground/60">Status</div>
                        <div className="font-medium text-foreground/85">{liveStatus.status}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground/60">Run status</div>
                        <div className="font-medium text-foreground/85">{liveStatus.run_status || '—'}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground/60">Worker session</div>
                        <div className="font-medium text-foreground/85 break-all">
                          {liveStatus.owner_session_id || '—'}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-[12px] text-foreground/70 leading-relaxed whitespace-pre-wrap">
                      {liveStatus.detail}
                    </p>
                  </div>
                </div>
              )}

              {/* ── Event timeline ──────────────────────────── */}
              {events && events.length > 0 && (
                <div className="px-5 pb-4">
                  <div className="rounded-xl border border-border/40 bg-muted/[0.18] p-4">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60 font-semibold">
                      Timeline
                    </span>
                    <div className="mt-3 space-y-2">
                      {events.slice(0, 12).map((event) => (
                        <div key={event.id} className="rounded-lg border border-border/30 bg-background/60 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                              {event.type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[11px] text-muted-foreground/50">
                              {relativeTime(event.created_at)}
                            </span>
                          </div>
                          {event.message && (
                            <p className="mt-1 text-[12px] text-foreground/75 whitespace-pre-wrap leading-relaxed">
                              {event.message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {runs && runs.length > 0 && (
                <div className="px-5 pb-4">
                  <div className="rounded-xl border border-border/40 bg-muted/[0.18] p-4">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60 font-semibold">
                      Runs
                    </span>
                    <div className="mt-3 space-y-2">
                      {runs.slice(0, 6).map((run) => (
                        <div key={run.id} className="rounded-lg border border-border/30 bg-background/60 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                              {run.status}
                            </span>
                            <span className="text-[11px] text-muted-foreground/50">
                              {relativeTime(run.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-[12px] text-foreground/65 font-mono break-all">
                            {run.id}
                          </p>
                          {run.owner_session_id && (
                            <p className="mt-1 text-[12px] text-foreground/70">
                              Session: {run.owner_session_id}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Content (description + verification) ────── */}
              <div className="px-5 pt-1 pb-4 space-y-3">
                <InlineTextEditor
                  value={descVal}
                  onChange={setDescVal}
                  onCommit={commitDesc}
                  placeholder="Add description…"
                />

                {verVal ? (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/50 font-semibold">
                        Verification condition
                      </span>
                    </div>
                    <InlineTextEditor
                      value={verVal}
                      onChange={setVerVal}
                      onCommit={commitVer}
                      placeholder="How will we know this task is actually done?"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setVerVal(' ')}
                    className="text-[11px] text-muted-foreground/40 hover:text-foreground font-medium transition-colors cursor-pointer"
                  >
                    + Add verification condition
                  </button>
                )}
              </div>

              </div>{/* end scrollable body */}

              {/* ── Footer: status + time + action ─────────── */}
              <div className="border-t border-border px-5 py-3 flex items-center gap-3 bg-muted/15 rounded-b-2xl">
                <StatusPill status={task.status} onChange={() => {}} variant="pill" className="pointer-events-none" />
                <span className="text-[11px] text-muted-foreground/30" title={fullDate(task.updated_at)}>
                  {relativeTime(task.updated_at)}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {task.status === 'todo' && (
                    <Button
                      size="sm"
                      className="h-8 px-4 gap-1.5"
                      onClick={() => startTask.mutate({ id: task.id, session_id: project?.manager_session_id || undefined })}
                    >
                      <Play className="h-3 w-3" />
                      Start task
                    </Button>
                  )}
                  {(task.status === 'input_needed' || task.status === 'awaiting_review') && (
                    <Button
                      size="sm"
                      className="h-8 px-4 gap-1.5"
                      onClick={() => approveTask.mutate(task.id)}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Approve
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {task && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete task"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">&quot;{task.title}&quot;</span>?</>}
          confirmLabel="Delete"
          onConfirm={() => deleteTaskMutation.mutate(task.id, { onSuccess: () => { setDeleteOpen(false); onClose(); } })}
          isPending={deleteTaskMutation.isPending}
        />
      )}
    </>
  );
}
