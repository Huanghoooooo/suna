#!/usr/bin/env node
/**
 * ship.cjs — Kortix release script
 *
 * Usage:
 *   pnpm ship <version>                  Build + push 3 Docker images, create GitHub Release, seed JustAVPS image
 *   pnpm ship --no-docker <version>      Version bump only, no Docker build or image seed
 *   pnpm ship --check                Show current state
 *   pnpm ship --dry-run <version>    Validate only, no changes
 *   pnpm ship --help                 Show this help
 *
 * What it does:
 *   1. Validates changelog entry exists for the version
 *   2. Bumps versions in release.json, package.json, get-kortix.sh
 *   3. Creates GitHub Release with changelog
 *   4. Builds + pushes 3 Docker images (sandbox, api, frontend)
 *   5. Builds the matching JustAVPS image from a temporary machine
 *   6. Commits version bump and pushes to origin/main
 *   7. Verifies: GitHub raw URL, Docker manifests all serve the new version
 *   8. Appends to core/releases.log (git-versioned audit trail)
 *
 * That's it. No npm packages, no OTA tarballs, no staging, no symlinks.
 * Updating a running sandbox = pull new image + recreate container.
 */

const { execSync, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const CORE_DIR = path.join(ROOT, 'core')
const RELEASE_JSON = path.join(CORE_DIR, 'release.json')
const PACKAGE_JSON = path.join(CORE_DIR, 'package.json')
const CHANGELOG_JSON = path.join(CORE_DIR, 'CHANGELOG.json')
const GET_KORTIX = path.join(ROOT, 'scripts', 'get-kortix.sh')
const BUILD_JUSTAVPS_IMAGE = path.join(ROOT, 'scripts', 'release', 'build-justavps-image.cjs')
const RELEASES_LOG = path.join(CORE_DIR, 'releases.log')

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const version = args.find(a => !a.startsWith('--') && /^\d+\.\d+\.\d+$/.test(a))

const DOCKER = !flags.has('--no-docker')
const CHECK = flags.has('--check')
const HELP = flags.has('--help') || flags.has('-h')
const DRY = flags.has('--dry-run')

// Colors
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m'
const D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m'
const ok   = m => console.log(`  ${G}✓${X} ${m}`)
const fail = m => { console.error(`  ${R}✗${X} ${m}`); process.exit(1) }
const info = m => console.log(`  ${C}▸${X} ${m}`)
const warn = m => console.log(`  ${Y}!${X} ${m}`)

function run(cmd, opts = {}) {
  const output = execSync(cmd, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    ...opts,
  })
  return typeof output === 'string' ? output.trim() : ''
}

function runPnpm(args, opts = {}) {
  const env = {
    ...process.env,
    ...opts.env,
    PATH: `${path.dirname(process.execPath)}:${opts.env?.PATH || process.env.PATH || ''}`,
  }
  const pnpmExecPath = process.env.npm_execpath
  if (pnpmExecPath && fs.existsSync(pnpmExecPath)) {
    return execFileSync(process.execPath, [pnpmExecPath, ...args], { ...opts, env, cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: opts.stdio || 'pipe' })
  }
  return run(`pnpm ${args.map((arg) => JSON.stringify(arg)).join(' ')}`, { ...opts, env })
}

if (HELP) {
  console.log(`
Usage:
  pnpm ship <version>                  Build + push Docker images + seed JustAVPS image
  pnpm ship --no-docker <version>      Version bump only
  pnpm ship --check                    Show current state
  pnpm ship --dry-run <version>        Validate only
  pnpm ship --help                     Show this help

Examples:
  pnpm ship 0.8.0
  pnpm ship --no-docker 0.8.0
`)
  process.exit(0)
}

// ─── CHECK MODE ──────────────────────────────────────────────────────────────
if (CHECK) {
  info('Current state:')
  const release = JSON.parse(fs.readFileSync(RELEASE_JSON))
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON))
  console.log(`  release.json: ${release.version}`)
  console.log(`  package.json: ${pkg.version}`)
  // Check consistency
  if (release.version !== pkg.version) {
    warn(`Version mismatch: release.json=${release.version}, package.json=${pkg.version}`)
  }
  const installerMatch = fs.readFileSync(GET_KORTIX, 'utf8').match(/DEFAULT_KORTIX_VERSION="([^"]*)"/)
  if (installerMatch && installerMatch[1] !== release.version) {
    warn(`get-kortix.sh has ${installerMatch[1]}, expected ${release.version}`)
  }
  const gitStatus = run('git status --short')
  if (gitStatus) {
    warn('Uncommitted changes:')
    gitStatus.split('\n').forEach(l => console.log('    ' + l))
  } else {
    ok('Working tree clean')
  }
  try { run('gh auth status'); ok('gh auth OK') } catch { warn('gh CLI not authenticated') }
  process.exit(0)
}

