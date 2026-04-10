'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/utils';
import { toast } from '@/lib/toast';
import { useSidebar } from '@/components/ui/sidebar';
import {
  useCreateOpenCodeSession,
  useSendOpenCodeMessage,
  useOpenCodeAgents,
  useOpenCodeProviders,
  useOpenCodeCommands,
} from '@/hooks/opencode/use-opencode-sessions';
import { getClient } from '@/lib/opencode-sdk';
import { openTabAndNavigate } from '@/stores/tab-store';
import { useServerStore } from '@/stores/server-store';
import { type AttachedFile, SessionChatInput } from '@/components/session/session-chat-input';
import { usePendingFilesStore } from '@/stores/pending-files-store';
import { WallpaperBackground } from '@/components/ui/wallpaper-background';
import { useOpenCodeLocal, formatModelString } from '@/hooks/opencode/use-opencode-local';
import { useOpenCodeConfig } from '@/hooks/opencode/use-opencode-config';
import { Menu } from 'lucide-react';
import type { Command } from '@/hooks/opencode/use-opencode-sessions';
import { playSound } from '@/lib/sounds';
import { cn } from '@/lib/utils';

// ============================================================================
// Dashboard Content
// ============================================================================

export function DashboardContent() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFadingOutWelcome, setIsFadingOutWelcome] = useState(false);
  const DASHBOARD_WELCOME_FADE_MS = 700;

  const router = useRouter();
  const isMobile = useIsMobile();
  const { setOpen: setSidebarOpenState, setOpenMobile } = useSidebar();
  const createSession = useCreateOpenCodeSession();
  const sendMessage = useSendOpenCodeMessage();

  // Data
  const { data: agents } = useOpenCodeAgents();
  const { data: providers } = useOpenCodeProviders();
  const { data: commands } = useOpenCodeCommands();
  const { data: config } = useOpenCodeConfig();

  // Unified model/agent/variant state
  const local = useOpenCodeLocal({ agents, providers, config });

  const handleSend = useCallback(
    async (text: string, files?: AttachedFile[]) => {
      if ((!text.trim() && (!files || files.length === 0)) || isSubmitting) return;
      playSound('send');
      setIsSubmitting(true);
      setIsFadingOutWelcome(true);
      let createdSessionId: string | null = null;
      try {
        const fadeDelay = new Promise<void>((resolve) => {
          setTimeout(resolve, DASHBOARD_WELCOME_FADE_MS);
        });

        const options: Record<string, unknown> = {};
        if (local.agent.current) options.agent = local.agent.current.name;
        if (local.model.currentKey) options.model = local.model.currentKey;
        if (local.model.variant.current) options.variant = local.model.variant.current;

        const session = await createSession.mutateAsync();
        await fadeDelay;
        createdSessionId = session.id;

        // Store the prompt text BEFORE navigating so the session page can
        // read it immediately when its useEffect fires. Placing this after
        // openTabAndNavigate caused a race where sessionStorage was empty
        // when the session page's pending-prompt useEffect ran.
        sessionStorage.setItem(`opencode_pending_prompt:${session.id}`, text);
        if (files && files.length > 0) {
          usePendingFilesStore.getState().setPendingFiles(files);
        }
        if (Object.keys(options).length > 0) {
          sessionStorage.setItem(`opencode_pending_options:${session.id}`, JSON.stringify(options));
        }

        // Step 2: Open tab and navigate (optimistic) — AFTER sessionStorage is set
        openTabAndNavigate({
          id: session.id,
          title: 'New session',
          type: 'session',
          href: `/sessions/${session.id}`,
          serverId: useServerStore.getState().activeServerId,
        });
        // Reset submitting since the dashboard stays mounted (hidden) with pushState
        setIsSubmitting(false);
        setTimeout(() => setIsFadingOutWelcome(false), 0);
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('focus-session-textarea'));
        });
      } catch {
        if (createdSessionId) {
          sessionStorage.removeItem(`opencode_pending_prompt:${createdSessionId}`);
          sessionStorage.removeItem(`opencode_pending_options:${createdSessionId}`);
        }
        usePendingFilesStore.getState().setPendingFiles([]);
        setIsFadingOutWelcome(false);
        setIsSubmitting(false);
        toast.warning('Failed to create session');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSubmitting, createSession, sendMessage, local.agent.current, local.model.currentKey, local.model.variant.current],
  );

  const handleCommand = useCallback(
    async (cmd: Command, args?: string) => {
      try {
        const session = await createSession.mutateAsync();
        openTabAndNavigate({
          id: session.id,
          title: cmd.name,
          type: 'session',
          href: `/sessions/${session.id}`,
          serverId: useServerStore.getState().activeServerId,
        });
        const client = getClient();
        void client.session.command({
          sessionID: session.id,
          command: cmd.name,
          arguments: args || '',
          ...(local.agent.current && { agent: local.agent.current.name }),
          ...(local.model.currentKey && { model: formatModelString(local.model.currentKey) }),
          ...(local.model.variant.current && { variant: local.model.variant.current }),
        } as any).catch(() => {
          toast.warning('Failed to execute command');
        });
      } catch {
        toast.warning('Failed to create session');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createSession, local.agent.current, local.model.currentKey, local.model.variant.current],
  );

  return (
    <div className="relative flex flex-col h-full bg-background">
      {/* Mobile menu button */}
      {isMobile && (
        <div className="absolute left-3 top-1.5 z-10">
          <button
            onClick={() => {
              setSidebarOpenState(true);
              setOpenMobile(true);
            }}
            className="flex items-center justify-center h-9 w-9 -ml-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 active:bg-accent transition-colors touch-manipulation"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Wallpaper area — flex-1 above input, same structure as session-chat */}
      <div
        className={cn(
          "relative flex-1 min-h-0 transition-[opacity,transform] ease-out",
          isFadingOutWelcome
            ? "opacity-0 scale-[0.995] duration-700"
            : "opacity-100 scale-100 duration-300",
        )}
      >
        <div className="absolute inset-0">
          <div className="relative w-full h-full overflow-hidden">
            <WallpaperBackground />
          </div>
        </div>
      </div>

      {/* Chat Input — pinned to bottom */}
      <SessionChatInput
        onSend={handleSend}
        disabled={isSubmitting}
        placeholder="Ask anything..."
        agents={local.agent.list}
        selectedAgent={local.agent.current?.name ?? null}
        onAgentChange={(name) => local.agent.set(name ?? undefined)}
        models={local.model.list}
        selectedModel={local.model.currentKey ?? null}
        onModelChange={(m) => local.model.set(m ?? undefined, { recent: true })}
        variants={local.model.variant.list}
        selectedVariant={local.model.variant.current ?? null}
        onVariantChange={(v) => local.model.variant.set(v ?? undefined)}
        commands={commands || []}
        onCommand={handleCommand}
      />
    </div>
  );
}
