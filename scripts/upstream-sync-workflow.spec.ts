import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const pairingDriver = 'scripts/merge-translation-pairing-driver.sh %O %A %B %P'

describe('upstream synchronization workflow', () => {
  it('uses the translation-pairing driver and reports rejected merges as failures', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/upstream-sync.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs) || !isRecord(workflow.jobs.synchronize)) {
      throw new TypeError('upstream-sync.yml must define the synchronize job')
    }
    const steps = workflow.jobs.synchronize.steps
    if (!Array.isArray(steps)) throw new TypeError('the synchronize job must define steps')

    const prepare = namedRunStep(steps, 'Prepare the synchronization branch')
    const mergeLine = prepare.run.split('\n').map(line => line.trim()).find(line => (
      line.includes(' merge --no-ff --no-commit "$upstream_sha"')
    ))
    expect(mergeLine).toBe(
      `git -c 'merge.dsh-translation-pairing.driver=${pairingDriver}' merge --no-ff --no-commit "$upstream_sha"`,
    )
    expect(mergeLine).not.toContain('|| true')
    expect(prepare.run).toContain('merge_status=$?')
    expect(prepare.run).toContain('if [ "$merge_status" -ne 0 ]; then')
    expect(prepare.run).toContain('git diff --name-only --diff-filter=U')
    expect(prepare.run).toContain('git merge --abort')
    expect(prepare.run).toContain('echo "conflict=true" >> "$GITHUB_OUTPUT"')

    const report = namedRunStep(steps, 'Report a merge conflict')
    expect(report.if).toBe("steps.prepare.outputs.conflict == 'true'")
    expect(report.run.split('\n').map(line => line.trim())).toContain('exit 1')
  })
})

function namedRunStep(steps: unknown[], name: string): { if?: unknown; run: string } {
  const step = steps.find(candidate => isRecord(candidate) && candidate.name === name)
  if (!isRecord(step) || typeof step.run !== 'string') {
    throw new TypeError(`upstream-sync.yml must define the ${name} run step`)
  }
  return step as { if?: unknown; run: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
