// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

const DIST_ROOT = resolve(import.meta.dirname, '../dist')

installAssembledBootEnv()

it('boots the DuraSH bundle stack and renders only the product identity', async () => {
  mountAssembledApp('?fixture', { profile: 'durash' })

  await waitFor(() => {
    expect(document.title).toBe('DuraSH')
    expect(document.body.textContent).toContain('DuraSH')
  })

  const marks = [...document.querySelectorAll<SVGElement>('svg[viewBox="0 0 64 64"]')]
  expect(marks.length).toBeGreaterThanOrEqual(1)
  expect(document.querySelector('svg[viewBox="0 0 23.16 17.04"]')).toBeNull()
  expect(document.querySelector('svg[viewBox="26 0 156 24"]')).toBeNull()
})

it('ships DuraSH install metadata without changing the upstream public sources', async () => {
  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toMatchObject({ name: 'DuraSH', short_name: 'DuraSH' })

  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  expect(favicon).toContain('viewBox="0 0 64 64"')
  expect(favicon).toContain('fill="#F59E0B"')
})
