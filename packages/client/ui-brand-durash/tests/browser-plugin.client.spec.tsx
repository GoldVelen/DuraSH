// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { DuraSHBrandMark, DuraSHBrandName } from '../src/client/Brand.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, locale, declareHoles, disposeHoles }
}

describe('DuraSH browser-brand plugin', () => {
  it('declares only the slot and locale services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it.each(['official', 'local', ''])('leaves every slot empty for the %j build profile', async (profile) => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', profile)
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
    expect(subject.locale.bind('durashBrand')('name')).toBe('name')
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'durash')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)
    expect(before.locale.bind('durashBrand')('name')).toBe('DuraSH')

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    expect(before.locale.bind('durashBrand')('name')).toBe('name')

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('keeps the name as accessible text and the vector mark font-free at 16 px', () => {
    const name = render(<DuraSHBrandName t={() => 'DuraSH'} />)
    expect(name.getByText('DuraSH').tagName).toBe('SPAN')
    name.unmount()

    const mark = render(<DuraSHBrandMark size={16} className="brand-mark" />)
    const svg = mark.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('16')
    expect(svg?.getAttribute('height')).toBe('16')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 64 64')
    expect(svg?.getAttribute('class')).toBe('brand-mark')
    expect(svg?.querySelector('text')).toBeNull()
    expect([...mark.container.querySelectorAll('[fill]')].map(node => node.getAttribute('fill')))
      .toEqual(['none', '#0F172A', '#E2E8F0', '#F59E0B'])
  })
})
