/** Configuration for the local DuraSH application without a release feed. */
import type { Configuration } from 'app-builder-lib'

/**
 * Select the prepared native macOS runtime for the local DuraSH application.
 * @param target - Native macOS packaging target.
 * @returns Local-only electron-builder configuration.
 */
export function createLocalElectronBuilderConfig(target: 'mac-arm64' | 'mac-x64'): Configuration
