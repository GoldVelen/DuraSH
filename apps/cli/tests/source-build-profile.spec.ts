import { describe, expect, it } from 'vitest'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { profileTemplatesForSourceRoot } from '../src/source-build-profile.ts'

describe('source-owned profile templates', () => {
  it('adds DuraSH only when the CLI runs from the source checkout', () => {
    expect(profileTemplatesForSourceRoot(undefined)).toBe(PROFILE_TEMPLATES)
    expect(PROFILE_TEMPLATES.durash).toBeUndefined()
    expect(profileTemplatesForSourceRoot('/source').durash).toEqual({
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@durash/dsh-web-profile'],
      patchReload: 'live',
    })
  })
})
