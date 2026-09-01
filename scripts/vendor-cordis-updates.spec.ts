import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, FiberState, Service, type Fiber } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('reviewed Cordis vendor updates', () => {
  it('dispatches symbol and prototype-named events without retaining empty buckets', async () => {
    const ctx = new Context()
    const symbolEvent = Symbol('reviewed-vendor-event')
    const values: number[] = []
    const disposeSymbol = ctx.on(symbolEvent, (value: number) => {
      values.push(value)
      return value
    })

    ctx.emit(symbolEvent, 1)
    expect(ctx.bail(symbolEvent, 2)).toBe(2)
    expect(await ctx.serial(symbolEvent, 3)).toBe(3)
    await ctx.parallel(symbolEvent, 4)
    expect(values).toEqual([1, 2, 3, 4])
    disposeSymbol()
    expect(Reflect.has(ctx.events._hooks, symbolEvent)).toBe(false)

    const privateEvents = ctx as unknown as {
      on(name: string, listener: () => void): () => boolean
      emit(name: string): void
    }
    expect(() => { privateEvents.emit('toString') }).not.toThrow()
    for (const name of ['__proto__', 'toString', 'constructor']) {
      const listener = vi.fn()
      const dispose = privateEvents.on(name, listener)
      privateEvents.emit(name)
      expect(listener).toHaveBeenCalledOnce()
      dispose()
      privateEvents.emit(name)
      expect(listener).toHaveBeenCalledOnce()
      expect(Reflect.has(ctx.events._hooks, name)).toBe(false)
    }
  })

  it('keeps a failed fiber stopped until an explicit update recovers it', async () => {
    const ctx = new Context()
    ;(ctx.logger as unknown as { error: (reason: unknown) => void }).error = vi.fn()
    let shouldFail = true
    let applyCalls = 0
    const apply = () => {
      applyCalls += 1
      if (shouldFail) throw new Error('expected startup failure')
    }
    const disposeProvider = ctx.provide('vendor-review-dependency', {})
    const fiber = ctx.inject(['vendor-review-dependency'], apply)
    const startupError = fiber.then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(await startupError).toHaveProperty('message', 'expected startup failure')
    expect(fiber.state).toBe(FiberState.FAILED)
    disposeProvider()
    ctx.provide('vendor-review-dependency', {})
    await tick()
    expect(applyCalls).toBe(1)
    expect(fiber.state).toBe(FiberState.FAILED)

    shouldFail = false
    void fiber.update(undefined)
    await fiber.ctx.fiber.await()
    expect(applyCalls).toBe(2)
    expect(fiber.state).toBe(FiberState.ACTIVE)
  })

  it('retries config resolution when an injected provider changes', async () => {
    const ctx = new Context()
    ;(ctx.logger as unknown as { error: (reason: unknown) => void }).error = vi.fn()
    const rawConfig = { value: 'unresolved' }
    const values: string[] = []
    ctx.on('internal/config', function (this: Fiber, config, next) {
      const resolved: unknown = next()
      if (config !== rawConfig) return resolved
      const provider = this.ctx.get('vendor-review-config') as { fail?: boolean; value?: string }
      if (provider.fail) throw new Error('expected config failure')
      return { value: provider.value }
    }, { global: true })

    const disposeProvider = ctx.provide('vendor-review-config', { fail: true })
    const fiber = ctx.plugin({
      name: 'vendor-review-config-reader',
      inject: ['vendor-review-config'],
      apply(_pluginCtx: Context, config: { value: string }) {
        values.push(config.value)
      },
    }, rawConfig)
    const startupError = fiber.then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(await startupError).toHaveProperty('message', 'expected config failure')
    expect(fiber.state).toBe(FiberState.FAILED)
    disposeProvider()
    ctx.provide('vendor-review-config', { value: 'recovered' })
    await fiber.ctx.fiber.await()

    expect(values).toEqual(['recovered'])
    expect(fiber.state).toBe(FiberState.ACTIVE)
  })

  it('updates and restarts the canonical fiber behind a wrapped handle', async () => {
    const ctx = new Context()
    const applied: string[] = []
    const fiber = ctx.plugin((_pluginCtx, config: { value: string }) => {
      applied.push(config.value)
    }, { value: 'first' })

    await fiber.await()
    await Promise.resolve(fiber.update({ value: 'second' }))
    await fiber.await()
    await fiber.restart()

    expect(applied).toEqual(['first', 'second', 'second'])
    expect(fiber.state).toBe(FiberState.ACTIVE)
    expect(Object.hasOwn(fiber, 'state')).toBe(false)
    expect(Object.hasOwn(fiber, 'inertia')).toBe(false)
  })

  it('keeps logger severity, exporter ownership, and service caller identity', async () => {
    const ctx = new Context()
    ctx.logger.exporters.clear()
    const first: string[] = []
    const second: string[] = []
    const disposeFirst = ctx.logger.exporter({ export: message => first.push(String(message.args[0])) })
    const disposeSecond = ctx.logger.exporter({ export: message => second.push(String(message.args[0])) })

    await disposeFirst()
    ctx.logger.warn('warning')
    ctx.logger.info('information')
    ctx.logger.debug('hidden')
    expect(first).toEqual([])
    expect(second).toEqual(['warning', 'information'])
    await disposeSecond()

    const names: string[] = []
    ctx.logger.exporter({ levels: { default: 3 }, export: message => names.push(message.name) })
    class CallerService extends Service {
      static override name = 'vendor:caller'

      constructor(serviceCtx: Context) {
        super(serviceCtx, 'vendorCaller')
      }

      action(): void {
        this.ctx.logger.debug('from service')
      }
    }
    await ctx.plugin(CallerService)
    const caller = ctx.get('vendorCaller') as CallerService
    caller.action()
    expect(names).toContain('vendor:caller')
  })

  it('settles concurrent interval reads in order and closes all pending reads', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const timerFiber = await ctx.plugin(Timer)
    const iterator = ctx.interval<number>(1000)
    const first = iterator.next()
    const second = iterator.next()
    const firstSettled = vi.fn()
    const secondSettled = vi.fn()
    void first.then(firstSettled)
    void second.then(secondSettled)

    await vi.advanceTimersByTimeAsync(1000)
    expect(firstSettled).toHaveBeenCalledOnce()
    expect(secondSettled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(secondSettled).toHaveBeenCalledOnce()
    expect(await Promise.all([first, second])).toEqual([
      { done: false, value: undefined },
      { done: false, value: undefined },
    ])

    const pending = [iterator.next(), iterator.next()]
    await expect(iterator.return?.(42)).resolves.toEqual({ done: true, value: 42 })
    await expect(Promise.all(pending)).resolves.toEqual([
      { done: true, value: 42 },
      { done: true, value: 42 },
    ])
    await timerFiber.dispose()
  })
})
