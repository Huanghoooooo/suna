'use client';

/**
 * Standalone /tasks/[id] route — used for direct URL access (copy-link,
 * deep-link from notifications, etc.). All actual UI lives in TaskDetailView,
 * which is also embedded inside the project page for in-tab navigation.
 */

import { use } from 'react';
import { TaskDetailView } from '@/components/kortix/task-detail-view';

export default function TaskDetailPage({ params }: { params?: Promise<{ id: string }> }) {
  const { id: raw } = params ? use(params) : { id: '' };
  const taskId = raw ? decodeURIComponent(raw) : '';
  return <TaskDetailView taskId={taskId} />;
}
