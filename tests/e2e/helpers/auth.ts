import type { Page } from '@playwright/test';

export const ownerEmail = process.env.E2E_OWNER_EMAIL || 'test@kortix.ai';
export const ownerPassword = process.env.E2E_OWNER_PASSWORD || 'testpass123';
export const apiBase = process.env.E2E_API_URL || 'http://localhost:13738/v1';
export const supabaseUrl = process.env.E2E_SUPABASE_URL || 'http://localhost:13740';

/**
 * Read the anon key from the Kortix .env file.
 */
export function getAnonKey(): string {
  const fs = require('fs');
  const envPath = `${process.env.HOME}/.kortix/.env`;
  if (!fs.existsSync(envPath)) {
    throw new Error(`Kortix .env not found at ${envPath} — is it installed?`);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^SUPABASE_ANON_KEY=(.+)$/m);
  if (!match) throw new Error('SUPABASE_ANON_KEY not found in .env');
  return match[1].trim();
}

/**
 * Sign in via Supabase Auth API and return an access token.
 */
export async function getAccessToken(
  email = ownerEmail,
  password = ownerPassword,
): Promise<string> {
  const anonKey = getAnonKey();
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Extract an access token from the browser's auth state.
 */
export async function getAccessTokenFromPage(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    // Check localStorage first
    for (const key of Object.keys(localStorage)) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '');
        if (parsed?.access_token) return parsed.access_token as string;
      } catch {
        // skip
      }
    }
    // Check cookies
    const cookie = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => /^sb-.*-auth-token/.test(c));
    if (!cookie) return null;
    const encoded = decodeURIComponent(cookie.split('=')[1] || '');
    if (encoded.startsWith('base64-')) {
      try {
        const decoded = atob(encoded.slice('base64-'.length));
        return JSON.parse(decoded)?.access_token || null;
      } catch {
        return null;
      }
    }
    return null;
  });
  if (!token) throw new Error('Could not extract access token from browser');
  return token;
}

export async function loginToDashboard(page: Page): Promise<void> {
  await page.goto('/auth');
  await page.waitForTimeout(2_000);

  const lockScreen = page.getByText('Click or press Enter to sign in');
  if (await lockScreen.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.locator('div.fixed.inset-0.cursor-pointer').first().click({ force: true });
    await page.waitForTimeout(1_500);
  }

  await page.locator('input[name="email"]').fill(ownerEmail);
  await page.locator('input[name="password"]').fill(ownerPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const providerStep = page.getByRole('heading', { name: /Connect a provider/i });
  if (await providerStep.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await page.goto('/onboarding?skip_onboarding=1');
  }

  await page.goto('/workspace');
}
