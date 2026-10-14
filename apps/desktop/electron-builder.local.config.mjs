/** Local application packaging needs no release credentials or update service. */
import { createLocalElectronBuilderConfig } from './scripts/local-electron-builder-config.mjs'
import { resolveDesktopBuildTarget } from './scripts/desktop-build-paths.mjs'

const target = resolveDesktopBuildTarget()
if (target === 'win-x64') throw new Error('DuraSH local package: requires macOS')
export default createLocalElectronBuilderConfig(target)
