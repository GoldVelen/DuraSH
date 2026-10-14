/** Package the current DuraSH checkout as a relocatable local macOS application. */

import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { load } from 'js-yaml'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { durashClientBuildEnvironment, readClientBuildRecord } from '../../../scripts/client-build-environment.ts'
import { selectOfficeEngine } from '../../../scripts/libreoffice-engine.ts'
import { desktopNodeEnvironment } from '../src/node-environment.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { parseDesktopRelease } from '../src/release.ts'
import { inventoryDesktopRuntime, verifyDesktopRuntime, writeDesktopRuntime } from '../src/runtime-tree.ts'
import { resolveDesktopBuildTarget, desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { desktopRuntimeFileExclusion } from './runtime-file-policy.ts'
import { smokeDesktopRuntime } from './smoke-runtime.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const LOCAL_RUNTIME_PACKAGE = '@durash/dsh-desktop-local-runtime'

interface LocalPackageManifest {
  readonly name: string
  readonly version: string
  readonly files?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Record<string, string>
}

function manifest(root: string): LocalPackageManifest {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as LocalPackageManifest
}

function workspacePackages(): Map<string, string> {
  const workspace = load(readFileSync(join(REPOSITORY_ROOT, 'pnpm-workspace.yaml'), 'utf8')) as { packages: string[] }
  return new Map(globSync(workspace.packages.map(pattern => `${pattern}/package.json`), { cwd: REPOSITORY_ROOT })
    .map((path) => { const root = resolve(REPOSITORY_ROOT, path, '..'); return [manifest(root).name, root] }))
}

/**
 * Materialize declared workspace package files and replace workspace protocols with installed versions.
 * @param staging - Production deployment root.
 * @param destination - Disposable final runtime directory.
 * @param packages - Workspace package names and source directories supplying reviewed build artifacts.
 * @param target - Current native execution target.
 * @returns Names of application-owned packages exposed to external plugins.
 */
export function materializeLocalDesktopRuntime(
  staging: string, destination: string, packages: ReadonlyMap<string, string>,
  target: { platform: NodeJS.Platform; arch: string },
): string[] {
  const modules = join(staging, 'node_modules')
  const selected = new Set<string>()
  const visit = (name: string): void => {
    if (selected.has(name)) return
    const source = packages.get(name)
    if (source === undefined) return
    selected.add(name)
    const entry = manifest(source)
    for (const dependency of Object.keys({ ...entry.dependencies, ...entry.peerDependencies })) visit(dependency)
  }
  for (const name of Object.keys(manifest(staging).dependencies ?? {})) visit(name)
  const packaged = join(staging, '.durash-workspace-packages')
  for (const name of selected) {
    const source = packages.get(name)!
    const output = join(modules, name)
    const payload = existsSync(output) ? realpathSync(output) : source
    const entry = manifest(payload)
    const files = manifest(source).files
    if (files === undefined) throw new Error(`DuraSH local package: ${name} has no declared runtime files`)
    const omitted = globSync(files.filter(file => file.startsWith('!')).map(file => file.slice(1)), { cwd: payload })
      .map(path => join(payload, path))
    const included = globSync([...files.filter(file => !file.startsWith('!')), 'README*', 'LICENSE*'], { cwd: payload })
    const prepared = join(packaged, name)
    mkdirSync(prepared, { recursive: true })
    for (const file of new Set(included)) {
      const destinationFile = join(prepared, file)
      mkdirSync(resolve(destinationFile, '..'), { recursive: true })
      cpSync(join(payload, file), destinationFile, { recursive: true, dereference: true,
        filter: path => !omitted.some(omittedPath => path === omittedPath || path.startsWith(omittedPath + sep))
          && path !== join(payload, 'node_modules') && !path.startsWith(join(payload, 'node_modules') + sep) })
    }
    const normalized = { ...entry }
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      if (entry[section] === undefined) continue
      normalized[section] = Object.fromEntries(Object.entries(entry[section]).map(([dependency, version]) => {
        if (!version.startsWith('workspace:')) return [dependency, version]
        const dependencyRoot = packages.get(dependency)
        if (dependencyRoot === undefined) throw new Error(`DuraSH local package: unknown workspace dependency ${dependency}`)
        const range = version.slice('workspace:'.length)
        if (range !== '*' && range !== '^') throw new Error(`DuraSH local package: unsupported workspace range ${version}`)
        return [dependency, `${range === '*' ? '' : range}${manifest(dependencyRoot).version}`]
      }))
    }
    writeFileSync(join(prepared, 'package.json'), `${JSON.stringify(normalized, undefined, 2)}\n`)
    if (existsSync(output)) {
      if (lstatSync(output).isSymbolicLink()) unlinkSync(output)
      else rmSync(output, { recursive: true })
    }
    mkdirSync(resolve(output, '..'), { recursive: true })
    renameSync(prepared, output)
  }
  const officeEngine = selectOfficeEngine(manifest(join(modules, '@deepseek-ai/libreoffice-kit')), target)
  const workspaceRoots = new Set([...packages.values()].map(root => realpathSync(root)))
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(modules, join(destination, 'node_modules'), {
    recursive: true, dereference: true,
    filter: (path) => {
      if (desktopRuntimeFileExclusion(relative(modules, path), target, officeEngine) !== undefined) return false
      // Legacy deploy may link a workspace package whose development dependencies must stay outside the payload.
      return !path.endsWith(`${sep}node_modules`) || path === modules
        || !workspaceRoots.has(realpathSync(resolve(path, '..')))
    },
  })
  writeFileSync(join(destination, 'package.json'), `${JSON.stringify({
    ...manifest(staging), private: true, type: 'module',
    dependencies: Object.fromEntries([...selected].sort().map(name => [name, manifest(join(destination, 'node_modules', name)).version])),
  }, undefined, 2)}\n`)
  inventoryDesktopRuntime(destination)
  return [...selected].sort()
}