// ─── RELEASE MODE ────────────────────────────────────────────────────────────
if (!version) {
  console.error(`${R}Error: No version specified${X}`)
  console.error(`Usage: pnpm ship <version>  (e.g. pnpm ship 0.8.0)`)
  process.exit(1)
}

console.log(`\n  ${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}`)
console.log(`  ${B}  Ship v${version}${DOCKER ? ' + Docker' : ''}${DRY ? ' [dry-run]' : ''}${X}`)
console.log(`  ${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}\n`)

// ── Step 1: Validate ──────────────────────────────────────────────────────
info('Validating...')

const changelog = JSON.parse(fs.readFileSync(CHANGELOG_JSON))
const entry = changelog.find(e => e.version === version)
if (!entry) {
  fail(`No changelog entry for v${version}. Add one to core/CHANGELOG.json first.`)
}
ok(`Changelog: "${entry.title}"`)

let releaseExists = false
try {
  run(`gh release view "v${version}" --repo kortix-ai/suna`)
  releaseExists = true
  warn(`GitHub release v${version} already exists — reusing`)
} catch (e) {
  if (!String(e).includes('release not found') && !e.message?.includes('release not found') && !e.stderr?.includes('release not found')) {
    fail(`Failed to check GitHub release: ${e.message || e}`)
  }
  ok(`GitHub release v${version} not yet created`)
}

if (DRY) {
  ok('Dry run complete — no changes made')
  process.exit(0)
}

// ── Step 2: Bump versions ─────────────────────────────────────────────────
info('Bumping versions...')

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON))
pkg.version = version
fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n')
ok(`package.json → ${version}`)

const release = JSON.parse(fs.readFileSync(RELEASE_JSON))
release.version = version
release.images = {
  sandbox: `kortix/computer:${version}`,
  api: `kortix/kortix-api:${version}`,
  frontend: `kortix/kortix-frontend:${version}`,
}
release.snapshots = {
  daytona: `kortix-sandbox-v${version}`,
}
fs.writeFileSync(RELEASE_JSON, JSON.stringify(release, null, 2) + '\n')
ok(`release.json → ${version}`)

if (fs.existsSync(GET_KORTIX)) {
  let installer = fs.readFileSync(GET_KORTIX, 'utf8')
  installer = installer.replace(/DEFAULT_KORTIX_VERSION="[^"]*"/, `DEFAULT_KORTIX_VERSION="${version}"`)
  fs.writeFileSync(GET_KORTIX, installer)
  ok(`get-kortix.sh → ${version}`)
}

// ── Step 3: GitHub Release ────────────────────────────────────────────────
info('Creating GitHub release...')

const releaseNotes = `## ${entry.title}

${entry.description || ''}

### Changes

${entry.changes.map(c => `- **${c.type}**: ${c.text}`).join('\n')}

### How to Update

Pull the new Docker image and recreate your container:
\`\`\`
docker pull kortix/computer:${version}
\`\`\`
Or click **Update** in the Kortix sidebar.
`

const notesFile = path.join(require('node:os').tmpdir(), `kortix-ship-${version}-notes.md`)
fs.writeFileSync(notesFile, releaseNotes)

if (!releaseExists) {
  run(`gh release create "v${version}" \
    --repo kortix-ai/suna \
    --title "v${version} — ${entry.title}" \
    --notes-file "${notesFile}" \
    --latest`)
  ok(`GitHub release v${version} created`)
} else {
  ok(`GitHub release v${version} already exists`)
}

fs.rmSync(notesFile, { force: true })

// ── Step 4: Docker + JustAVPS image ──────────────────────────────────────
if (DOCKER) {
  info('Building Docker images...')

  // Sandbox
  run(`docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --provenance=false \
    --sbom=false \
    -f core/docker/Dockerfile \
    --build-arg SANDBOX_VERSION=${version} \
    -t kortix/computer:${version} \
    -t kortix/computer:latest \
    --push "${ROOT}"`, { stdio: 'inherit' })
  ok(`kortix/computer:${version} pushed`)

  // API
  run(`docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --provenance=false \
    --sbom=false \
    --build-arg SERVICE=apps/api \
    -f apps/api/Dockerfile \
    -t kortix/kortix-api:${version} \
    -t kortix/kortix-api:latest \
    --push "${ROOT}"`, { stdio: 'inherit' })
  ok(`kortix/kortix-api:${version} pushed`)

  // Frontend (multi-stage Docker build — no host build needed)
  info('Building frontend...')
  run(`docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --provenance=false \
    --sbom=false \
    -f apps/web/Dockerfile \
    -t kortix/kortix-frontend:${version} \
    -t kortix/kortix-frontend:latest \
    --push "${ROOT}"`, { stdio: 'inherit' })
  ok(`kortix/kortix-frontend:${version} pushed`)

  info('Seeding JustAVPS image...')
  if (!fs.existsSync(BUILD_JUSTAVPS_IMAGE)) {
    fail(`Missing JustAVPS image script: ${BUILD_JUSTAVPS_IMAGE}`)
  }
  run(`${JSON.stringify(process.execPath)} ${JSON.stringify(BUILD_JUSTAVPS_IMAGE)} --yes ${version}`, {
    stdio: 'inherit',
  })
  ok(`JustAVPS image for v${version} ready`)
}


