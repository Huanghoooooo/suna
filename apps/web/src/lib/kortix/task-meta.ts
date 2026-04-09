/**
 * Single source of truth for task status & priority presentation.
 *
 * Mirrors the canonical task model defined in
 * suna/core/kortix-master/opencode/plugin/kortix-system/tasks.ts
 */

import {
  CircleDashed,
  Circle,
  CircleDot,
  CircleDotDashed,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { KortixTaskStatus } from '@/hooks/kortix/use-kortix-tasks';

export interface StatusMeta {
  icon: LucideIcon;
  color: string;
  bg: string;
  border: string;
  label: string;
  /** Display order for grouping/columns */
  order: number;
  /** True for "open / active" — used for stats */
  active?: boolean;
  /** True for done-like terminal states */
  terminal?: boolean;
}

export const STATUS_META: Record<KortixTaskStatus, StatusMeta> = {
  backlog: {
    icon: CircleDashed,
    color: 'text-muted-foreground/60',
    bg: 'bg-muted/30',
    border: 'border-border',
    label: 'Backlog',
    order: 0,
  },
  todo: {
    icon: Circle,
    color: 'text-muted-foreground/80',
    bg: 'bg-muted/40',
    border: 'border-border',
    label: 'Todo',
    order: 1,
    active: true,
  },
  in_progress: {
    icon: CircleDot,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    label: 'In Progress',
    order: 2,
    active: true,
  },
  in_review: {
    icon: CircleDotDashed,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    label: 'In Review',
    order: 3,
    active: true,
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    label: 'Completed',
    order: 4,
    terminal: true,
  },
  cancelled: {
    icon: XCircle,
    color: 'text-muted-foreground/40',
    bg: 'bg-muted/20',
    border: 'border-border',
    label: 'Cancelled',
    order: 5,
    terminal: true,
  },
};

/** Statuses that appear as kanban columns, in left→right order. */
export const KANBAN_COLUMNS: KortixTaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'completed',
];

/**
 * Valid next statuses for each status. Enforces the lifecycle:
 *   backlog → todo → [START] → in_progress → in_review → [APPROVE] → completed
 * in_progress is only reachable via START action.
 * completed is only reachable via APPROVE action from in_review.
 * cancelled is always reachable.
 */
export const VALID_TRANSITIONS: Record<KortixTaskStatus, KortixTaskStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['backlog', 'cancelled'],                    // START → in_progress (separate action)
  in_progress: ['in_review', 'todo', 'cancelled'],   // agent moves to review when done
  in_review: ['todo', 'cancelled'],                   // APPROVE → completed (separate action)
  completed: [],                                      // terminal
  cancelled: ['backlog', 'todo'],                     // can be reopened
};

/** All statuses, full ordering for filters/menus. */
export const ALL_STATUSES: KortixTaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'completed',
  'cancelled',
];

/**
 * Legacy status names that may still exist on rows from the old schema.
 * Map them onto the canonical task model so the UI never crashes on old data.
 */
const LEGACY_STATUS_MAP: Record<string, KortixTaskStatus> = {
  pending: 'todo',
  open: 'todo',
  blocked: 'todo',
  info_needed: 'todo',
  failed: 'cancelled',
  done: 'completed',
  closed: 'completed',
  archived: 'cancelled',
};

/** Defensive lookup — never returns undefined. Maps legacy / unknown values. */
export function getStatusMeta(status: string | null | undefined): StatusMeta {
  if (!status) return STATUS_META.todo;
  if (status in STATUS_META) return STATUS_META[status as KortixTaskStatus];
  const mapped = LEGACY_STATUS_MAP[status];
  if (mapped) return STATUS_META[mapped];
  return STATUS_META.todo;
}

/** Resolves any (possibly legacy) status string to the canonical enum. */
export function normalizeStatus(status: string | null | undefined): KortixTaskStatus {
  if (!status) return 'todo';
  if (status in STATUS_META) return status as KortixTaskStatus;
  return LEGACY_STATUS_MAP[status] || 'todo';
}


/** Linear-style short ID — KTX-XXXX from the trailing chars of the task id. */
export function shortTaskId(id: string): string {
  const tail = id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
  return `KTX-${tail || '0000'}`;
}

export function relativeTime(t?: string | number | null): string {
  if (!t) return '';
  const ms = Date.now() - (typeof t === 'string' ? +new Date(t) : t);
  const m = (ms / 60000) | 0;
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = (m / 60) | 0;
  if (h < 24) return `${h}h ago`;
  const d = (h / 24) | 0;
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fullDate(t?: string | null): string {
  if (!t) return '';
  return new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
