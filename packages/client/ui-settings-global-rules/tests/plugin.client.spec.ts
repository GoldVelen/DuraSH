// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import type { GlobalRulesSectionInjected } from '../src/client/GlobalRulesSection.tsx'
import { GlobalRulesSection } from '../src/client/GlobalRulesSection.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')

describe('global-rules page registration', () => {
  it('registers lazily, forwards only scoped file operations, and disposes its contributions', async () => {
    expect(hostApply).not.toThrow()
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    type Failure = { ok: false; error: { code: string; message: string } }
    const readGlobalRules = vi.fn<() => Promise<{ ok: true; value: null } | Failure>>(async () => ({ ok: true, value: null }))
    const savedDocument = { path: '/host/AGENTS.md', content: 'draft', revision: 'next', exists: true,
      loadingEnabled: true, maxBytes: 1024, maxSourceBytes: 4096 }
    const saveGlobalRules = vi.fn<() => Promise<{ ok: true; value: typeof savedDocument } | Failure>>(
      async () => ({ ok: true, value: savedDocument }),
    )
    ctx.provide('remote', { settings: { readGlobalRules, saveGlobalRules } })
    ctx.provide('remote.settings', { readGlobalRules, saveGlobalRules })
    const slots = ctx.get('slots') as SlotRegistry
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(0)
    const stop = slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(GlobalRulesSection)
    expect(resolveSlotLabel(entry.options.label)).toBe('全局规则')
    expect(readGlobalRules).not.toHaveBeenCalled()
    locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Global rules')
    const operations = (entry.inject as unknown as () => GlobalRulesSectionInjected)()
    await expect(operations.read()).resolves.toBeNull()
    readGlobalRules.mockResolvedValueOnce({ ok: false, error: { code: 'global-rules/rejected', message: 'Read denied' } })
    await expect(operations.read()).rejects.toThrow('Read denied')
    await expect(operations.save('draft', 'revision')).resolves.toEqual({ kind: 'saved', document: savedDocument })
    expect(saveGlobalRules).toHaveBeenCalledWith('draft', 'revision')
    saveGlobalRules.mockResolvedValueOnce({ ok: false, error: { code: 'global-rules/conflict', message: 'File changed' } })
    await expect(operations.save('draft', 'revision')).resolves.toEqual({ kind: 'conflict' })
    saveGlobalRules.mockResolvedValueOnce({ ok: false, error: { code: 'global-rules/rejected', message: 'EACCES' } })
    await expect(operations.save('draft', 'revision')).resolves.toEqual({ kind: 'failed', message: 'EACCES' })
    saveGlobalRules.mockRejectedValueOnce(new Error('Disconnected'))
    await expect(operations.save('draft', 'revision')).resolves.toEqual({ kind: 'failed', message: 'Disconnected' })
    stop()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await fiber.dispose()
    expect(() => locale.register('settings.globalRules', 'zh', {})).not.toThrow()
    await ctx.fiber.dispose()
  })
})
