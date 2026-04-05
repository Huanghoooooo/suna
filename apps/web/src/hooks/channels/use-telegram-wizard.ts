import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authenticatedFetch } from '@/lib/auth-token';
import { getActiveOpenCodeUrl } from '@/stores/server-store';

export interface VerifyTokenResult {
  ok: boolean;
  bot?: { id: number; username: string; firstName: string };
  error?: string;
}

/**
 * Verify a Telegram bot token by calling the Telegram API directly from the browser.
 */
export function useTelegramVerifyToken() {
  return useMutation({
    mutationFn: async ({ botToken }: { botToken: string }): Promise<VerifyTokenResult> => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
          signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json() as {
          ok: boolean;
          result?: { id: number; first_name: string; username: string };
          description?: string;
        };

        if (data.ok && data.result) {
          return {
            ok: true,
            bot: {
              id: data.result.id,
              username: data.result.username,
              firstName: data.result.first_name,
            },
          };
        }
        return { ok: false, error: data.description || 'Invalid token' };
      } catch {
        return { ok: false, error: 'Failed to reach Telegram API' };
      }
    },
  });
}

export function useTelegramConnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ botToken, publicUrl, createdBy, defaultAgent, defaultModel }: {
      botToken: string;
      publicUrl: string;
      createdBy?: string;
      defaultAgent?: string;
      defaultModel?: string;
    }) => {
      const baseUrl = getActiveOpenCodeUrl();
      if (!baseUrl) throw new Error('No active instance');
      const res = await authenticatedFetch(`${baseUrl}/kortix/channels/setup/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken, publicUrl, createdBy, defaultAgent, defaultModel }),
      });
      const data = await res.json() as any;
      if (!data.ok) throw new Error(data.error || 'Setup failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}
