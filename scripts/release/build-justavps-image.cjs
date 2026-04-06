#!/usr/bin/env node

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const RELEASE_JSON = path.join(ROOT, 'core', 'release.json')
const API_ENV_PATH = path.join(ROOT, 'apps', 'api', '.env')
const API_ENV_PROD_PATH = path.join(ROOT, 'apps', 'api', '.env.prod')
const START_SANDBOX_SCRIPT = path.join(ROOT, 'scripts', 'start-sandbox.sh')

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const versionArg = args.find((arg) => !arg.startsWith('--') && /^\d+\.\d+\.\d+$/.test(arg))

const FORCE = flags.has('--yes') || flags.has('--force') || flags.has('-y')
const DRY_RUN = flags.has('--dry-run')
const HELP = flags.has('--help') || flags.has('-h')
const NO_VERIFY = flags.has('--no-verify')

const G = '\x1b[32m'
const R = '\x1b[31m'
const Y = '\x1b[33m'
const C = '\x1b[36m'
const B = '\x1b[1m'
const X = '\x1b[0m'

const ok = (msg) => console.log(`  ${G}✓${X} ${msg}`)
const info = (msg) => console.log(`  ${C}▸${X} ${msg}`)
const warn = (msg) => console.log(`  ${Y}!${X} ${msg}`)
const fail = (msg) => {
  console.error(`  ${R}✗${X} ${msg}`)
  process.exit(1)
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const rawValue = trimmed.slice(idx + 1)
    if (!(key in process.env)) process.env[key] = rawValue
  }
}

function writeEnvValue(filePath, key, value) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const lines = content.split(/\r?\n/)
  let found = false
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true
      return `${key}=${value}`
    }
    return line
  })
  if (!found) nextLines.push(`${key}=${value}`)
  fs.writeFileSync(filePath, `${nextLines.filter((line, index, arr) => !(index === arr.length - 1 && line === '')).join('\n')}\n`)
}

function getRequiredEnv(key) {
  const value = process.env[key]
  if (!value) fail(`Missing ${key}`)
  return value
}

function getVersion() {
  if (versionArg) return versionArg
  const release = JSON.parse(fs.readFileSync(RELEASE_JSON, 'utf8'))
  return release.version
}

// ─── Dual-org target support ────────────────────────────────────────────────
// Both dev and prod JustAVPS orgs need snapshot images.
// The script reads keys from apps/api/.env (dev) and apps/api/.env.prod (prod).
const targetFlag = args.find((arg) => arg.startsWith('--target='))
const targetArgIndex = args.findIndex((arg) => arg === '--target')
const targetArg = targetFlag
  ? targetFlag.split('=')[1]
  : (targetArgIndex !== -1 && args[targetArgIndex + 1] ? args[targetArgIndex + 1] : '')
const TARGETS = targetArg
  ? targetArg.split(',').map((v) => v.trim()).filter(Boolean)
  : ['dev', 'prod']

function getTargetConfig(target) {
  const normalized = target === 'production' ? 'prod' : target
  if (!['dev', 'prod'].includes(normalized)) fail(`Unknown --target value: ${target}. Use dev or prod.`)
  const envPath = normalized === 'prod' ? API_ENV_PROD_PATH : API_ENV_PATH
  return {
    target: normalized,
    envPath,
    imageName: `kortix-computer-v${getVersion()}`,
  }
}

function loadTargetEnv(envPath) {
  const keysToReset = [
    'JUSTAVPS_API_URL', 'JUSTAVPS_API_KEY', 'JUSTAVPS_IMAGE_ID',
    'JUSTAVPS_DEFAULT_SERVER_TYPE', 'JUSTAVPS_DEFAULT_LOCATION',
    'JUSTAVPS_IMAGE_BUILD_SERVER_TYPE', 'JUSTAVPS_IMAGE_BUILD_LOCATION',
    'JUSTAVPS_IMAGE_BUILD_TIMEOUT_MS', 'JUSTAVPS_IMAGE_CREATE_TIMEOUT_MS',
    'JUSTAVPS_PROXY_DOMAIN', 'JUSTAVPS_WEBHOOK_URL',
  ]
  for (const key of keysToReset) delete process.env[key]
  loadDotEnv(envPath)
  if (!process.env.JUSTAVPS_API_URL) {
    process.env.JUSTAVPS_API_URL = 'https://justavps.com/api/v1'
  }
  if (/dev\.justavps\.com/i.test(process.env.JUSTAVPS_API_URL || '')) {
    fail(`JUSTAVPS_API_URL must point to justavps.com, not dev.justavps.com (${process.env.JUSTAVPS_API_URL})`)
  }
}

