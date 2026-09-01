/** Runtime access to the repository-owned client build record for Web acceptance tests. */

const buildEnvironmentModulePath = '../../../scripts/client-build-environment.ts'
const buildEnvironmentModule: unknown = await import(buildEnvironmentModulePath)
if (!isUnknownRecord(buildEnvironmentModule)) {
  throw new TypeError('client build environment module must be an object')
}

const recordReader = requireBuildRecordReader(buildEnvironmentModule['readClientBuildRecord'])

const recordPath = buildEnvironmentModule['CLIENT_BUILD_RECORD_PATH']
if (typeof recordPath !== 'string') {
  throw new TypeError('client build environment module must export CLIENT_BUILD_RECORD_PATH')
}

/** Repository-relative path of the verified client build record. */
export const clientBuildRecordPath = recordPath

/**
 * Read the verified public environment embedded in the current client artifacts.
 * @param root - repository root containing the build record and artifacts.
 * @returns public client build environment from the verified record.
 */
export function readVerifiedClientBuildEnvironment(root: string): Readonly<Record<string, string>> {
  const record: unknown = recordReader(root)
  if (!isUnknownRecord(record) || !isUnknownRecord(record['environment'])) {
    throw new TypeError('client build record environment must be an object')
  }
  const environment = record['environment']
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value !== 'string') {
      throw new TypeError(`client build record environment ${name} must be a string`)
    }
  }
  return environment as Record<string, string>
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireBuildRecordReader(value: unknown): (root: string) => unknown {
  if (typeof value !== 'function') {
    throw new TypeError('client build environment module must export readClientBuildRecord')
  }
  return value as (root: string) => unknown
}