async function runPnpm(args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const invocation = pnpmInvocation(args, environment)
  await new Promise<void>((accept, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 ? accept()
      : reject(new Error(`DuraSH local package: pnpm exited with ${String(code ?? signal)}`)))
  })
}

/**
 * Prepare and package the native local application; all boot checks use disposable Harness homes.
 * @param args - Optional --skip-build and --prepare-only flags.
 */
export async function packageLocalDesktop(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: {
    'skip-build': { type: 'boolean', default: false }, 'prepare-only': { type: 'boolean', default: false },
  } })
  if (process.platform !== 'darwin') throw new Error('DuraSH local package: requires a native macOS build host')
  const targetName = resolveDesktopBuildTarget({}, process.platform, process.arch)
  const paths = desktopTargetBuildPaths(targetName)
  // This entry never consumes Desktop release credentials, inherited release policies, or a user Harness home.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^DSH_DESKTOP_|^CSC_|^APPLE_|^DSH_HOME$|^NODE_OPTIONS$|^NODE_PATH$/u.test(name)))
  Object.assign(environment, { DSH_DESKTOP_TARGET_PLATFORM: process.platform, DSH_DESKTOP_TARGET_ARCH: process.arch,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false', pnpm_config_verify_deps_before_run: 'false' })
  if (!values['skip-build']) await runPnpm(['run', 'build:durash'], REPOSITORY_ROOT, environment)
  readClientBuildRecord(REPOSITORY_ROOT, durashClientBuildEnvironment(REPOSITORY_ROOT, environment))
  await runPnpm(['run', 'prepare:runtime'], APP_ROOT, environment)
  const staging = mkdtempSync(join(tmpdir(), 'durash-desktop-deploy-'))
  rmSync(staging, { recursive: true })
  try {
    await runPnpm(['--filter', LOCAL_RUNTIME_PACKAGE, 'deploy', '--legacy', '--prod',
      '--config.allow-unused-patches=true', '--config.node-linker=hoisted', '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true', staging], REPOSITORY_ROOT, environment)
    const shared = materializeLocalDesktopRuntime(staging, paths.dsh, workspacePackages(), process)
    const version = manifest(APP_ROOT).version
    if (manifest(REPOSITORY_ROOT).version !== version) throw new Error('DuraSH local package: shell and repository versions differ')
    const versions = JSON.parse(readFileSync(join(paths.runtime, 'versions.json'), 'utf8')) as { node: string; pnpm: string }
    const release = parseDesktopRelease({ schemaVersion: 1, version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: versions.node, pnpmVersion: versions.pnpm })
    const descriptor = writeDesktopRuntime(paths.dsh, release, shared, process)
    await verifyDesktopRuntime(paths.dsh, version)
    const node = join(paths.electron, 'Electron.app/Contents/MacOS/Electron')
    execFileSync(node, ['--expose-internals', join(APP_ROOT, 'tests/fixtures/runtime-payload-smoke.mjs'), paths.dsh], {
      timeout: 120_000, stdio: 'inherit', env: desktopNodeEnvironment(node, join(paths.runtime, 'bin'), environment),
    })
    await smokeDesktopRuntime(paths.dsh, node, descriptor)
    await verifyDesktopRuntime(paths.dsh, version)
    if (!values['prepare-only']) {
      await runPnpm(['exec', 'electron-builder', '--config', 'electron-builder.local.config.mjs', '--mac', '--dir',
        process.arch === 'arm64' ? '--arm64' : '--x64', '--publish', 'never'], APP_ROOT, environment)
      const application = join(paths.root, 'durash-artifacts', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'DuraSH.app')
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', application], { stdio: 'inherit', env: environment })
      execFileSync('codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit', env: environment })
    }
  } finally { rmSync(staging, { recursive: true, force: true }) }
}

if (import.meta.main) await packageLocalDesktop(process.argv.slice(2))
