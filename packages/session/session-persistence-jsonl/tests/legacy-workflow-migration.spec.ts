import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generationLogPath } from '../src/format.ts'
import { compressZstdFrame } from '../src/zstd.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  } finally {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  }
})

const legacyTypes = ['runs/dispatched', 'workflow/start', 'workflow/change'] as const
const payload = { runId: 'retired', seq: 700, messageSeqs: [900], nested: { sourceEventSeqs: [999], state: 'finished' } }
const user = (id: string, text: string) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
interface Row {
  readonly type: string
  readonly data: SessionFormatJsonValue
  readonly sourceEventSeqs?: readonly number[]
  readonly surfaceOp?: SessionFormatJsonValue
}

async function identity(path: string) {
  const info = await stat(path, { bigint: true })
  return { bytes: await readFile(path), dev: info.dev, ino: info.ino, mtime: info.mtimeNs, ctime: info.ctimeNs }
}

describe.each(['none', 'zstd'] as const)('retired workflow mirrors through JSONL (%s)', (compression) => {
  async function fixture(version: 0 | 1 | 2 | 3, seeded: boolean, extra: readonly Row[] = []) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-legacy-workflow-'))
    roots.push(root)
    const id = SessionId('legacy-workflow')
    const path = generationLogPath(root, undefined, id, version, compression)
    const rows = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'step/start', data: { turn: 1, step: 1 } },
      { type: legacyTypes[0], data: payload },
      { type: 'user/message', data: user('question', 'question'), surfaceOp: 'append' },
      { type: legacyTypes[1], data: payload },
      { type: legacyTypes[2], data: payload },
      { type: 'user/message', data: user('summary', 'summary'), sourceEventSeqs: [3],
        surfaceOp: version === 3 ? { op: 'replace', startSeq: 3, endSeq: 3 } : { op: 'replace', start: 3, end: 3 } },
      { type: 'session/title', data: { title: 'question', source: { kind: 'fallback' }, messageSeqs: [3] } },
      { type: 'step/end', data: { turn: 1, step: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ...(seeded && version >= 2 ? [{ type: 'session/end-seed', data: { inherited: true } }] : []),
      { type: legacyTypes[2], data: { ...payload, own: true } },
      ...extra,
    ].map((event, seq) => ({ ...event, seq, time: seq + 10 }))
    const header = { type: 'session', version, id, createdAt: 1, delegationDepth: 0,
      ...(version < 2 ? seeded ? { seedLength: 10, parentSession: 'parent' } : {}
        : { isSeeded: seeded, ...(seeded ? { parentSession: 'parent' } : {}) }) }
    const first = JSON.stringify(header) + '\n'
    const body = rows.map(row => JSON.stringify(row) + '\n').join('')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, compression === 'none' ? first + body
      : Buffer.concat([await compressZstdFrame(first), await compressZstdFrame(body)]))
    async function mount() {
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root, compression })
      return ctx
    }
    return { id, path, root, rows, mount }
  }

  describe.each([0, 1, 2, 3] as const)('V%s source', (version) => {
    it.each([false, true])('preserves mirrors, messages, references and inherited cut (seeded=%s)', async (seeded) => {
      const f = await fixture(version, seeded)
      const original = await identity(f.path)
      const files = await readdir(dirname(f.path))
      const ctx = await f.mount()
      const reader = await ctx.sessionPersistence.open(f.id, 'read')
      let prepared: readonly SessionEvent[]
      try {
        expect(reader.header.version).toBe(4)
        const read = await reader.read()
        prepared = read.events
        expect(prepared.map(event => event.seq)).toEqual(prepared.map((_, seq) => seq))
        const mirrors = prepared.filter(event => event.type.startsWith('plugin:'))
        expect(mirrors.map(event => [event.type, event.time, event.data, event.ignorable])).toEqual(
          f.rows.filter(event => legacyTypes.includes(event.type as typeof legacyTypes[number]))
            .map(event => [`plugin:${event.type}`, event.time, event.data, true]),
        )
        const originalUser = prepared.find(event => event.type === 'user/message' && event.data.id === 'question')!
        const replacement = prepared.find(event => event.type === 'user/message' && event.data.id === 'summary')!
        expect(replacement).toMatchObject({ sourceEventSeqs: [originalUser.seq],
          surfaceOp: { op: 'replace', startSeq: originalUser.seq, endSeq: originalUser.seq } })
        expect(prepared.find(event => event.type === 'session/title')).toMatchObject({ data: { messageSeqs: [originalUser.seq] } })
        const session = Session.fromRestore(f.id, prepared, reader.header, reader.inheritedEventCount, read.eventState)
        expect(session.deriveMessages()).toEqual([user('summary', 'summary')])
        if (seeded) {
          const marker = prepared.find(event => event.type === 'session/end-seed')!
          expect(reader.inheritedEventCount).toBe(marker.seq)
          expect(session.ownEvents().slice(0, 2)).toEqual([marker, prepared.at(-1)])
          expect(session.ownEvents().at(-1)).toMatchObject({ type: 'session/end-seed', seq: prepared.length, data: {} })
        } else expect(reader.inheritedEventCount).toBe(0)
      } finally {
        await reader.close()
      }
      expect(await identity(f.path)).toEqual(original)
      expect(await readdir(dirname(f.path))).toEqual(files)
      const writer = await ctx.sessionPersistence.open(f.id, 'write')
      try { expect((await writer.read()).events).toEqual(prepared) } finally { await writer.close() }
      expect(await identity(f.path)).toEqual(original)
      expect((await readdir(dirname(f.path))).filter(name => name !== 'session.lock').sort())
        .toEqual([basename(f.path), compression === 'none' ? 'session.v4.jsonl' : 'session.v4.jsonl.zstd'].sort())
      const independent = await f.mount()
      const reopened = await independent.sessionPersistence.open(f.id, 'read')
      try { expect((await reopened.read()).events).toEqual(prepared) } finally { await reopened.close() }
      expect(await identity(f.path)).toEqual(original)
    })

    it('refuses a later unknown required event without publishing a partial successor', async () => {
      const f = await fixture(version, false, [{ type: 'workflow/future-required', data: payload }])
      const original = await identity(f.path)
      const ctx = await f.mount()
      for (const access of ['read', 'write'] as const) {
        await expect(ctx.sessionPersistence.open(f.id, access)).rejects.toThrow(/unknown|unclassified/)
      }
      expect(await identity(f.path)).toEqual(original)
      expect((await readdir(dirname(f.path))).filter(name => name !== 'session.lock')).toEqual([basename(f.path)])
    })
  })

  it.each([0, 1, 2] as const)('refuses surface metadata on log-only V%s mirrors without publishing', async (version) => {
    const f = await fixture(version, false, [{ type: legacyTypes[0], data: payload, sourceEventSeqs: [3], surfaceOp: 'append' }])
    const original = await identity(f.path)
    const ctx = await f.mount()
    for (const access of ['read', 'write'] as const) {
      await expect(ctx.sessionPersistence.open(f.id, access)).rejects.toThrow(/unexpected field/)
    }
    expect(await identity(f.path)).toEqual(original)
    expect((await readdir(dirname(f.path))).filter(name => name !== 'session.lock')).toEqual([basename(f.path)])
  })

  it('keeps V3 opaque envelope metadata uninterpreted in the V4 successor', async () => {
    const metadata = { sourceEventSeqs: [3], surfaceOp: { uninterpreted: 888 } }
    const f = await fixture(3, false, [{ type: legacyTypes[0], data: payload, ...metadata }])
    const original = await identity(f.path)
    const ctx = await f.mount()
    const writer = await ctx.sessionPersistence.open(f.id, 'write')
    try {
      expect((await writer.read()).events.at(-1)).toMatchObject({ type: `plugin:${legacyTypes[0]}`, data: payload, ignorable: true, ...metadata })
    } finally { await writer.close() }
    expect(await identity(f.path)).toEqual(original)
  })
})
