'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Boxes, ExternalLink, Play, RefreshCw, Send, Square, Terminal } from 'lucide-react';

type Session = {
  id: string;
  title: string;
  workspaceDir: string;
  opencodeSessionId?: string;
  updatedAt: string;
};

type SandboxStatus = {
  containerName: string;
  baseUrl: string;
  container: { exists: boolean; running: boolean; status: string; health?: string | null };
  runtime: { ok: boolean; status?: number; body?: any; error?: string };
};

const API = process.env.NEXT_PUBLIC_SINGLE_API_URL || 'http://localhost:18008';

function extractText(message: any): string {
  const parts = message?.parts || message?.data?.parts || [];
  const text = parts
    .map((p: any) => p?.text || p?.content || p?.input?.text || '')
    .filter(Boolean)
    .join('\n');
  return text || JSON.stringify(message, null, 2);
}

function roleOf(message: any): string {
  return message?.info?.role || message?.role || message?.data?.role || 'assistant';
}

export default function Page() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useMemo(() => sessions.find((s) => s.id === activeId) || null, [sessions, activeId]);

  async function refreshSessions() {
    const res = await fetch(`${API}/api/sessions`);
    const json = await res.json();
    const list = json.data || [];
    setSessions(list);
    if (!activeId && list[0]) setActiveId(list[0].id);
  }

  async function refreshStatus() {
    const res = await fetch(`${API}/api/sandbox/status`);
    const json = await res.json();
    setStatus(json.data);
  }

  async function refreshMessages(id = activeId) {
    if (!id) return;
    const res = await fetch(`${API}/api/sessions/${id}/messages`);
    const json = await res.json();
    setMessages(json.data || []);
  }

  async function refreshLogs() {
    const res = await fetch(`${API}/api/sandbox/logs?lines=120`);
    setLogs(await res.text());
  }

  async function createSession() {
    const res = await fetch(`${API}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Session ${sessions.length + 1}` }),
    });
    const json = await res.json();
    await refreshSessions();
    setActiveId(json.data.id);
  }

  async function startSandbox() {
    setBusy(true);
    try {
      await fetch(`${API}/api/sandbox/start`, { method: 'POST' });
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  async function restartSandbox() {
    setBusy(true);
    try {
      await fetch(`${API}/api/sandbox/restart`, { method: 'POST' });
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  async function sendPrompt() {
    if (!active || !text.trim()) return;
    const outgoing = text.trim();
    setText('');
    setBusy(true);
    setError('');
    setMessages((current) => [
      ...current,
      { role: 'user', parts: [{ type: 'text', text: outgoing }] },
    ]);
    try {
      const res = await fetch(`${API}/api/sessions/${active.id}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: outgoing }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `Request failed with ${res.status}`);
      }
      await refreshSessions();
      await refreshMessages(active.id);
    } catch (err: any) {
      setText(outgoing);
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshSessions();
    refreshStatus();
    refreshLogs();
  }, []);

  useEffect(() => {
    refreshMessages();
    const timer = window.setInterval(() => {
      refreshStatus();
      refreshMessages();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeId]);

  const running = Boolean(status?.container?.running && status?.runtime?.ok);
  const previewUrl = active ? `${API}/api/preview/3211/` : '';

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Boxes size={16} /></div>
          <span>Kortix Single</span>
        </div>

        <button className="button primary" onClick={createSession}>
          <Bot size={16} /> New session
        </button>

        <div className="section-title">Sessions</div>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`session-button ${session.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(session.id)}
            >
              <strong>{session.title}</strong>
              <span className="muted">{session.workspaceDir}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="main">
        <div className="topbar">
          <div>
            <h1>{active?.title || 'No session selected'}</h1>
            <p>{active?.workspaceDir || 'Create a session to start working'}</p>
          </div>
          <button className="button" onClick={() => refreshMessages()} disabled={!active}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <div className="messages">
          {error && (
            <div className="message error">
              <div className="muted">error</div>
              {error}
            </div>
          )}
          {messages.length === 0 && (
            <div className="message">
              Start with one concrete request. This workspace keeps each session under its own directory.
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`message ${roleOf(message)}`}>
              <div className="muted">{roleOf(message)}</div>
              {extractText(message)}
            </div>
          ))}
        </div>

        <div className="composer">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt();
            }}
            placeholder="Tell the agent what to build, inspect, or change..."
          />
          <button className="button primary" onClick={sendPrompt} disabled={!active || busy || !running}>
            <Send size={16} /> {busy ? 'Sending' : 'Send'}
          </button>
        </div>
      </section>

      <aside className="inspector">
        <div className="status-line">
          <div>
            <div className="section-title">Sandbox</div>
            <strong>{status?.containerName || 'kortix-single-sandbox'}</strong>
          </div>
          <span className={`dot ${running ? 'ok' : ''}`} />
        </div>

        <div className="kv"><span>Status</span><code>{status?.container?.status || 'unknown'}</code></div>
        <div className="kv"><span>Runtime</span><code>{status?.runtime?.ok ? 'ready' : status?.runtime?.error || 'starting'}</code></div>
        <div className="kv"><span>Base URL</span><code>{status?.baseUrl || '-'}</code></div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button" onClick={startSandbox} disabled={busy}><Play size={16} /> Start</button>
          <button className="button" onClick={restartSandbox} disabled={busy}><Square size={16} /> Restart</button>
        </div>

        <div className="section-title">Preview</div>
        <div className="preview-box">
          {active ? (
            <a className="button" href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Open static preview
            </a>
          ) : 'No active session'}
        </div>

        <div className="status-line">
          <div className="section-title">Logs</div>
          <button className="button" onClick={refreshLogs}><Activity size={16} /> Pull</button>
        </div>
        <pre className="log"><Terminal size={14} />{'\n'}{logs || 'No logs loaded'}</pre>
      </aside>
    </main>
  );
}
