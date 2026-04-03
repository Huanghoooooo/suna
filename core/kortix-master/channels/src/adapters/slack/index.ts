import { createSlackAdapter } from '@chat-adapter/slack';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { Chat } from 'chat';
import type { AdapterModule, SlackCredentials } from '../types.js';

const slackModule: AdapterModule<SlackCredentials> = {
  name: 'slack',

  readCredentialsFromEnv() {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (botToken && signingSecret) {
      return { botToken, signingSecret };
    }
    return undefined;
  },

  createAdapter(credentials: SlackCredentials) {
    const adapter = createSlackAdapter({
      botToken: credentials.botToken,
      signingSecret: credentials.signingSecret,
    });

    const slackApiUrl = process.env.SLACK_API_URL;
    if (slackApiUrl) {
      // Test/dev override so we can point the Slack SDK at a local fake API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (adapter as any).client as { slackApiUrl?: string; axios?: { defaults?: { baseURL?: string } } } | undefined;
      if (client) {
        client.slackApiUrl = slackApiUrl.endsWith('/') ? slackApiUrl : `${slackApiUrl}/`;
        if (client.axios?.defaults) {
          client.axios.defaults.baseURL = client.slackApiUrl;
        }
      }
    }

    return adapter;
  },

  registerRoutes(app: Hono, getBot: () => Chat | null) {
    const handle = async (c: Context) => {
      const bot = getBot();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (bot as any)?.webhooks?.slack;
      if (!handler) return c.text('Slack adapter not configured', 404);
      return handler(c.req.raw, {
        waitUntil: (task: Promise<unknown>) => { task.catch(console.error); },
      });
    };

    app.post('/slack/events', handle);
    app.post('/slack/commands', handle);
    app.post('/slack/interactivity', handle);
  },
};

export default slackModule;