// ── Step 5: Commit + Push ─────────────────────────────────────────────────
info('Committing version bump...')
run(`git add \
  core/package.json \
  core/release.json \
  core/CHANGELOG.json \
  scripts/get-kortix.sh`)
const hasStagedChanges = run('git diff --cached --name-only')
if (hasStagedChanges) {
  run(`git commit -m "release: v${version}"`)
  ok(`Committed: release v${version}`)
} else {
  ok(`No version-bump commit needed`)
}

info('Pushing to origin/main...')
try {
  run('git push origin main')
  ok('Pushed to origin/main')
} catch (e) {
  warn(`git push failed: ${e.message || e}`)
  warn('You need to push manually: git push origin main')
}

// ── Step 6: Post-ship verification ────────────────────────────────────────
info('Verifying release artifacts...')

let verifyPassed = 0
let verifyFailed = 0

// 6a. Verify GitHub raw URL serves the new version (retry with backoff for CDN propagation)
let ghVerified = false
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    if (attempt > 0) {
      const delay = attempt * 5
      info(`  Waiting ${delay}s for GitHub CDN propagation...`)
      execSync(`sleep ${delay}`)
    }
    const rawRelease = run(`curl -sf --connect-timeout 5 "https://raw.githubusercontent.com/kortix-ai/suna/main/core/release.json"`)
    const ghVersion = JSON.parse(rawRelease).version
    if (ghVersion === version) {
      ok(`GitHub raw release.json → ${ghVersion}`)
      ghVerified = true
      verifyPassed++
      break
    }
    if (attempt < 5) continue
    warn(`GitHub raw release.json has ${ghVersion}, expected ${version} (CDN may be stale)`)
    verifyFailed++
  } catch (e) {
    if (attempt < 5) continue
    warn(`GitHub raw release.json unreachable: ${e.message || e}`)
    verifyFailed++
  }
}

// 6b. Verify Docker manifests exist
if (DOCKER) {
  const images = [
    `kortix/computer:${version}`,
    `kortix/kortix-api:${version}`,
    `kortix/kortix-frontend:${version}`,
  ]
  for (const img of images) {
    try {
      run(`docker manifest inspect ${img}`, { stdio: 'pipe' })
      ok(`Docker manifest: ${img}`)
      verifyPassed++
    } catch {
      warn(`Docker manifest missing: ${img}`)
      verifyFailed++
    }
  }
}

// 6c. Verify GitHub Release exists
try {
  run(`gh release view "v${version}" --repo kortix-ai/suna`, { stdio: 'pipe' })
  ok(`GitHub release: v${version}`)
  verifyPassed++
} catch {
  warn(`GitHub release v${version} not found`)
  verifyFailed++
}

if (verifyFailed > 0) {
  warn(`Verification: ${verifyPassed} passed, ${verifyFailed} failed — check warnings above`)
} else {
  ok(`Verification: all ${verifyPassed} checks passed`)
}

// ── Step 7: Audit trail ───────────────────────────────────────────────────
const logLine = `${new Date().toISOString()} | ${version} | ${run('git rev-parse --short HEAD')} | ${run('git config user.name').replace(/\|/g, '-')} | docker=${DOCKER ? 'yes' : 'no'} | verify=${verifyFailed === 0 ? 'pass' : `${verifyFailed}-failed`}\n`
fs.appendFileSync(RELEASES_LOG, logLine)
// Stage and amend the audit trail into the release commit
try {
  run(`git add core/releases.log`)
  const logStaged = run('git diff --cached --name-only')
  if (logStaged) {
    run(`git commit --amend --no-edit`)
    run('git push origin main --force-with-lease')
    ok('Audit trail appended to release commit')
  }
} catch (e) {
  warn(`Could not amend audit trail: ${e.message || e}`)
}

// ── Done ──────────────────────────────────────────────────────────────────
console.log(`\n  ${G}${B}✓ v${version} shipped${verifyFailed > 0 ? ` (${verifyFailed} verify warnings)` : ''}!${X}`)
console.log(`\n  ${D}Dashboard: https://kortix.com${X}`)
console.log(`  ${D}GitHub:    https://github.com/kortix-ai/suna/releases/tag/v${version}${X}\n`)
