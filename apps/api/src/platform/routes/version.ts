import { Hono } from 'hono';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../../config';
import { releaseManifest } from '../../release';

/**
 * Sandbox version + changelog endpoints — supports both stable and dev channels.
 *
 * Channels:
 *   - stable: Production releases, sourced from GitHub Releases API
 *   - dev:    Dev builds from main, sourced from GitHub Commits API
 *
 * Docker Hub tags follow:
 *   - stable: kortix/computer:0.8.28, kortix/computer:latest
 *   - dev:    kortix/computer:dev-{sha8}, kortix/computer:dev-latest
 *
 * Update flow:
 *   1. Frontend GETs /v1/platform/sandbox/version/latest?channel=stable|dev
 *   2. Frontend GETs {sandboxUrl}/kortix/health → { version } (running version)
 *   3. Versions differ? Show "Update available"
 *   4. User clicks update → frontend POSTs /v1/platform/sandbox/update
 *   5. API pulls new Docker image, recreates container
 *
 * Backward compat: release.json + CHANGELOG.json still work as fallbacks
 * for self-hosted users who can't reach GitHub API.
 */

// ─── GitHub API URLs ────────────────────────────────────────────────────────

const GITHUB_REPO = 'kortix-ai/suna';
const GITHUB_API_BASE = 'https://api.github.com';

// Legacy fallback URLs
const RELEASE_GITHUB_URL = 'https://raw.githubusercontent.com/kortix-ai/suna/main/core/release.json';
const CHANGELOG_GITHUB_URL = 'https://raw.githubusercontent.com/kortix-ai/suna/main/core/CHANGELOG.json';

// Local CHANGELOG.json lookup paths (checked as fallback)
const LOCAL_CHANGELOG_PATHS = [
  resolve('/app/CHANGELOG.json'),
  resolve(process.cwd(), '../../core/CHANGELOG.json'),
  resolve(process.cwd(), '../core/CHANGELOG.json'),
  resolve(process.cwd(), 'core/CHANGELOG.json'),
];

// ─── Types ──────────────────────────────────────────────────────────────────

type Channel = 'stable' | 'dev';

interface VersionEntry {
  version: string;
  channel: Channel;
  date: string;
  title: string;
  body?: string;
  sha?: string;
  current: boolean;
}

interface LatestVersionResult {
  version: string;
  channel: Channel;
  date?: string;
  title?: string;
  sha?: string;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

const cache: {
  latestStable: CacheEntry<LatestVersionResult> | null;
  latestDev: CacheEntry<LatestVersionResult> | null;
  allVersions: CacheEntry<VersionEntry[]> | null;
  changelog: CacheEntry<any[]> | null;
} = {
  latestStable: null,
  latestDev: null,
  allVersions: null,
  changelog: null,
};

function isCacheValid<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return entry !== null && (Date.now() - entry.cachedAt) < CACHE_TTL_MS;
}

