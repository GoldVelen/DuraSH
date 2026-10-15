import https from 'node:https'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { createLanCertificate, ensureLanCertificate } from '../src/lan-cert.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('LAN certificate', () => {
  it('serves HTTPS and reuses a certificate that still covers the names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-lan-cert-'))
    roots.push(directory)
    const first = ensureLanCertificate(directory, ['localhost', '127.0.0.1'])
    const second = ensureLanCertificate(directory, ['localhost', '127.0.0.1'])
    expect(second.cert).toBe(first.cert)
    const replaced = ensureLanCertificate(directory, ['localhost', '127.0.0.1', '10.0.0.8'])
    expect(replaced.cert).not.toBe(first.cert)

    const material = createLanCertificate(['localhost', '127.0.0.1'])
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none', tls: material })
    expect(ctx.webServer.secure).toBe(true)
    const status = await new Promise<number>((resolve, reject) => {
      const request = https.get({ hostname: '127.0.0.1', port: ctx.webServer.port, rejectUnauthorized: false }, (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      request.on('error', reject)
    })
    expect(status).toBe(404)
  })
})
