import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { SecretStore } from '../services/secret-store'
import { loadBootstrapEnv } from '../services/bootstrap-env'

const S6_ENV_DIR = process.env.S6_ENV_DIR || '/run/s6/container_environment'

async function main() {
  // Load bootstrap env FIRST — restores KORTIX_TOKEN (the SecretStore encryption
  // key) from the persistent bootstrap file before we try to decrypt secrets.
  // Without this, KORTIX_TOKEN may be empty (Docker passes it as "" on restart),
  // causing SecretStore to use 'default-key' and fail to decrypt, which triggers
  // destructive auto-purge of all encrypted secrets.
  loadBootstrapEnv()

  const store = new SecretStore()
  const envVars = await store.getAll()

  if (!existsSync(S6_ENV_DIR)) {
    await mkdir(S6_ENV_DIR, { recursive: true })
  }

  let count = 0
  for (const [key, value] of Object.entries(envVars)) {
    // Skip empty values — these are seed placeholders (from seed-env.json).
    // Writing them to S6 env dir would overwrite real Docker env vars injected
    // at container creation (e.g. TAVILY_API_URL set by Daytona/JustAVPS).
    if (!value) continue
    await Bun.write(`${S6_ENV_DIR}/${key}`, value)
    count++
  }

  console.log(`[sync-s6-env] Wrote ${count} env var(s) to ${S6_ENV_DIR}`)
}

await main()