// ─── GitHub API Helpers ─────────────────────────────────────────────────────

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (config.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${config.GITHUB_TOKEN}`;
  return headers;
}

async function githubFetch<T>(path: string): Promise<T> {
  const url = `${GITHUB_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Detect running channel ─────────────────────────────────────────────────

/** Determine the channel of the currently running instance */
function getRunningChannel(): Channel {
  const version = process.env.SANDBOX_VERSION || config.SANDBOX_VERSION_OVERRIDE || releaseManifest.version;
  if (version.startsWith('dev-')) return 'dev';
  if (releaseManifest.channel === 'dev') return 'dev';
  // Also check INTERNAL_KORTIX_ENV — if running in dev environment, default to dev channel
  if (config.INTERNAL_KORTIX_ENV === 'dev' && releaseManifest.channel === 'unknown') return 'dev';
  return 'stable';
}

function getRunningVersion(): string {
  return process.env.SANDBOX_VERSION || config.SANDBOX_VERSION_OVERRIDE || releaseManifest.version;
}

// ─── Latest Stable (GitHub Releases API) ────────────────────────────────────

async function getLatestStable(): Promise<LatestVersionResult> {
  if (isCacheValid(cache.latestStable)) return cache.latestStable.data;

  try {
    interface GHRelease {
      tag_name: string;
      name: string;
      published_at: string;
      body: string;
    }
    const release = await githubFetch<GHRelease>(`/repos/${GITHUB_REPO}/releases/latest`);
    const version = release.tag_name.replace(/^v/, '');
    const result: LatestVersionResult = {
      version,
      channel: 'stable',
      date: release.published_at?.split('T')[0],
      title: release.name || `v${version}`,
    };
    cache.latestStable = { data: result, cachedAt: Date.now() };
    return result;
  } catch (err) {
    console.warn('[version] Failed to fetch latest stable from GitHub Releases:', err);
    // Fallback: try the legacy release.json from GitHub raw
    return getLatestStableFallback();
  }
}

async function getLatestStableFallback(): Promise<LatestVersionResult> {
  try {
    const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
    if (config.GITHUB_TOKEN) headers['Authorization'] = `token ${config.GITHUB_TOKEN}`;
    const res = await fetch(RELEASE_GITHUB_URL, { headers, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`GitHub raw release.json failed: ${res.status}`);
    const data = await res.json() as any;
    const result: LatestVersionResult = {
      version: data.version,
      channel: 'stable',
      title: `v${data.version}`,
    };
    cache.latestStable = { data: result, cachedAt: Date.now() };
    return result;
  } catch {
    // Ultimate fallback: local release.json
    return {
      version: releaseManifest.version,
      channel: 'stable',
      title: `v${releaseManifest.version}`,
    };
  }
}

// ─── Latest Dev (GitHub Commits API) ────────────────────────────────────────

async function getLatestDev(): Promise<LatestVersionResult> {
  if (isCacheValid(cache.latestDev)) return cache.latestDev.data;

  try {
    interface GHCommit {
      sha: string;
      commit: {
        message: string;
        committer: { date: string };
      };
    }
    const commit = await githubFetch<GHCommit>(`/repos/${GITHUB_REPO}/commits/main`);
    const sha8 = commit.sha.substring(0, 8);
    const result: LatestVersionResult = {
      version: `dev-${sha8}`,
      channel: 'dev',
      date: commit.commit.committer.date?.split('T')[0],
      title: commit.commit.message.split('\n')[0].substring(0, 120),
      sha: commit.sha,
    };
    cache.latestDev = { data: result, cachedAt: Date.now() };
    return result;
  } catch (err) {
    console.warn('[version] Failed to fetch latest dev commit from GitHub:', err);
    // For dev fallback, use the running version if it's a dev build
    const running = getRunningVersion();
    return {
      version: running.startsWith('dev-') ? running : 'dev-unknown',
      channel: 'dev',
      title: 'Latest dev build',
    };
  }
}

// ─── All Versions ───────────────────────────────────────────────────────────

async function getAllVersions(): Promise<VersionEntry[]> {
  if (isCacheValid(cache.allVersions)) return cache.allVersions.data;

  const runningVersion = getRunningVersion();
  const versions: VersionEntry[] = [];

  // Fetch stable releases (GitHub Releases API)
  try {
    interface GHRelease {
      tag_name: string;
      name: string;
      published_at: string;
      body: string;
      draft: boolean;
      prerelease: boolean;
    }
    const releases = await githubFetch<GHRelease[]>(`/repos/${GITHUB_REPO}/releases?per_page=20`);
    for (const release of releases) {
      if (release.draft) continue;
      const version = release.tag_name.replace(/^v/, '');
      versions.push({
        version,
        channel: release.prerelease ? 'dev' : 'stable',
        date: release.published_at?.split('T')[0] ?? '',
        title: release.name || `v${version}`,
        body: release.body || undefined,
        current: version === runningVersion,
      });
    }
  } catch (err) {
    console.warn('[version] Failed to fetch releases from GitHub:', err);
  }

  // Fetch recent dev commits (GitHub Commits API)
  try {
    interface GHCommitEntry {
      sha: string;
      commit: {
        message: string;
        committer: { date: string };
      };
    }
    const commits = await githubFetch<GHCommitEntry[]>(`/repos/${GITHUB_REPO}/commits?sha=main&per_page=20`);
    for (const commit of commits) {
      const sha8 = commit.sha.substring(0, 8);
      const devVersion = `dev-${sha8}`;
      versions.push({
        version: devVersion,
        channel: 'dev',
        date: commit.commit.committer.date?.split('T')[0] ?? '',
        title: commit.commit.message.split('\n')[0].substring(0, 120),
        sha: commit.sha,
        current: devVersion === runningVersion,
      });
    }
  } catch (err) {
    console.warn('[version] Failed to fetch dev commits from GitHub:', err);
  }

  // Sort by date descending
  versions.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  cache.allVersions = { data: versions, cachedAt: Date.now() };
  return versions;
}

// ─── Legacy Changelog (CHANGELOG.json) ──────────────────────────────────────
// Kept as fallback for the /changelog endpoint. Frozen — no new entries.

function readLocalChangelog(): any[] | null {
  for (const p of LOCAL_CHANGELOG_PATHS) {
    try {
      if (existsSync(p)) {
        const data = JSON.parse(readFileSync(p, 'utf-8'));
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function getLegacyChangelog(): Promise<any[]> {
  if (isCacheValid(cache.changelog)) return cache.changelog.data;

  // Try GitHub raw first so changelog stays in sync
  try {
    const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
    if (config.GITHUB_TOKEN) headers['Authorization'] = `token ${config.GITHUB_TOKEN}`;
    const res = await fetch(CHANGELOG_GITHUB_URL, { headers, signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const data = await res.json() as any[];
      cache.changelog = { data, cachedAt: Date.now() };
      return data;
    }
  } catch {
    // fall through to local
  }

  const local = readLocalChangelog();
  if (local) {
    cache.changelog = { data: local, cachedAt: Date.now() };
    return local;
  }

  return cache.changelog?.data || [];
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const versionRouter = new Hono();

/**
 * GET /v1/platform/sandbox/version/latest
 *
 * Returns the latest available version from GitHub.
 * Query params:
 *   ?channel=stable (default) — latest GitHub Release
 *   ?channel=dev              — latest commit on main (dev-{sha8})
 *
 * Backward compat: without ?channel, returns stable (same as before).
 */
versionRouter.get('/latest', async (c) => {
  const channel = (c.req.query('channel') || 'stable') as Channel;

  if (channel === 'dev') {
    const latest = await getLatestDev();
    return c.json({
      version: latest.version,
      channel: 'dev' as const,
      date: latest.date,
      sha: latest.sha,
      // No legacy changelog entry for dev builds
      changelog: null,
    });
  }

  // stable (default) — backward compatible response shape
  const latest = await getLatestStable();
  const legacyChangelog = await getLegacyChangelog();
  const entry = legacyChangelog.find((e: any) => e.version === latest.version) ?? null;
  return c.json({
    version: latest.version,
    channel: 'stable' as const,
    date: latest.date,
    changelog: entry,
  });
});

/**
 * GET /v1/platform/sandbox/version
 * Returns the version baked into this running API image.
 */
versionRouter.get('/', async (c) => {
  const version = getRunningVersion();
  const channel = getRunningChannel();
  const legacyChangelog = await getLegacyChangelog();
  const entry = legacyChangelog.find((e: any) => e.version === version) ?? null;
  return c.json({ version, channel, changelog: entry });
});

/**
 * GET /v1/platform/sandbox/version/changelog
 *
 * For prod: uses GitHub Releases API to get release notes.
 * For dev: returns recent commits on main as changelog entries.
 * Falls back to legacy CHANGELOG.json if GitHub API is unavailable.
 *
 * Query params:
 *   ?channel=stable (default) — release notes from GitHub Releases
 *   ?channel=dev              — recent commit messages
 *   ?channel=all              — both merged and sorted by date
 */
versionRouter.get('/changelog', async (c) => {
  const channel = c.req.query('channel') || 'all';

  // Build changelog from GitHub APIs
  const entries: any[] = [];

  if (channel === 'stable' || channel === 'all') {
    try {
      interface GHRelease {
        tag_name: string;
        name: string;
        published_at: string;
        body: string;
        draft: boolean;
        prerelease: boolean;
      }
      const releases = await githubFetch<GHRelease[]>(`/repos/${GITHUB_REPO}/releases?per_page=20`);
      for (const release of releases) {
        if (release.draft || release.prerelease) continue;
        const version = release.tag_name.replace(/^v/, '');
        entries.push({
          version,
          channel: 'stable',
          date: release.published_at?.split('T')[0] ?? '',
          title: release.name || `v${version}`,
          description: release.body || '',
          changes: [],
        });
      }
    } catch {
      // Fall back to legacy changelog for stable entries
      const legacy = await getLegacyChangelog();
      for (const entry of legacy) {
        entries.push({ ...entry, channel: 'stable' });
      }
    }
  }

  if (channel === 'dev' || channel === 'all') {
    try {
      interface GHCommitEntry {
        sha: string;
        commit: {
          message: string;
          committer: { date: string };
          author: { name: string };
        };
      }
      const commits = await githubFetch<GHCommitEntry[]>(`/repos/${GITHUB_REPO}/commits?sha=main&per_page=20`);
      for (const commit of commits) {
        const sha8 = commit.sha.substring(0, 8);
        const lines = commit.commit.message.split('\n');
        entries.push({
          version: `dev-${sha8}`,
          channel: 'dev',
          date: commit.commit.committer.date?.split('T')[0] ?? '',
          title: lines[0].substring(0, 120),
          description: lines.slice(1).join('\n').trim().substring(0, 500) || '',
          changes: [],
          sha: commit.sha,
          author: commit.commit.author?.name,
        });
      }
    } catch (err) {
      console.warn('[version] Failed to fetch dev commits for changelog:', err);
    }
  }

  // Sort by date descending
  entries.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  // If we got nothing from GitHub, fall back to legacy CHANGELOG.json
  if (entries.length === 0) {
    const legacy = await getLegacyChangelog();
    return c.json({ changelog: legacy });
  }

  return c.json({ changelog: entries });
});

/**
 * GET /v1/platform/sandbox/version/all
 *
 * Returns all available versions (both stable releases and dev builds).
 * Used by the frontend changelog page to show a unified version list.
 */
versionRouter.get('/all', async (c) => {
  const versions = await getAllVersions();
  const runningVersion = getRunningVersion();
  const runningChannel = getRunningChannel();
  return c.json({
    versions,
    current: {
      version: runningVersion,
      channel: runningChannel,
    },
  });
});

export { versionRouter };
