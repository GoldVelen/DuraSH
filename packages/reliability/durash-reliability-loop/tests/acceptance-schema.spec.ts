import { describe, expect, it } from 'vitest'
import { acceptanceRequirement } from '../src/acceptance-schema.ts'
import type { AcceptanceRequirement } from '../src/acceptance-schema.ts'

const command: AcceptanceRequirement = {
  id: 'build', origin: 'plan', description: 'Build the declared source', command: 'make build',
  scope: ['src'], required: true, kind: 'command', level: 'process', attachments: [], produces: [], allowSkipIf: [],
}

describe('acceptance requirement evidence levels', () => {
  it.each([
    { requirement: { ...command, origin: 'user' }, message: 'User requirements need a verbatim human quote' },
    { requirement: { ...command, kind: 'pytest-junit' }, message: 'Test checks require a result path' },
    { requirement: { ...command, level: 'test' }, message: 'Exit codes and logs do not establish test or UI evidence' },
    { requirement: { ...command, kind: 'xcresult', reportPath: 'results/{run}.xcresult', level: 'ui' }, message: 'UI evidence requires observable-result attachments and semantic review' },
  ])('refuses declarations that lack $message', ({ requirement, message }) => {
    const result = acceptanceRequirement.safeParse(requirement)
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Invalid evidence declaration was accepted')
    expect(result.error.issues.map(issue => issue.message)).toContain(message)
  })

  it('accepts quoted UI requirements with a report and observable-result attachment', () => {
    const requirement = { ...command, origin: 'user', userQuote: 'The Widget displays the item',
      kind: 'xcresult', reportPath: 'results/{run}.xcresult', level: 'ui', attachments: ['results/{run}.png'] }
    expect(acceptanceRequirement.parse(requirement)).toEqual(requirement)
  })
})
