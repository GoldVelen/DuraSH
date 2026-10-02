import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalogWithChildren, historicalSessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { isSessionFormatJsonObject, type SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'

it('restores recorded acceptance notices with the current writer attribution and unchanged content', () => {
  const path = resolve(import.meta.dirname, '../../../../snapshots/session/durash-acceptance/session.v3.jsonl')
  const original = readFileSync(path)
  const records = original.toString('utf8').trimEnd().split('\n')
    .map(line => JSON.parse(line) as Record<string, SessionFormatJsonValue>)
  const header = { ...records.shift()!, cwd: resolve('snapshot-cwd') }
  const source = historicalSessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const [seq, row] of records.entries()) {
    let record = row
    if (row['type'] === 'request/header' && isSessionFormatJsonObject(row['data']) && isSessionFormatJsonObject(row['data']['header'])) {
      const { tools, ...request } = row['data']['header']
      expect(tools).toBe('{{tools}}')
      record = { ...row, data: { ...row['data'], header: request } }
    }
    source.decodeRow({ ...record, seq, time: 0 })
  }
  const historical = source.finish()
  const notices = historical.events.filter(event => event.type === 'user/message'
    && isSessionFormatJsonObject(event.data) && isSessionFormatJsonObject(event.data['source'])
    && event.data['source']['kind'] === 'plugin' && event.data['source']['plugin'] === 'durash-acceptance')
  expect(notices).toHaveLength(2)
  const catalog = createSessionFormatCatalogWithChildren([])
  const migration = catalog.createRestore({ type: 'session', ...historical.header }, { recovery: 'strict', validation: 'current' })
  for (const event of historical.events) migration.decodeRow(event)
  const migrated = migration.finish()
  const native = catalog.createRestore(catalog.encodeCurrentHeader(migrated.header, migrated.inheritedEventCount),
    { recovery: 'strict', validation: 'current' })
  for (const event of migrated.events) native.decodeRow(catalog.encodeCurrentEvent(event))
  const reopened = native.finish()
  expect(reopened).toEqual(migrated)
  const { id, version, parentSession, ...metadata } = reopened.header
  if (version !== 4) throw new Error('acceptance migration did not produce V4')
  const currentHeader: SessionHeader = { ...metadata, version, id: SessionId(id),
    ...(parentSession === undefined ? {} : { parentSession: SessionId(parentSession) }) }
  const session = Session.fromRestore(currentHeader.id, reopened.events as readonly SessionEvent[],
    currentHeader, SessionLogOffset(reopened.inheritedEventCount), 'detached')
  for (const notice of notices) {
    if (!isSessionFormatJsonObject(notice.data)) throw new Error('acceptance fixture has no message')
    const message = notice.data
    const expected = { ...message, source: { kind: 'durash-acceptance', form: 'notice',
      summary: 'Host acceptance checks and unreviewed test changes' } }
    expect(reopened.events[notice.seq]).toEqual({ ...notice, data: expected })
    expect(session.deriveMessages().find(current => current.id === message['id'])).toEqual(expected)
  }
  expect(readFileSync(path)).toEqual(original)
})