if (HELP) {
  console.log(`
Usage:
  pnpm image [version]                Build JustAVPS images for dev + prod orgs in parallel
  pnpm image --target dev [version]   Build only the dev org image
  pnpm image --target prod [version]  Build only the prod org image
  pnpm image --dry-run [version]      Validate config without creating resources
  pnpm image --yes [version]          Replace any existing image with the same release name
  pnpm image --no-verify [version]    Skip booting a verification machine from the new image

Env files:
  dev  -> apps/api/.env       (override with JUSTAVPS_DEV_ENV_FILE)
  prod -> apps/api/.env.prod  (override with JUSTAVPS_PROD_ENV_FILE)

Env used from the selected env file:
  JUSTAVPS_API_URL    (always justavps.com, never dev.justavps.com)
  JUSTAVPS_API_KEY
  JUSTAVPS_IMAGE_ID
  JUSTAVPS_DEFAULT_SERVER_TYPE
  JUSTAVPS_DEFAULT_LOCATION
  JUSTAVPS_IMAGE_BUILD_SERVER_TYPE   (optional)
  JUSTAVPS_IMAGE_BUILD_LOCATION      (optional)
`)
  process.exit(0)
}

async function api(pathname, options = {}) {
  const baseUrl = getRequiredEnv('JUSTAVPS_API_URL').replace(/\/$/, '')
  const apiKey = getRequiredEnv('JUSTAVPS_API_KEY')
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const error = new Error(`JustAVPS API ${options.method || 'GET'} ${pathname} -> ${response.status}: ${text.slice(0, 500)}`)
    error.status = response.status
    error.body = text
    throw error
  }

  if (response.status === 204) return null
  return response.json()
}

