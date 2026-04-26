import { config, sandboxHeaders } from './config';
import type { SingleSession } from './store';
import { updateSession } from './store';
import { execInSandbox } from './sandbox';

const providerKeyEnv: Record<string, string[]> = {
  apipool: ['OPENROUTER_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  bigmodel: ['BIGMODEL_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  groq: ['GROQ_API_KEY'],
};

async function sandboxFetch(path: string, init: RequestInit = {}) {
  const headers = sandboxHeaders(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${config.sandboxBaseUrl}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
}

function parseModel(model: string): { providerID: string; modelID: string } {
  const [providerID, ...modelParts] = model.split('/');
  const modelID = modelParts.join('/');
  if (!providerID || !modelID) {
    throw new Error(`Invalid SINGLE_MODEL "${model}". Expected provider/model, for example apipool/claude-opus-4-7.`);
  }
  return { providerID, modelID };
}

function assertModelKeyConfigured(model: string): void {
  const providerID = model.split('/')[0] || '';
  const keys = providerKeyEnv[providerID] || [];
  if (!keys.length) return;

  const hasKey = keys.some((key) => Boolean(config.env[key]?.trim()));
  if (!hasKey) {
    throw new Error(
      `Missing model API key for SINGLE_MODEL=${model}. Set ${keys.join(' or ')} in apps/single-api/.env, then run: pnpm single:stop && pnpm single:dev`,
    );
  }
}

export async function ensureWorkspace(session: SingleSession): Promise<void> {
  execInSandbox(['bash', '-lc', `mkdir -p ${JSON.stringify(session.workspaceDir)} /workspace/shared`]);
}

export async function ensureOpenCodeSession(session: SingleSession): Promise<string> {
  if (session.opencodeSessionId) return session.opencodeSessionId;
  await ensureWorkspace(session);
  const res = await sandboxFetch('/session', {
    method: 'POST',
    body: JSON.stringify({
      title: session.title,
      agent: 'general',
      systemPrompt: [
        'You are running in Kortix single-sandbox mode.',
        `Use ${session.workspaceDir} as this session's working directory.`,
        'Keep session files inside that directory unless the user explicitly asks to use /workspace/shared.',
        'Shared cross-session files may go in /workspace/shared.',
      ].join('\n'),
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenCode session create failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json() as { id?: string };
  if (!json.id) throw new Error('OpenCode session create returned no id');
  updateSession(session.id, { opencodeSessionId: json.id });
  return json.id;
}

export async function sendPrompt(session: SingleSession, text: string): Promise<{ opencodeSessionId: string }> {
  assertModelKeyConfigured(config.model);
  const opencodeSessionId = await ensureOpenCodeSession(session);
  const model = parseModel(config.model);
  const scopedPrompt = [
    `<single_session_context id="${session.id}">`,
    `Workspace: ${session.workspaceDir}`,
    'Treat this as the current project root for all file and command work.',
    '</single_session_context>',
    '',
    text,
  ].join('\n');
  const res = await sandboxFetch(`/session/${opencodeSessionId}/prompt_async`, {
    method: 'POST',
    body: JSON.stringify({
      agent: 'general',
      model,
      parts: [{ type: 'text', text: scopedPrompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenCode prompt failed: ${res.status} ${await res.text()}`);
  }
  return { opencodeSessionId };
}

export async function getMessages(session: SingleSession): Promise<any[]> {
  if (!session.opencodeSessionId) return [];
  const res = await sandboxFetch(`/session/${session.opencodeSessionId}/message`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => []);
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

export async function proxyToSandbox(path: string, req: Request): Promise<Response> {
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const headers = sandboxHeaders(req.headers);
  headers.delete('host');
  const res = await fetch(`${config.sandboxBaseUrl}${path}`, {
    method: req.method,
    headers,
    body,
    // @ts-ignore Bun supports duplex/decompress.
    duplex: 'half',
    signal: req.signal,
  });
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
