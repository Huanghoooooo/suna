'use client';

import React, { useMemo } from 'react';
import {
  CheckCircle,
  AlertCircle,
  Folder,
  Plus,
} from 'lucide-react';
import { ToolViewProps } from '../types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToolViewIconTitle } from '../shared/ToolViewIconTitle';
import { ToolViewFooter } from '../shared/ToolViewFooter';
import { LoadingState } from '../shared/LoadingState';
import { cn } from '@/lib/utils';

// ============================================================================
// Types & Parsing
// ============================================================================

interface ProjectCreateData {
  name: string;
  path: string;
  id: string;
  success: boolean;
}

function parseProjectCreateOutput(output: string): ProjectCreateData | null {
  if (!output || typeof output !== 'string') return null;

  // Format: Project **project-name** at `/path/to/project` (proj-xxx)
  const nameMatch = output.match(/Project\s+\*\*([^*]+)\*\*\s+at/i);
  const pathMatch = output.match(/at\s+`([^`]+)`/);
  const idMatch = output.match(/\((proj-[^)]+)\)/);
  const success = !!nameMatch && !output.toLowerCase().includes('failed');

  if (!nameMatch) return null;

  return {
    name: nameMatch[1],
    path: pathMatch?.[1] || '',
    id: idMatch?.[1] || '',
    success,
  };
}

// ============================================================================
// Component
// ============================================================================

export function OcProjectCreateToolView({
  toolCall,
  toolResult,
  assistantTimestamp,
  toolTimestamp,
  isSuccess = true,
  isStreaming = false,
}: ToolViewProps) {
  const args = toolCall?.arguments || {};
  const ocState = (args as any)._oc_state as any;
  const nameArg = (args.name as string) || (ocState?.input?.name as string) || 'New Project';
  const rawOutput = toolResult?.output || ocState?.output || '';
  const output = typeof rawOutput === 'string' ? rawOutput : String(rawOutput);
  const isError = toolResult?.success === false || !!toolResult?.error;

  const data = useMemo(() => parseProjectCreateOutput(output), [output]);

  if (isStreaming && !toolResult) {
    return <LoadingState title="Creating project" subtitle={nameArg || 'Setting up new project...'} />;
  }

  // If we couldn't parse the output or it was an error, show the raw output
  if (!data || isError) {
    return (
      <Card className="gap-0 flex border-0 shadow-none p-0 py-0 rounded-none flex-col h-full overflow-hidden bg-card">
        <CardHeader className="h-14 bg-muted/50 backdrop-blur-sm border-b p-2 px-4 space-y-2">
          <div className="flex flex-row items-center justify-between">
            <ToolViewIconTitle
              icon={Folder}
              title="Project Create"
              subtitle={nameArg || 'Failed'}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0 h-full flex-1 overflow-hidden">
          <div className="flex items-start gap-2.5 px-4 py-6 text-muted-foreground">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{output || 'Failed to create project'}</p>
          </div>
        </CardContent>
        <ToolViewFooter
          assistantTimestamp={assistantTimestamp}
          toolTimestamp={toolTimestamp}
          isStreaming={isStreaming}
        >
          <Badge variant="outline" className="h-6 py-0.5 bg-muted text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            Failed
          </Badge>
        </ToolViewFooter>
      </Card>
    );
  }

  return (
    <Card className="gap-0 flex border-0 shadow-none p-0 py-0 rounded-none flex-col h-full overflow-hidden bg-card">
      <CardHeader className="h-14 bg-muted/50 backdrop-blur-sm border-b p-2 px-4 space-y-2">
        <div className="flex flex-row items-center justify-between">
          <ToolViewIconTitle
            icon={Plus}
            title="Project Created"
            subtitle={data.name}
          />
          {data.success && (
            <Badge variant="outline" className="h-6 py-0.5 flex-shrink-0 ml-2">
              Ready
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 h-full flex-1 overflow-hidden">
        <div className="p-4 space-y-4">
          {/* Success indicator */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{data.name}</p>
              <p className="text-xs text-muted-foreground">项目创建成功</p>
            </div>
          </div>

          {/* Path */}
          {data.path && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70 bg-muted/30 rounded-lg p-3 font-mono">
              <Folder className="size-3.5 flex-shrink-0" />
              <span className="truncate" title={data.path}>{data.path}</span>
            </div>
          )}

          {/* Project ID */}
          {data.id && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
              <span>ID: <code className="bg-muted px-1 rounded text-[10px]">{data.id}</code></span>
            </div>
          )}

          {/* Scaffold created hint */}
          <div className="text-xs text-muted-foreground/60 bg-muted/20 rounded-lg p-3">
            Project scaffold created with .kortix directory and Git initialized
          </div>
        </div>
      </CardContent>

      <ToolViewFooter
        assistantTimestamp={assistantTimestamp}
        toolTimestamp={toolTimestamp}
        isStreaming={isStreaming}
      >
        {!isStreaming && data.success && (
          <Badge variant="outline" className="h-6 py-0.5 bg-muted">
            项目就绪
          </Badge>
        )}
      </ToolViewFooter>
    </Card>
  );
}