async function waitForMachineReady(machineId, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const machine = await api(`/machines/${machineId}`)
    if (machine.status === 'ready') return machine
    if (machine.status === 'error' || machine.status === 'deleted') {
      throw new Error(`Build machine ${machineId} entered '${machine.status}' state`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  throw new Error(`Build machine ${machineId} did not become ready within ${Math.floor(timeoutMs / 1000)}s`)
}

async function waitForSsh(machine, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await sshExec(machine, 'echo ok', 15_000)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
  throw new Error(`SSH never became ready for machine ${machine.id}`)
}

async function waitForImageReady(imageId, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const image = await api(`/images/${imageId}`)
    if (image.status === 'ready' && image.provider_image_id) return image
    if (image.status === 'failed' || image.status === 'deleted') {
      const detail = image.description ? `: ${image.description}` : ''
      throw new Error(`Image ${imageId} entered '${image.status}' state${detail}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  throw new Error(`Image ${imageId} did not become ready within ${Math.floor(timeoutMs / 1000)}s`)
}

async function deleteImageIfPresent(imageId) {
  if (!imageId) return
  try {
    await api(`/images/${imageId}`, { method: 'DELETE' })
    ok(`Deleted previous JustAVPS image ${imageId}`)
  } catch (error) {
    warn(`Failed to delete previous image ${imageId}: ${error.message}`)
  }
}

async function deleteMachineIfPresent(machineId) {
  if (!machineId) return
  try {
    await api(`/machines/${machineId}`, { method: 'DELETE' })
    ok(`Deleted machine ${machineId}`)
  } catch (error) {
    warn(`Failed to delete machine ${machineId}: ${error.message}`)
  }
}

function withTempSshKey(machine, fn) {
  const privateKey = machine?.ssh_key?.private_key
  if (!machine?.ip || !privateKey) {
    throw new Error(`Machine ${machine?.id || 'unknown'} does not expose root SSH details`)
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `justavps-image-${machine.id}-`))
  const keyPath = path.join(dir, 'id_ed25519')
  fs.writeFileSync(keyPath, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`, { mode: 0o600 })

  try {
    return fn({ ip: machine.ip, keyPath })
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

function sshExec(machine, command, timeoutMs = 60_000) {
  return withTempSshKey(machine, ({ ip, keyPath }) => execFileSync(
    'ssh',
    [
      '-i', keyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=15',
      `root@${ip}`,
      command,
    ],
    { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] },
  ))
}

function uploadFile(machine, localPath, remotePath) {
  return withTempSshKey(machine, ({ ip, keyPath }) => execFileSync(
    'scp',
    [
      '-i', keyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=15',
      localPath,
      `root@${ip}:${remotePath}`,
    ],
    { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
  ))
}

function verifySandboxSshBridge(machine) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `justavps-abc-${machine.id}-`))
  const keyPath = path.join(tempDir, 'id_ed25519')

  try {
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'justavps-image-verify', '-f', keyPath], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim()
    const publicKeyB64 = Buffer.from(`${publicKey}\n`).toString('base64')
    const injectCmd = [
      'mkdir -p /config/.ssh',
      `printf '%s' '${publicKeyB64}' | base64 -d >> /config/.ssh/authorized_keys`,
      'sort -u -o /config/.ssh/authorized_keys /config/.ssh/authorized_keys',
      'chmod 700 /config/.ssh',
      'chmod 600 /config/.ssh/authorized_keys',
      'chown -R abc:abc /config/.ssh',
    ].join(' && ')

    sshExec(machine, `docker exec justavps-workload sh -lc ${JSON.stringify(injectCmd)}`, 20_000)

    const whoami = execFileSync('ssh', [
      '-i', keyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=15',
      `abc@${machine.ip}`,
      'whoami',
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

    if (whoami !== 'abc') {
      throw new Error(`abc SSH bridge returned '${whoami}'`)
    }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
  }
}

async function bootstrapSandboxRuntime(machine, dockerImage) {
  if (!fs.existsSync(START_SANDBOX_SCRIPT)) {
    throw new Error(`Missing ${START_SANDBOX_SCRIPT}`)
  }

  info(`Bootstrapping sandbox runtime on ${machine.id}...`)
  const tempScript = path.join(os.tmpdir(), `start-sandbox-${machine.id}.sh`)
  fs.copyFileSync(START_SANDBOX_SCRIPT, tempScript)

  try {
    uploadFile(machine, tempScript, '/root/start-sandbox.sh')
    sshExec(machine, 'chmod +x /root/start-sandbox.sh')
    sshExec(machine, `bash /root/start-sandbox.sh ${JSON.stringify(dockerImage)}`, 10 * 60 * 1000)
  } finally {
    try { fs.unlinkSync(tempScript) } catch {}
  }
}

async function verifySandboxRuntime(machineId, { dockerImage, bootstrap = false, scrubEnv = false } = {}) {
  let machine = await api(`/machines/${machineId}`)
  await waitForSsh(machine, 5 * 60 * 1000)

  if (bootstrap) {
    await bootstrapSandboxRuntime(machine, dockerImage)
    machine = await api(`/machines/${machineId}`)
  }

  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < 5 * 60 * 1000) {
    try {
      const checks = {
        unit: sshExec(machine, "systemctl list-unit-files | grep '^justavps-docker.service'", 20_000).trim(),
        active: sshExec(machine, 'systemctl is-active justavps-docker', 20_000).trim(),
        container: sshExec(machine, "docker ps --format '{{.Names}}' | grep '^justavps-workload$'", 20_000).trim(),
        health: sshExec(machine, "curl -fsS http://127.0.0.1:8000/kortix/health || curl -fsS http://127.0.0.1:8000/", 20_000).trim(),
      }

      if (!checks.unit.includes('justavps-docker.service')) throw new Error('justavps-docker.service missing')
      if (checks.active !== 'active') throw new Error(`justavps-docker not active (${checks.active})`)
      if (checks.container !== 'justavps-workload') throw new Error('justavps-workload container missing')
      if (!checks.health) throw new Error('port 8000 returned empty response')

      verifySandboxSshBridge(machine)

      if (scrubEnv) {
        sshExec(machine, 'truncate -s 0 /etc/justavps/env && sync', 20_000)
      }
      ok(`Sandbox runtime verified on ${machine.id}`)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  throw new Error(`Sandbox runtime verification failed for ${machineId}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function mainForTarget(target) {
  const { envPath, imageName } = getTargetConfig(target)
  loadTargetEnv(envPath)

  const version = getVersion()
  const dockerImage = `kortix/computer:${version}`
  const buildServerType = process.env.JUSTAVPS_IMAGE_BUILD_SERVER_TYPE || process.env.JUSTAVPS_DEFAULT_SERVER_TYPE || 'cpx32'
  const buildRegion = process.env.JUSTAVPS_IMAGE_BUILD_LOCATION || 'nbg1'
  const previousImageId = process.env.JUSTAVPS_IMAGE_ID || ''
  const machineTimeoutMs = Number(process.env.JUSTAVPS_IMAGE_BUILD_TIMEOUT_MS || 20 * 60 * 1000)
  const imageTimeoutMs = Number(process.env.JUSTAVPS_IMAGE_CREATE_TIMEOUT_MS || 45 * 60 * 1000)

  console.log('')
  console.log(`  ${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}`)
  console.log(`  ${B}Build JustAVPS Image v${version}${DRY_RUN ? ' [dry-run]' : ''}${X}`)
  console.log(`  ${B}Image Name:${X} ${imageName}`)
  console.log(`  ${B}Docker:${X}     ${dockerImage}`)
  console.log(`  ${B}Builder:${X}    ${buildServerType} @ ${buildRegion}`)
  console.log(`  ${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}`)
  console.log('')

  const images = await api('/images')
  const conflicting = (images.images || []).filter((image) => image.name === imageName && image.status !== 'deleted' && !image.is_template)
  if (conflicting.length > 0 && !FORCE && !DRY_RUN) {
    fail(`Image '${imageName}' already exists (${conflicting.map((img) => img.id).join(', ')}). Re-run with --yes to replace it.`)
  }

  if (DRY_RUN) {
    if (conflicting.length > 0) {
      warn(`Dry run: image '${imageName}' already exists (${conflicting.map((img) => img.id).join(', ')}). --yes would replace it.`)
    }
    ok('Dry run complete — configuration looks valid')
    return
  }

  for (const image of conflicting) {
    info(`Deleting existing image ${image.id} (${image.name})...`)
    await api(`/images/${image.id}`, { method: 'DELETE' })
    ok(`Deleted ${image.id}`)
  }

  let machineId = ''

  try {
    info('Creating temporary JustAVPS build machine...')
    const machine = await api('/machines', {
      method: 'POST',
      body: {
        provider: 'cloud',
        server_type: buildServerType,
        region: buildRegion,
        name: `kortix-image-builder-${version}`,
        docker_image: dockerImage,
        env_vars: {
          ENV_MODE: 'cloud',
          KORTIX_SANDBOX_VERSION: version,
        },
      },
    })

    if (!machine?.id) {
      fail('JustAVPS did not return a machine id')
    }
    machineId = machine.id
    ok(`Build machine created: ${machineId}`)

    info('Waiting for build machine to become ready...')
    const readyMachine = await waitForMachineReady(machineId, machineTimeoutMs)
    ok(`Build machine ready${readyMachine.ip ? ` (${readyMachine.ip})` : ''}`)

    await verifySandboxRuntime(machineId, { dockerImage, bootstrap: true, scrubEnv: true })

    info('Creating JustAVPS image from build machine...')
    const image = await api(`/machines/${machineId}/image`, {
      method: 'POST',
      body: { name: imageName },
    })

    if (!image?.id) {
      fail('JustAVPS did not return an image id')
    }
    ok(`Image creation started: ${image.id}`)

    info('Waiting for image to become ready...')
    const readyImage = await waitForImageReady(image.id, imageTimeoutMs)
    ok(`Image ready: ${readyImage.id} (provider image ${readyImage.provider_image_id})`)

    info(`Deleting temporary build machine ${machineId}...`)
    await deleteMachineIfPresent(machineId)
    machineId = ''

    if (!NO_VERIFY) {
      info('Verifying the new image by booting a fresh JustAVPS machine...')
      const verifyMachine = await api('/machines', {
        method: 'POST',
        body: {
          provider: 'cloud',
          image_id: readyImage.id,
          server_type: buildServerType,
          region: buildRegion,
          name: `kortix-image-verify-${version}`,
          docker_image: dockerImage,
          env_vars: {
            ENV_MODE: 'cloud',
            KORTIX_SANDBOX_VERSION: version,
          },
        },
      })
      if (!verifyMachine?.id) {
        fail('JustAVPS did not return a verification machine id')
      }
      const verifyMachineId = verifyMachine.id
      ok(`Verification machine created: ${verifyMachineId}`)
      try {
        const readyVerifyMachine = await waitForMachineReady(verifyMachineId, machineTimeoutMs)
        ok(`Verification machine ready${readyVerifyMachine.ip ? ` (${readyVerifyMachine.ip})` : ''}`)
        await verifySandboxRuntime(verifyMachineId, { dockerImage, bootstrap: false, scrubEnv: false })
      } finally {
        info(`Deleting verification machine ${verifyMachineId}...`)
        await deleteMachineIfPresent(verifyMachineId)
      }
    }

    console.log('')
    console.log(`  ${G}${B}✓ JustAVPS image ready${X}`)
    console.log(`  ${B}Image Name:${X}      ${imageName}`)
    console.log(`  ${B}JustAVPS ID:${X}     ${readyImage.id}`)
    console.log(`  ${B}Provider ID:${X}     ${readyImage.provider_image_id}`)
    console.log(`  ${B}Auto-resolve:${X}    The API will auto-pick this as the latest kortix-computer-v* image.`)
    console.log(`  ${B}Override:${X}        Set JUSTAVPS_IMAGE_ID=${readyImage.id} to pin this version.`)
    console.log('')
  } finally {
    if (machineId) {
      info(`Deleting temporary build machine ${machineId}...`)
      await deleteMachineIfPresent(machineId)
    }
  }
}

async function main() {
  // Run targets sequentially (they share process.env for API key)
  for (const target of TARGETS) {
    info(`\n━━━ Building for target: ${target} ━━━`)
    await mainForTarget(target)
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
