import PtyToolsPlugin from '../opencode/plugin/pty-tools.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function extractId(xml: string): string {
  const match = xml.match(/ID: (pty_[^\n]+)/)
  if (!match) throw new Error(`Could not extract PTY id from: ${xml}`)
  return match[1]!.trim()
}

const fakeClient = {
  config: { get: async () => ({ data: { permission: {} } }) },
  session: { prompt: async () => ({}) },
} as any

const ctx = {
  sessionID: 'ses_test_pty_tools',
  messageID: 'msg_test_pty_tools',
  agent: 'kortix',
  directory: '/workspace',
  worktree: '/workspace',
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

const hooks = await PtyToolsPlugin({
  client: fakeClient,
  directory: '/workspace',
  worktree: '/workspace',
  serverUrl: new URL('http://127.0.0.1:4096'),
  $: undefined as any,
  project: undefined as any,
})

const tools = hooks.tool ?? {}
for (const toolName of ['pty_spawn', 'pty_write', 'pty_read', 'pty_list', 'pty_kill']) {
  assert(toolName in tools, `missing tool ${toolName}`)
}

const spawnResult = await tools.pty_spawn.execute({
  command: 'bash',
  args: ['-lc', 'echo boot-ok; exec bash -l'],
  workdir: '/workspace',
  title: 'PTY plugin E2E',
  description: 'End to end PTY plugin test',
  notifyOnExit: false,
}, ctx)

const id = extractId(spawnResult)
console.log(`[pty-test] spawned ${id}`)

await new Promise((resolve) => setTimeout(resolve, 1200))

await tools.pty_write.execute({ id, data: 'echo plugin-e2e\n' }, ctx)
await new Promise((resolve) => setTimeout(resolve, 800))

const readResult = await tools.pty_read.execute({ id, limit: 200 }, ctx)
assert(readResult.includes('plugin-e2e'), 'pty_read output did not contain plugin-e2e marker')
console.log('[pty-test] read ok')

const listResult = await tools.pty_list.execute({}, ctx)
assert(listResult.includes(id), 'pty_list did not include spawned session id')
console.log('[pty-test] list ok')

await tools.pty_kill.execute({ id, cleanup: true }, ctx)
await new Promise((resolve) => setTimeout(resolve, 500))

const finalList = await tools.pty_list.execute({}, ctx)
assert(!finalList.includes(id), 'pty session still present after cleanup kill')
console.log('[pty-test] kill ok')
console.log('[pty-test] PASS')
