import { useMutation } from '@tanstack/react-query';
import { authenticatedFetch } from '@/lib/auth-token';
import { getActiveOpenCodeUrl } from '@/stores/server-store';

export function useSlackConnect() {
  return useMutation({
    mutationFn: async ({ botToken, signingSecret, publicUrl, name, createdBy, channelId }: {
      botToken: string; signingSecret?: string; publicUrl?: string; name?: string; createdBy?: string; channelId?: string;
    }) => {
      const baseUrl = getActiveOpenCodeUrl();
      if (!baseUrl) throw new Error('No active instance');
      const res = await authenticatedFetch(`${baseUrl}/kortix/channels/setup/slack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken, signingSecret, publicUrl, name, createdBy, channelId }),
      });
      const data = await res.json() as any;
      if (!data.ok) throw new Error(data.error || 'Setup failed');
      return data;
    },
  });
}
