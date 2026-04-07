/**
 * Hooks for Telegram & Slack channel setup wizards.
 * Mirrors frontend's use-telegram-wizard.ts and use-slack-wizard.ts.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_URL, getAuthToken } from '@/api/config';
import { channelKeys } from './useChannels';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function sandboxFetch<T>(sandboxUrl: string, path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${sandboxUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { message: text }; }
  if (!res.ok) throw new Error(body?.error?.message || body?.message || `Request failed (${res.status})`);
  return body;
}

async function backendFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string>),
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || body?.message || `Request failed (${res.status})`);
  return body;
}

// ─── Telegram ───────────────────────────────────────────────────────────────

export interface TelegramVerifyResult {
  valid: boolean;
  error?: string;
  bot?: { id: number; username: string; firstName: string };
}

/**
 * Verify a Telegram bot token by calling api.telegram.org directly.
 */
export function useTelegramVerifyToken() {
  return useMutation({
    mutationFn: async ({ botToken }: { botToken: string }): Promise<TelegramVerifyResult> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = await res.json() as {
          ok: boolean;
          result?: { id: number; first_name: string; username: string };
          description?: string;
        };
        if (data.ok && data.result) {
          return {
            valid: true,
            bot: { id: data.result.id, username: data.result.username, firstName: data.result.first_name },
          };
        }
        return { valid: false, error: data.description || 'Invalid token' };
      } catch {
        return { valid: false, error: 'Failed to reach Telegram API' };
      }
    },
  });
}

/**
 * Push Telegram credentials to sandbox env, reload channels, set webhook, create DB record.
 */
export function useTelegramConnect() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sandboxUrl,
      sandboxId,
      botToken,
      publicUrl,
      botUsername,
    }: {
      sandboxUrl: string;
      sandboxId: string | null;
      botToken: string;
      publicUrl: string;
      botUsername?: string;
    }) => {
      const secretToken = `oc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      // 1. Push env vars to sandbox
      for (const [key, value] of Object.entries({
        TELEGRAM_BOT_TOKEN: botToken,
        TELEGRAM_WEBHOOK_SECRET_TOKEN: secretToken,
      })) {
        await sandboxFetch(sandboxUrl, `/env/${key}`, {
          method: 'POST',
          body: JSON.stringify({ value }),
        });
      }

      // 2. Reload opencode-channels with new credentials
      await sandboxFetch(sandboxUrl, '/channels/reload', {
        method: 'POST',
        body: JSON.stringify({ credentials: { telegram: { botToken, secretToken } } }),
      });

      // 3. Set Telegram webhook
      const webhookUrl = `${publicUrl.replace(/\/$/, '')}/webhooks/telegram`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const whRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: secretToken,
          allowed_updates: ['message', 'edited_message', 'callback_query', 'message_reaction'],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const whData = await whRes.json() as { ok: boolean; description?: string };
      if (!whData.ok) throw new Error(`Failed to set webhook: ${whData.description || 'unknown'}`);

      // 4. Create channel config DB record
      const channelName = botUsername ? `@${botUsername}` : 'Telegram Bot';
      try {
        await backendFetch('/channels', {
          method: 'POST',
          body: JSON.stringify({
            sandbox_id: sandboxId,
            channel_type: 'telegram',
            name: channelName,
            enabled: true,
            platform_config: { webhook_url: webhookUrl, bot_username: botUsername || null },
          }),
        });
      } catch {
        // Channel may already exist — not fatal
      }

      return { webhookUrl, secretToken };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

// ─── Slack ───────────────────────────────────────────────────────────────────

export interface DetectUrlResult {
  url: string;
  source: 'ngrok' | 'config' | 'none';
  detected: boolean;
}

export interface GenerateManifestResult {
  manifest: Record<string, unknown>;
  manifestJson: string;
}

/**
 * Detect public URL (ngrok tunnel) via backend API.
 */
export function useSlackDetectUrl() {
  return useMutation({
    mutationFn: async (): Promise<DetectUrlResult> => {
      try {
        return await backendFetch<DetectUrlResult>(
          '/channels/slack-wizard/detect-url',
        );
      } catch {
        return { detected: false, url: '', source: 'none' };
      }
    },
  });
}

/**
 * Generate Slack app manifest via backend API.
 */
export function useSlackGenerateManifest() {
  return useMutation({
    mutationFn: async ({ publicUrl, botName }: {
      publicUrl: string;
      botName?: string;
    }): Promise<GenerateManifestResult> => {
      // Backend returns { manifest } directly (not wrapped in { success, data })
      const result = await backendFetch<{ manifest: Record<string, unknown> }>(
        '/channels/slack-wizard/generate-manifest',
        {
          method: 'POST',
          body: JSON.stringify({ publicUrl, botName }),
        },
      );
      return {
        manifest: result.manifest,
        manifestJson: JSON.stringify(result.manifest, null, 2),
      };
    },
  });
}

/**
 * Push Slack credentials to sandbox env, reload channels, create DB record.
 */
export function useSlackConnect() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sandboxUrl,
      sandboxId,
      botToken,
      signingSecret,
      publicUrl,
      name,
      defaultAgent,
      defaultModel,
    }: {
      sandboxUrl: string;
      sandboxId: string | null;
      botToken: string;
      signingSecret: string;
      publicUrl: string;
      name?: string;
      defaultAgent?: string;
      defaultModel?: string;
    }) => {
      // 1. Push env vars to sandbox
      for (const [key, value] of Object.entries({
        SLACK_BOT_TOKEN: botToken,
        SLACK_SIGNING_SECRET: signingSecret,
      })) {
        await sandboxFetch(sandboxUrl, `/env/${key}`, {
          method: 'POST',
          body: JSON.stringify({ value }),
        });
      }

      // 2. Reload channels service
      await sandboxFetch(sandboxUrl, '/channels/reload', {
        method: 'POST',
        body: JSON.stringify({
          credentials: { slack: { botToken, signingSecret } },
        }),
      });

      // 3. Create channel config DB record
      try {
        await backendFetch('/channels', {
          method: 'POST',
          body: JSON.stringify({
            sandbox_id: sandboxId,
            channel_type: 'slack',
            name: name || 'Slack Bot',
            enabled: true,
            default_agent: defaultAgent,
            default_model: defaultModel,
            platform_config: { webhook_url: `${publicUrl.replace(/\/$/, '')}/webhooks/slack/events` },
          }),
        });
      } catch {
        // May already exist
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}
