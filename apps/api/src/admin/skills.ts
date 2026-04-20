/**
 * Skill management — super_admin only.
 *
 * Lets operators upload / list / delete skills without touching the repo
 * by hand. Skills live under:
 *
 *   <repoRoot>/core/kortix-master/opencode/skills/custom/<skill-name>/
 *
 * We deliberately confine uploads to the "custom/" category so they never
 * collide with upstream-shipped skills under GENERAL-KNOWLEDGE-WORKER/ or
 * KORTIX-system/. Uninstalling an upstream skill requires editing the repo.
 *
 * Zip format expectations:
 *   - The uploaded zip is extracted into the skill's target directory.
 *   - It MUST contain a SKILL.md at its root after extraction (either the
 *     zip has SKILL.md at the top level, or it has exactly one top-level
 *     directory that contains SKILL.md — we auto-detect and flatten).
 *
 * Runtime:
 *   - This module only writes files. Running sandboxes pick up the new
 *     skill after their next `instance.dispose()` / reload. For now users
 *     may need to restart the sandbox to see the change — we don't wire
 *     auto-reload here to keep the surface small.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';
import type { AppEnv } from '../types';
import type { PlatformRole } from '../shared/platform-roles';

export const skillsApp = new Hono<AppEnv>();

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(SKILL_NAME_REGEX, 'Skill name must be lowercase-hyphenated (e.g. my-skill)');

function requireSuperAdmin(c: Parameters<Parameters<typeof skillsApp.get>[1]>[0]) {
  const role = c.get('platformRole') as PlatformRole | undefined;
  return role === 'super_admin';
}

/**
 * Find the monorepo root by walking up from cwd until we see the marker
 * `docker-compose.local.yml`. Same strategy as admin/index.ts:findRepoRoot.
 */
function findRepoRoot(): string | null {
  const candidates = [
    process.cwd(),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '../..'),
    resolve(__dirname, '../../../..'),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'docker-compose.local.yml'))) {
      return dir;
    }
  }
  return null;
}

