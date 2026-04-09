import { describe, expect, it } from 'bun:test'
import { getSafeFullReloadFallback } from '../../src/services/runtime-reload'

describe('runtime reload safeguards', () => {
  it('downgrades full reloads from an unprivileged local sandbox process', () => {
    expect(getSafeFullReloadFallback({ envMode: 'local', uid: 1000 })).toContain('avoid a kortix-master restart loop')
  })

  it('allows full reloads when the local process is privileged', () => {
    expect(getSafeFullReloadFallback({ envMode: 'local', uid: 0 })).toBeNull()
  })

  it('does not downgrade cloud full reloads just because the uid is non-root', () => {
    expect(getSafeFullReloadFallback({ envMode: 'cloud', uid: 1000 })).toBeNull()
  })
})
