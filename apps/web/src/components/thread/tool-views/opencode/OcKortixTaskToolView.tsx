'use client';

/**
 * Renderer for Kortix task tools:
 * task_create, task_list, task_get, task_start, task_update,
 * task_comment, task_question, task_deliver, task_done, task_delete
 */

import React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  ListTodo,
  Play,
  MessageSquare,
  HelpCircle,
  Package,
  Trash2,
  CircleDot,
  Pencil,
} from 'lucide-react';
import type { ToolViewProps } from '../types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ToolViewIconTitle } from '../shared/ToolViewIconTitle';
import { ToolViewFooter } from '../shared/ToolViewFooter';
import { LoadingState } from '../shared/LoadingState';
import { UnifiedMarkdown } from '@/components/markdown/unified-markdown';

/** Map tool function name → display config */
const TOOL_CONFIG: Record<string, { icon: typeof ListTodo; label: string; verb: string }> = {
  task_create:   { icon: ListTodo,       label: 'Create Task',     verb: 'Creating task' },
  task_list:     { icon: ListTodo,       label: 'List Tasks',      verb: 'Listing tasks' },
  task_get:      { icon: CircleDot,      label: 'Get Task',        verb: 'Reading task' },
  task_start:    { icon: Play,           label: 'Start Task',      verb: 'Starting task' },
  task_update:   { icon: Pencil,         label: 'Update Task',     verb: 'Updating task' },
  task_comment:  { icon: MessageSquare,  label: 'Task Comment',    verb: 'Commenting' },
  task_question: { icon: HelpCircle,     label: 'Task Question',   verb: 'Asking question' },
  task_deliver:  { icon: Package,        label: 'Deliver Task',    verb: 'Delivering result' },
  task_done:     { icon: CheckCircle2,   label: 'Task Done',       verb: 'Completing task' },
  task_delete:   { icon: Trash2,         label: 'Delete Task',     verb: 'Deleting task' },
};

function getToolName(toolCall: any): string {
  const name = toolCall?.function_name || '';
  // Strip oc- prefix and normalize underscores/dashes
  return name.replace(/^oc-/, '').replace(/-/g, '_');
}

export function OcKortixTaskToolView({
  toolCall,
  toolResult,
  assistantTimestamp,
  toolTimestamp,
  isSuccess = true,
  isStreaming = false,
}: ToolViewProps) {
  const toolName = getToolName(toolCall);
  const config = TOOL_CONFIG[toolName] || { icon: ListTodo, label: 'Task', verb: 'Processing' };
  const Icon = config.icon;

  const args = toolCall?.arguments || {};
  const ocState = (args as any)?._oc_state;
  const rawOutput = toolResult?.output || ocState?.output || '';
  const output = typeof rawOutput === 'string' ? rawOutput : String(rawOutput);
  const isError = toolResult?.success === false || !!toolResult?.error;

  // Extract key args for subtitle
  const taskId = (args.id as string) || '';
  const title = (args.title as string) || '';
  const subtitle = title || taskId || '';

  if (isStreaming && !toolResult) {
    return <LoadingState title={config.verb} subtitle={subtitle} />;
  }

  return (
    <Card className="gap-0 flex border-0 shadow-none p-0 py-0 rounded-none flex-col h-full overflow-hidden bg-card">
      <CardHeader className="h-14 bg-muted/50 backdrop-blur-sm border-b p-2 px-4 space-y-2">
        <div className="flex flex-row items-center justify-between">
          <ToolViewIconTitle
            icon={Icon}
            title={config.label}
            subtitle={subtitle}
          />
          {!isStreaming && (
            <Badge
              variant={isError ? 'destructive' : 'secondary'}
              className="h-6 py-0.5"
            >
              {isError ? (
                <><AlertCircle className="h-3 w-3 mr-1" />Error</>
              ) : (
                <><CheckCircle2 className="h-3 w-3 mr-1" />Done</>
              )}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 h-full flex-1 overflow-hidden">
        {output ? (
          <div className="px-4 py-3 text-sm overflow-auto max-h-[300px]">
            <UnifiedMarkdown content={output} />
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No output
          </div>
        )}
      </CardContent>
      <ToolViewFooter
        assistantTimestamp={assistantTimestamp}
        toolTimestamp={toolTimestamp}
        isStreaming={isStreaming}
      />
    </Card>
  );
}
