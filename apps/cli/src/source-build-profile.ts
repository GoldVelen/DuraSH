/**
 * Source-checkout client-identity checks for browser runtime profiles.
 * @module @deepseek-ai/dsh/source-build-profile
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DURASH_PROFILE = 'durash'
const UPSTREAM_WEB_PROFILE = 'web'
const DURASH_BUILD_RECORD = '.dsh-build/client-build-environment.json'
const DURASH_BUILD_COMMAND = 'pnpm run build'
const LOCAL_BUILD_COMMAND = 'pnpm run build:local'

interface BuildRecordShape {
  readonly environment?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function repositoryRoot(): string | undefined {
  const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
  const manifestPath = resolve(root, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  try {
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return isRecord(manifest) && manifest.name === '@deepseek-ai/dsh-root' ? root : undefined
  } catch {
    // An unreadable ancestor manifest cannot identify a supported source checkout.
    return undefined
  }
}

function readBuildRecord(root: string): BuildRecordShape | undefined {
  const recordPath = resolve(root, DURASH_BUILD_RECORD)
  if (!existsSync(recordPath)) return undefined
  let record: unknown
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `dsh: ${DURASH_BUILD_RECORD} is invalid (${detail}). Rebuild the selected client profile and start again.`,
    )
  }
  if (!isRecord(record) || (record.environment !== undefined && !isRecord(record.environment))) {
    throw new Error(
      `dsh: ${DURASH_BUILD_RECORD} is invalid. Rebuild the selected client profile and start again.`,
    )
  }
  if (record.environment === undefined) return {}
  return { environment: record.environment }
}

/**
 * Reject a source-tree Web launch when its runtime profile conflicts with the
 * recorded client identity. Installed CLIs have no repository build record.
 * @param profile - runtime profile selected by the CLI invocation.
 * @returns Nothing; successful validation permits profile boot to continue.
 * @throws When a source checkout records a conflicting or invalid client identity.
 */
export function assertSourceBuildProfile(profile: string): void {
  if (profile !== DURASH_PROFILE && profile !== UPSTREAM_WEB_PROFILE) return
  const root = repositoryRoot()
  if (root === undefined) return
  const record = readBuildRecord(root)
  const buildProfile = record?.environment?.DSH_CLIENT_BUILD_PROFILE
  if (buildProfile !== undefined && typeof buildProfile !== 'string') {
    throw new Error(`dsh: ${DURASH_BUILD_RECORD} has a non-string DSH_CLIENT_BUILD_PROFILE.`)
  }
  if (profile === DURASH_PROFILE && buildProfile !== DURASH_PROFILE) {
    const actual = buildProfile ?? 'missing'
    throw new Error(
      `dsh: the ${DURASH_PROFILE} profile refuses client build ${JSON.stringify(actual)}. Run \`${DURASH_BUILD_COMMAND}\` from the repository root and start again.`,
    )
  }
  if (profile === UPSTREAM_WEB_PROFILE && buildProfile === DURASH_PROFILE) {
    throw new Error(
      `dsh: the ${UPSTREAM_WEB_PROFILE} profile refuses DuraSH client artifacts. Run \`${LOCAL_BUILD_COMMAND}\` from the repository root and start again.`,
    )
  }
}