function getSkillsDir(): string | null {
  const root = findRepoRoot();
  if (!root) return null;
  const dir = resolve(root, 'core/kortix-master/opencode/skills/custom');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

interface SkillEntry {
  name: string;
  description: string | null;
  path: string; // absolute path to skill directory
  hasScripts: boolean;
  updatedAt: string; // iso
}

/**
 * Parse minimal YAML frontmatter: lines between --- markers. Returns the
 * first `name` and `description` values only; that's all the UI needs.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return {};
  const out: { name?: string; description?: string } = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i]!;
    const m = line.match(/^(name|description)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1] as 'name' | 'description'] = value;
  }
  return out;
}

function readInstalledSkills(): SkillEntry[] {
  const dir = getSkillsDir();
  if (!dir) return [];
  const entries: SkillEntry[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    const skillMd = join(full, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const content = readFileSync(skillMd, 'utf-8');
    const fm = parseFrontmatter(content);
    entries.push({
      name,
      description: fm.description ?? null,
      path: full,
      hasScripts: existsSync(join(full, 'scripts')),
      updatedAt: statSync(skillMd).mtime.toISOString(),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GET /v1/admin/api/skills
 * List installed custom skills.
 */
skillsApp.get('/', async (c) => {
  if (!requireSuperAdmin(c)) return c.json({ error: 'super_admin required' }, 403);
  const dir = getSkillsDir();
  if (!dir) {
    return c.json({ skills: [], error: 'Repo root not found; skills dir unavailable' }, 500);
  }
  return c.json({ skillsDir: dir, skills: readInstalledSkills() });
});

/**
 * POST /v1/admin/api/skills
 * Multipart form: name (text), file (zip).
 * Extracts the zip into <skillsDir>/<name>/, validating SKILL.md exists.
 */
skillsApp.post('/', async (c) => {
  if (!requireSuperAdmin(c)) return c.json({ error: 'super_admin required' }, 403);

  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: 'Expected multipart/form-data' }, 400);

  const rawName = form.get('name');
  const file = form.get('file');
  if (typeof rawName !== 'string') return c.json({ error: 'Missing name' }, 400);
  if (!(file instanceof File)) return c.json({ error: 'Missing file' }, 400);

  const nameParse = nameSchema.safeParse(rawName);
  if (!nameParse.success) {
    return c.json({ error: 'Invalid name', issues: nameParse.error.issues }, 400);
  }
  const name = nameParse.data;

  const skillsDir = getSkillsDir();
  if (!skillsDir) return c.json({ error: 'Skills dir unavailable' }, 500);

  const targetDir = join(skillsDir, name);
  if (existsSync(targetDir)) {
    return c.json({ error: `Skill "${name}" already exists` }, 409);
  }

  // Write zip to a staging file. Extract to a staging dir first so we can
  // normalize structure (flatten if zip wraps everything in one folder).
  const stageId = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stageZip = `/tmp/${stageId}.zip`;
  const stageOut = `/tmp/${stageId}`;

  try {
    writeFileSync(stageZip, Buffer.from(await file.arrayBuffer()));
    mkdirSync(stageOut, { recursive: true });
    execSync(`unzip -q -o "${stageZip}" -d "${stageOut}"`, {
      stdio: 'pipe',
      timeout: 30_000,
    });

    // Detect layout: if there is NO SKILL.md at the root but there IS
    // exactly one top-level directory containing SKILL.md, treat that
    // subdir as the skill root (and "flatten" it).
    let sourceRoot = stageOut;
    if (!existsSync(join(stageOut, 'SKILL.md'))) {
      const topEntries = readdirSync(stageOut).filter((n) => !n.startsWith('.'));
      if (topEntries.length === 1) {
        const candidate = join(stageOut, topEntries[0]!);
        if (statSync(candidate).isDirectory() && existsSync(join(candidate, 'SKILL.md'))) {
          sourceRoot = candidate;
        }
      }
    }

    if (!existsSync(join(sourceRoot, 'SKILL.md'))) {
      return c.json(
        { error: 'Zip must contain SKILL.md (either at root or inside a single top-level folder)' },
        400,
      );
    }

    // Move sourceRoot → targetDir. Use cp -a for simplicity (covers files
    // and nested scripts/ directory with permissions preserved).
    mkdirSync(targetDir, { recursive: true });
    execSync(`cp -a "${sourceRoot}/." "${targetDir}/"`, { stdio: 'pipe', timeout: 30_000 });

    // Read back to return the authoritative entry.
    const content = readFileSync(join(targetDir, 'SKILL.md'), 'utf-8');
    const fm = parseFrontmatter(content);

    return c.json({
      ok: true,
      skill: {
        name,
        description: fm.description ?? null,
        path: targetDir,
        hasScripts: existsSync(join(targetDir, 'scripts')),
      },
    }, 201);
  } catch (err: any) {
    // Clean up partial target
    try { rmSync(targetDir, { recursive: true, force: true }); } catch {}
    return c.json(
      { error: 'Failed to install skill', details: err?.message || String(err) },
      500,
    );
  } finally {
    try { rmSync(stageZip, { force: true }); } catch {}
    try { rmSync(stageOut, { recursive: true, force: true }); } catch {}
  }
});

/**
 * DELETE /v1/admin/api/skills/:name
 * Remove the custom skill directory.
 */
skillsApp.delete('/:name', async (c) => {
  if (!requireSuperAdmin(c)) return c.json({ error: 'super_admin required' }, 403);

  const parsed = nameSchema.safeParse(c.req.param('name'));
  if (!parsed.success) return c.json({ error: 'Invalid name' }, 400);
  const name = parsed.data;

  const skillsDir = getSkillsDir();
  if (!skillsDir) return c.json({ error: 'Skills dir unavailable' }, 500);

  const targetDir = join(skillsDir, name);
  if (!existsSync(targetDir)) return c.json({ error: 'Skill not found' }, 404);

  try {
    rmSync(targetDir, { recursive: true, force: true });
    return c.json({ ok: true, removed: name });
  } catch (err: any) {
    return c.json(
      { error: 'Failed to delete skill', details: err?.message || String(err) },
      500,
    );
  }
});
