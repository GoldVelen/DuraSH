/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkWorkspaceManifest,
  expectedDshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('DuraSH source-only package constraints', () => {
  const sourcePackages = ([
    ['packages/bundle/durash-web-profile', '@durash/dsh-web-profile'],
    ['packages/client/ui-brand-durash', '@durash/dsh-client-ui-brand'],
    ['packages/client/ui-reliability', '@durash/dsh-client-ui-reliability'],
    ['packages/reliability/durash-reliability-loop', '@durash/dsh-reliability-loop'],
    ['packages/reliability/durash-reliability-policy', '@durash/dsh-reliability-policy'],
    ['packages/reliability/durash-tool-reliability', '@durash/dsh-tool-reliability'],
  ] as const).map(([dir, name]): WorkspaceManifest => ({
    dir,
    manifest: {
      name,
      private: true,
      repository: {
        type: 'git',
        url: 'git+https://github.com/GoldVelen/DuraSH.git',
        directory: dir,
      },
    },
  }))

  it('recognizes the complete private DuraSH package set', () => {
    const classificationErrors = sourcePackages
      .flatMap(checkWorkspaceManifest)
      .filter(error => error.includes('source-only DuraSH') || error.includes('release member'))
    expect(classificationErrors).toEqual([])
  })

  it('does not extend source-only treatment to an unlisted DuraSH package', () => {
    const errors = checkWorkspaceManifest({
      dir: 'packages/reliability/durash-other',
      manifest: {
        name: '@durash/dsh-other',
        private: true,
        repository: {
          type: 'git',
          url: 'git+https://github.com/GoldVelen/DuraSH.git',
          directory: 'packages/reliability/durash-other',
        },
      },
    }).filter(error => error.includes('source-only DuraSH') || error.includes('release member'))

    expect(errors).toEqual([
      'packages/reliability/durash-other/package.json: @durash/dsh-other: release member must not set "private": true',
      'packages/reliability/durash-other/package.json: @durash/dsh-other: release member must set publishConfig.access to "public"',
    ])
  })

  it('requires the npm publication guard', () => {
    const sourcePackage = sourcePackages[0]!
    expect(checkWorkspaceManifest({
      ...sourcePackage,
      manifest: { ...sourcePackage.manifest, private: false, publishConfig: { access: 'public' } },
    }).filter(error => error.includes('source-only DuraSH'))).toEqual([
      'packages/bundle/durash-web-profile/package.json: @durash/dsh-web-profile: source-only DuraSH package must set "private": true',
      'packages/bundle/durash-web-profile/package.json: @durash/dsh-web-profile: source-only DuraSH package must not set publishConfig',
    ])
  })
})

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('package payload constraints', () => {
  it('includes a declared profile patch without a package-name allowlist', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-profile',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).toEqual([
      'lib/index.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })
})
