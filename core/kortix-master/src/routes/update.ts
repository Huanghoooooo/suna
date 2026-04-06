import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

// ─── Constants ──────────────────────────────────────────────────────────────

const VERSION_FILE = '/ephemeral/metadata/.version';
const KORTIX_DATA_DIR = '/workspace/.kortix';
const UPDATE_STATUS_FILE = KORTIX_DATA_DIR + '/update-status.json';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Read the running sandbox version.
 * Priority:
 *   1. SANDBOX_VERSION env var (injected at provision from the Docker image tag)
 *   2. /ephemeral/metadata/.version (baked into the image at build time)
 *   3. 'unknown'
 */
async function readLocalVersion(): Promise<string> {
  if (process.env.SANDBOX_VERSION) return process.env.SANDBOX_VERSION;
  try {
    const file = Bun.file(VERSION_FILE);
    if (await file.exists()) {
      const data = await file.json();
      return data.version || 'unknown';
    }
  } catch {}
  return 'unknown';
}

interface UpdateStatus {
  inProgress: boolean;
  phase: string;
  message: string;
  targetVersion?: string;
  previousVersion?: string;
  currentVersion?: string;
  error: string | null;
}

async function getStatus(): Promise<UpdateStatus> {
  try {
    const file = Bun.file(UPDATE_STATUS_FILE);
    if (await file.exists()) {
      return await file.json() as UpdateStatus;
    }
  } catch {}
  return {
    inProgress: false,
    phase: 'idle',
    message: 'No update in progress',
    error: null,
  };
}

async function setStatus(status: UpdateStatus): Promise<void> {
  await Bun.write(UPDATE_STATUS_FILE, JSON.stringify(status, null, 2));
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const updateRoutes = new Hono();

// POST /kortix/update — Trigger a Docker image-based update
// The actual image pull + container recreate is handled by the kortix-api
// (local-docker provider). This endpoint just signals readiness and version info.
updateRoutes.post(
  '/',
  describeRoute({
    tags: ['update'],
    description: 'Signal sandbox update. Actual image pull + recreate is handled by kortix-api.',
    responses: {
      200: { description: 'Update acknowledged' },
      400: { description: 'Bad request' },
      409: { description: 'Update already in progress' },
    },
  }),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const targetVersion = body?.version;

    if (!targetVersion) {
      return c.json({ success: false, error: 'Missing version' }, 400);
    }

    const currentVersion = await readLocalVersion();

    // Already at target version
    if (currentVersion === targetVersion) {
      return c.json({
        success: true,
        upToDate: true,
        message: `Already at version ${currentVersion}`,
        version: currentVersion,
      });
    }

    // Signal that update is expected (the actual update happens via API container recreate)
    await setStatus({
      inProgress: true,
      phase: 'pending_recreate',
      message: `Update to ${targetVersion} pending — container will be recreated by kortix-api`,
      targetVersion,
      previousVersion: currentVersion,
      error: null,
    });

    return c.json({
      success: true,
      message: `Update to ${targetVersion} acknowledged. Container recreate will be triggered by kortix-api.`,
      currentVersion,
      targetVersion,
      action: 'recreate',
    });
  },
);

// GET /kortix/update/status — Check update status
updateRoutes.get(
  '/status',
  describeRoute({
    tags: ['update'],
    description: 'Get current update status',
    responses: {
      200: { description: 'Current update status' },
    },
  }),
  async (c) => {
    const status = await getStatus();
    const currentVersion = await readLocalVersion();
    return c.json({ ...status, currentVersion });
  },
);

// GET /kortix/update/version — Get current version info
updateRoutes.get(
  '/version',
  describeRoute({
    tags: ['update'],
    description: 'Get sandbox version info',
    responses: {
      200: { description: 'Version info' },
    },
  }),
  async (c) => {
    const version = await readLocalVersion();
    return c.json({ version, imageVersion: version });
  },
);

export { updateRoutes };
