'use client';

/**
 * Project Overview — two-panel, viewport-filling layout.
 *
 *   ┌─────────────────────────────────┬──────────────────────────┐
 *   │                                 │                          │
 *   │  Context                        │  History                 │
 *   │  (renders .kortix/CONTEXT.md)   │  (task + session events) │
 *   │  click to edit inline           │                          │
 *   │                                 │                          │
 *   └─────────────────────────────────┴──────────────────────────┘
 */

import { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { cn } from '@/lib/utils';
import { UnifiedMarkdown } from '@/components/markdown';
import { useFileContent, useInvalidateFileContent } from '@/features/files/hooks/use-file-content';
import { uploadFile } from '@/features/files/api/opencode-files';
import {
  relativeTime,
  shortTaskId,
  STATUS_META,
} from '@/lib/kortix/task-meta';
import {
  FileText,
  MessageSquare,
  Loader2,
  AlertCircle,
  Pencil,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KortixTask, KortixTaskStatus } from '@/hooks/kortix/use-kortix-tasks';

interface ProjectOverviewProps {
  project: any;
  tasks: KortixTask[];
  sessions: any[];
  agents: any[];
  onUpdateProject: (data: { name?: string; description?: string }) => void;
  isUpdating?: boolean;
  onJumpToTasks: () => void;
}

export function ProjectOverview({
  project,
  tasks,
  sessions,
}: ProjectOverviewProps) {
  // ── CONTEXT.md file path ───────────────────────────────────
  const contextPath = project?.path && project.path !== '/'
    ? `${project.path.replace(/\/+$/, '')}/.kortix/CONTEXT.md`
    : null;

  const {
    data: contextFile,
    isLoading: contextLoading,
    error: contextError,
  } = useFileContent(contextPath, { staleTime: 30_000 });

  const invalidateContent = useInvalidateFileContent();
  const contextContent = contextFile?.type === 'text' ? contextFile.content : null;

  // ── Edit state ─────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEditing = useCallback(() => {
    setDraft(contextContent || '');
    setEditing(true);
  }, [contextContent]);

  // Auto-grow textarea
  useLayoutEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, draft]);

  // Focus textarea on edit start
  useEffect(() => {
    if (editing) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  }, [editing]);

  const saveContext = useCallback(async () => {
    if (!contextPath || draft === (contextContent || '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const parts = contextPath.split('/');
      const fileName = parts.pop() || 'CONTEXT.md';
      const dirPath = parts.join('/');
      const file = new File([draft], fileName, { type: 'text/markdown' });
      await uploadFile(file, dirPath);
      invalidateContent(contextPath);
    } catch {
      // silently fail — user can retry
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [contextPath, draft, contextContent, invalidateContent]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setDraft('');
  }, []);

  // ── History: merge tasks + sessions, sort by time ──────────
  const history = useMemo(() => {
    const items: HistoryEvent[] = [];

    for (const t of tasks) {
      items.push({
        id: `task-${t.id}`,
        type: 'task',
        label: t.title,
        detail: shortTaskId(t.id),
        status: t.status,
        time: t.updated_at,
      });
    }

    for (const s of sessions) {
      items.push({
        id: `session-${s.id}`,
        type: 'session',
        label: s.title || 'Untitled session',
        time: s.time?.updated || s.time?.created || s.created_at,
      });
    }

    items.sort((a, b) => +new Date(b.time || 0) - +new Date(a.time || 0));
    return items;
  }, [tasks, sessions]);

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-auto lg:overflow-hidden animate-in fade-in-0 duration-300 fill-mode-both">
      {/* ─── Left panel: Context ─────────────────────────── */}
      <div className="min-w-0 lg:flex-1 lg:overflow-y-auto lg:border-r border-border/40">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8">
          <div className="flex items-center gap-2 mb-6">
            <FileText className="h-3.5 w-3.5 text-muted-foreground/30" />
            <h2 className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground/50 font-semibold">
              Context
            </h2>
            <span className="text-[11px] text-muted-foreground/25 font-mono">.kortix/CONTEXT.md</span>

            <div className="ml-auto">
              {editing ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={cancelEditing}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-emerald-500 hover:text-emerald-400 gap-1 cursor-pointer"
                    onClick={saveContext}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground/40 hover:text-foreground gap-1 cursor-pointer"
                  onClick={startEditing}
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </div>
          </div>

          {contextLoading ? (
            <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground/40">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[13px]">Loading context...</span>
            </div>
          ) : editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEditing();
                }
                if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveContext();
                }
              }}
              spellCheck
              className={cn(
                'w-full min-h-[200px] resize-none overflow-hidden',
                'bg-transparent border border-border/40 rounded-lg outline-none',
                'text-[13px] text-foreground/85 leading-[1.7] font-mono',
                'placeholder:text-muted-foreground/30',
                'focus:border-primary/30 focus:ring-1 focus:ring-primary/20',
                'p-4 transition-colors',
              )}
              placeholder="# Project Context&#10;&#10;Describe what this project is about and how agents should work with it..."
            />
          ) : contextError || !contextContent ? (
            <button
              onClick={startEditing}
              className="w-full rounded-lg border border-dashed border-border/60 p-8 text-center hover:border-primary/30 hover:bg-primary/[0.02] transition-colors cursor-pointer group"
            >
              <AlertCircle className="h-5 w-5 text-muted-foreground/25 mx-auto mb-3 group-hover:text-primary/40 transition-colors" />
              <p className="text-[13px] text-muted-foreground/50 mb-1">
                No CONTEXT.md found
              </p>
              <p className="text-[12px] text-muted-foreground/30 max-w-[320px] mx-auto leading-relaxed">
                Click to create a <code className="font-mono text-[11px] bg-muted/30 px-1 py-0.5 rounded">.kortix/CONTEXT.md</code> — describe what this project is about and how agents should work with it.
              </p>
            </button>
          ) : (
            <article className="prose prose-sm dark:prose-invert max-w-none">
              <UnifiedMarkdown content={contextContent} />
            </article>
          )}
        </div>
      </div>

      {/* ─── Right panel: History ────────────────────────── */}
      <div className="lg:w-[360px] shrink-0 lg:overflow-y-auto border-t lg:border-t-0 border-border/40">
        <div className="px-5 pt-5 pb-8">
          <h2 className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/40 font-semibold mb-4">
            History
          </h2>

          {history.length === 0 ? (
            <p className="text-[13px] text-muted-foreground/25 text-center py-8">
              No activity yet
            </p>
          ) : (
            <div className="space-y-0">
              {history.map((event) => (
                <HistoryRow key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// History timeline
// ────────────────────────────────────────────────────────────────

interface HistoryEvent {
  id: string;
  type: 'task' | 'session';
  label: string;
  detail?: string;
  status?: KortixTaskStatus;
  time?: string;
}

function HistoryRow({ event }: { event: HistoryEvent }) {
  const statusMeta = event.status ? STATUS_META[event.status] : null;
  const Icon = statusMeta?.icon ?? MessageSquare;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="shrink-0 h-7 w-7 rounded-full bg-foreground/[0.03] flex items-center justify-center">
        <Icon className="h-3 w-3 text-muted-foreground/50" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-foreground/80 truncate leading-snug">
          {event.label}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {event.detail && (
            <span className="text-[10px] font-mono text-muted-foreground/40">
              {event.detail}
            </span>
          )}
          {statusMeta && (
            <span className="text-[10px] text-muted-foreground/40">
              {statusMeta.label}
            </span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0">
        {relativeTime(event.time)}
      </span>
    </div>
  );
}
