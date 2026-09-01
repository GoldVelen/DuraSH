import { afterEach, describe, expect, it, vi } from 'vitest'

type ProfileInvocation = {
  mode: 'profile'
  profile: string
  patches: string[]
  args: string[]
}

async function importBinFor(invocation: ProfileInvocation, options: {
  assertGuard?: (profile: string) => void
} = {}) {
  vi.resetModules()
  const runProfile = vi.fn(async () => {})
  const loadLayeredEnv = vi.fn(() => ({ DSH_ENV: 'fixture' }))
  const assertSourceBuildProfile = vi.fn(options.assertGuard ?? (() => {}))

  vi.doMock('../src/args.ts', () => ({
    parseDshArgs: () => invocation,
  }))
  vi.doMock('../src/source-build-profile.ts', () => ({
    assertSourceBuildProfile,
  }))
  vi.doMock('../src/profile-boot.ts', () => ({
    runProfile,
  }))
  vi.doMock('@deepseek-ai/dsh-app-boot', async importOriginal => ({
    ...await importOriginal<typeof import('@deepseek-ai/dsh-app-boot')>(),
    loadLayeredEnv,
  }))

  const loaded = import('../src/bin.ts')
  return { loaded, assertSourceBuildProfile, runProfile, loadLayeredEnv }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('bin source-build-profile dispatch', () => {
  it('bypasses the source-build guard only for pure app help', async () => {
    const subject = await importBinFor({
      mode: 'profile',
      profile: 'durash',
      patches: [],
      args: ['--help'],
    }, {
      assertGuard: () => {
        throw new Error('guard should not run for pure help')
      },
    })

    await expect(subject.loaded).resolves.toBeDefined()
    expect(subject.assertSourceBuildProfile).not.toHaveBeenCalled()
    expect(subject.loadLayeredEnv).toHaveBeenCalledWith('dsh')
    expect(subject.runProfile).toHaveBeenCalledWith({
      environment: { DSH_ENV: 'fixture' },
      profile: 'durash',
      patchFiles: [],
      args: ['--help'],
    })
  })

  it('still rejects a mismatched source build on a non-help profile boot', async () => {
    const subject = await importBinFor({
      mode: 'profile',
      profile: 'durash',
      patches: [],
      args: ['--host', '127.0.0.1'],
    }, {
      assertGuard: () => {
        throw new Error('source build mismatch')
      },
    })

    await expect(subject.loaded).rejects.toThrow(/source build mismatch/u)
    expect(subject.assertSourceBuildProfile).toHaveBeenCalledWith('durash')
    expect(subject.runProfile).not.toHaveBeenCalled()
  })

  it('does not treat an app argument containing -h as pure help', async () => {
    const subject = await importBinFor({
      mode: 'profile',
      profile: 'durash',
      patches: [],
      args: ['--trusted-host', '-h.example'],
    }, {
      assertGuard: () => {
        throw new Error('source build mismatch')
      },
    })

    await expect(subject.loaded).rejects.toThrow(/source build mismatch/u)
    expect(subject.assertSourceBuildProfile).toHaveBeenCalledWith('durash')
    expect(subject.runProfile).not.toHaveBeenCalled()
  })

  it('does not bypass the source-build guard when help is mixed with launch arguments', async () => {
    const subject = await importBinFor({
      mode: 'profile',
      profile: 'durash',
      patches: [],
      args: ['--help', '--host', '127.0.0.1'],
    }, {
      assertGuard: () => {
        throw new Error('source build mismatch')
      },
    })

    await expect(subject.loaded).rejects.toThrow(/source build mismatch/u)
    expect(subject.assertSourceBuildProfile).toHaveBeenCalledWith('durash')
    expect(subject.runProfile).not.toHaveBeenCalled()
  })
})
