import { getEnv } from '@/lib/env-config';

export async function clearPreviewProxySession(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const backendUrl = (getEnv().BACKEND_URL || '').replace(/\/+$/, '');
    if (!backendUrl) return;
    await fetch(`${backendUrl}/p/auth`, {
      method: 'DELETE',
      credentials: 'include',
      keepalive: true,
    });
  } catch {
    // best-effort only
  }
}

export const clearUserLocalStorage = () => {
  if (typeof window === 'undefined') return;

  try {
    void clearPreviewProxySession();
    localStorage.removeItem('customModels');
    localStorage.removeItem('model-selection-v3');
    localStorage.removeItem('agent-selection-storage');
    localStorage.removeItem('auth-tracking-storage');
    localStorage.removeItem('pendingAgentPrompt');
    // Clean up legacy keys
    localStorage.removeItem('opencode-model-store-v1');
    // Clear sandbox/server state — prevents stale sandbox IDs leaking across accounts
    localStorage.removeItem('opencode-servers-v4');
    localStorage.removeItem('opencode-servers-v6');
    localStorage.removeItem('kortix-tabs');
    localStorage.removeItem('kortix-tabs-per-server');
    localStorage.removeItem('kortix-sandbox-provision-verified');
    // Clear pattern-based keys
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('maintenance-dismissed-')) {
        localStorage.removeItem(key);
      }
      if (key.startsWith('sb-') && key.includes('auth-token')) {
        localStorage.removeItem(key);
      }
    });
    // Clear sessionStorage sandbox connection flag
    try { sessionStorage.removeItem('kortix-sandbox-was-connected'); } catch {}
    try { sessionStorage.removeItem('kortix-sandbox-provision-verified'); } catch {}
    try { document.cookie = 'kortix-active-instance=; Max-Age=0; path=/; SameSite=Lax'; } catch {}
    try { document.cookie = 'kortix-active-instance-owner=; Max-Age=0; path=/; SameSite=Lax'; } catch {}
    
    console.log('✅ Local storage cleared on logout');
  } catch (error) {
    console.error('❌ Error clearing local storage:', error);
  }
};
