import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { materializeLocalDesktopRuntime } from '../scripts/package-local.ts'
import { createLocalElectronBuilderConfig } from '../scripts/local-electron-builder-config.mjs'
import { inventoryDesktopRuntime } from '../src/runtime-tree.ts'

const require = createRequire(import.meta.url)
const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js') as {
  validateConfiguration: (config: object, logger: { isEnabled: false }) => Promise<void>
}

describe('local DuraSH desktop packaging', () => {
  it('uses a separate local identity and artifact directory with no release hooks or feed', async () => {
    const config = createLocalElectronBuilderConfig('mac-arm64')
    await validateConfiguration(config, { isEnabled: false })
    expect(config.appId).toBe('com.velen.durash')
    expect(config.productName).toBe('DuraSH')
    expect(config.directories?.output).toMatch(/mac-arm64[/\\]durash-artifacts$/u)
    expect(config.mac).toMatchObject({ identity: null, forceCodeSigning: false, hardenedRuntime: false, notarize: false })
    expect(config.publish).toBeNull()
    expect(config.afterSign).toBeUndefined()
    expect(config.artifactBuildCompleted).toBeUndefined()
    expect(() => createLocalElectronBuilderConfig('win-x64' as 'mac-arm64')).toThrow('requires macOS')
  })

  it('materializes deployed links and missing private packages while omitting checkout-only files', () => {
    const root = mkdtempSync(join(tmpdir(), 'durash-local-runtime-'))
    try {
      const staging = join(root, 'deploy')
      const destination = join(root, 'runtime')
      const source = join(root, 'overlay')
      const cordis = join(root, 'cordis')
      const overlayName = '@durash/dsh-web-profile'
      const officeName = '@deepseek-ai/libreoffice-kit'
      const cordisName = '@deepseek-ai/cordis'
      mkdirSync(join(staging, 'node_modules', officeName), { recursive: true })
      mkdirSync(source)
      mkdirSync(join(cordis, 'node_modules'), { recursive: true })
      writeFileSync(join(staging, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0',
        dependencies: { [overlayName]: '1.0.0' } }))
      writeFileSync(join(staging, 'node_modules', officeName, 'package.json'), JSON.stringify({ name: officeName, version: '1.0.0' }))
      writeFileSync(join(source, 'package.json'), JSON.stringify({ name: overlayName, version: '1.0.0',
        files: ['index.js'], dependencies: { [cordisName]: 'workspace:^' } }))
      writeFileSync(join(source, 'index.js'), 'export const product = "DuraSH"\n')
      writeFileSync(join(source, '.env'), 'checkout-only\n')
      writeFileSync(join(cordis, 'package.json'), JSON.stringify({ name: cordisName, version: '1.0.0', files: ['index.js'] }))
      writeFileSync(join(cordis, 'index.js'), 'export const shared = true\n')
      writeFileSync(join(cordis, '.env'), 'must not copy linked package credentials\n')
      mkdirSync(join(cordis, 'src'))
      mkdirSync(join(cordis, 'tests'))
      writeFileSync(join(cordis, 'src', 'checkout-only.ts'), 'must not copy undeclared source\n')
      writeFileSync(join(cordis, 'tests', 'checkout-only.spec.ts'), 'must not copy undeclared tests\n')
      writeFileSync(join(cordis, 'node_modules', 'development-only'), 'must not copy\n')
      symlinkSync(cordis, join(staging, 'node_modules', cordisName), process.platform === 'win32' ? 'junction' : 'dir')
      const shared = materializeLocalDesktopRuntime(staging, destination, new Map([
        [overlayName, source], [cordisName, cordis],
      ]), process)
      expect(shared).toEqual([cordisName, overlayName])
      expect(readFileSync(join(destination, 'node_modules', overlayName, 'index.js'), 'utf8')).toContain('DuraSH')
      const files = inventoryDesktopRuntime(destination).map(file => file.path)
      expect(files).toContain(`node_modules/${cordisName}/index.js`)
      expect(files.some(path => path.includes('.env') || path.includes('checkout-only') || path.includes('development-only'))).toBe(false)
      expect(JSON.parse(readFileSync(join(destination, 'node_modules', overlayName, 'package.json'), 'utf8')).dependencies)
        .toEqual({ [cordisName]: '^1.0.0' })
      rmSync(source, { recursive: true })
      rmSync(cordis, { recursive: true })
      expect(inventoryDesktopRuntime(destination).map(file => file.path)).toEqual(files)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
