/** Build a local macOS application without release credentials or an update feed. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

/**
 * Select the prepared native macOS runtime for the local DuraSH application.
 * @param {'mac-arm64' | 'mac-x64'} target - Native macOS packaging target.
 * @returns {import('app-builder-lib').Configuration} Local-only electron-builder configuration.
 */
export function createLocalElectronBuilderConfig(target) {
  if (target !== 'mac-arm64' && target !== 'mac-x64') throw new Error('DuraSH local package: requires macOS arm64 or x64')
  const paths = desktopTargetBuildPaths(target)
  return {
    appId: 'com.velen.durash',
    productName: 'DuraSH',
    extraMetadata: { dshDesktopAppId: 'com.velen.durash' },
    directories: { output: join(paths.root, 'durash-artifacts') },
    asar: true,
    electronDist: paths.electron,
    electronFuses: { runAsNode: true },
    files: [
      'lib/main.js',
      'lib/preload-app.cjs',
      'lib/preload-mandatory.cjs',
      'lib/preload-update-dialog.cjs',
      'renderer/**/*',
      'package.json',
      { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
      { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
    ],
    asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep/bin/rg'],
    extraResources: [
      { from: paths.runtime, to: 'runtime' },
      { from: fileURLToPath(new URL('../resources/durash.png', import.meta.url)), to: 'icon.png' },
    ],
    mac: {
      icon: fileURLToPath(new URL('../resources/durash.icns', import.meta.url)),
      category: 'public.app-category.developer-tools',
      identity: null,
      forceCodeSigning: false,
      hardenedRuntime: false,
      notarize: false,
      target: ['dir'],
    },
    publish: null,
  }
}
