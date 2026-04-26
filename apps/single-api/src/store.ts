import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';

export type SingleSession = {
  id: string;
  title: string;
  workspaceDir: string;
  opencodeSessionId?: string;
  createdAt: string;
  updatedAt: string;
};

type StoreShape = {
  sessions: SingleSession[];
};

const storePath = join(config.dataDir, 'sessions.json');

function ensureStore(): void {
  mkdirSync(config.dataDir, { recursive: true });
  if (!existsSync(storePath)) {
    writeFileSync(storePath, JSON.stringify({ sessions: [] }, null, 2));
  }
}

function readStore(): StoreShape {
  ensureStore();
  return JSON.parse(readFileSync(storePath, 'utf-8')) as StoreShape;
}

function writeStore(store: StoreShape): void {
  ensureStore();
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function listSessions(): SingleSession[] {
  return readStore().sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSession(id: string): SingleSession | null {
  return readStore().sessions.find((s) => s.id === id) ?? null;
}

export function createSession(title?: string): SingleSession {
  const now = new Date().toISOString();
  const id = `sess_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const session: SingleSession = {
    id,
    title: title?.trim() || 'New session',
    workspaceDir: `/workspace/sessions/${id}`,
    createdAt: now,
    updatedAt: now,
  };
  const store = readStore();
  store.sessions.push(session);
  writeStore(store);
  return session;
}

export function updateSession(id: string, patch: Partial<Pick<SingleSession, 'title' | 'opencodeSessionId'>>): SingleSession | null {
  const store = readStore();
  const index = store.sessions.findIndex((s) => s.id === id);
  if (index === -1) return null;
  store.sessions[index] = {
    ...store.sessions[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return store.sessions[index];
}
