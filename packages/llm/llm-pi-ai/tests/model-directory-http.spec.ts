/** HTTP directory bounds, cleanup, diagnostics, and instance-owned public validators. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModelDirectoryReader, readModelDirectory } from '../src/model-directory-http.ts'

const URL = 'https://opencode.ai/console/api/v2/config'
const METADATA_URL = 'https://models.dev/api.json'
const MIB = 1024 * 1024

afterEach(() => { vi.unstubAllGlobals() })

/** Read one supplied external response without creating a network connection. */
function respond(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** A JSON representation with its server validator. */
function metadata(version: number, etag?: string, control?: string): Response {
  return Response.json({ version }, { headers: {
    ...etag === undefined ? {} : { etag },
    ...control === undefined ? {} : { 'cache-control': control },
  } })
}

describe('bounded model directory HTTP', () => {
  it('keeps the HTTP refusal diagnostic when cancellation of its unread body rejects', async () => {
    const cancel = vi.fn(() => { throw new Error('fixture-cleanup-secret') })
    const response = new Response(new ReadableStream({ cancel }), { status: 403 })
    respond(response)
    await expect(readModelDirectory(URL, new Headers())).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED', message: `${URL} answered 403; check the API key or account sign-in`,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps the byte-limit failure when abandoning an oversized stream rejects cancellation', async () => {
    const cancel = vi.fn(() => { throw new Error('fixture-cleanup-secret') })
    respond(new Response(new ReadableStream({
      start: (controller) => { controller.enqueue(new Uint8Array(8 * MIB + 1)) }, cancel,
    })))
    await expect(readModelDirectory(METADATA_URL, new Headers())).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED', message: `${METADATA_URL} answered with more than ${8 * MIB} bytes`,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('reports an empty successful 204 response as missing JSON', async () => {
    respond(new Response(null, { status: 204 }))
    await expect(readModelDirectory(URL, new Headers())).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED', message: `${URL} did not answer with JSON`,
    })
  })

  it('checks an oversized declared length even when a successful response has no body', async () => {
    respond(new Response(null, { status: 204, headers: { 'content-length': String(4 * MIB + 1) } }))
    await expect(readModelDirectory(URL, new Headers())).rejects.toThrow(`more than ${4 * MIB} bytes`)
  })

  it('admits the complete public metadata under 8 MiB while keeping other authorities at 4 MiB', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(5 * MIB) })
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body))
    vi.stubGlobal('fetch', fetch)
    expect(await readModelDirectory(METADATA_URL, new Headers())).toEqual({ pad: 'x'.repeat(5 * MIB) })
    await expect(readModelDirectory(URL, new Headers())).rejects.toThrow(`more than ${4 * MIB} bytes`)
    await expect(readModelDirectory('https://models.dev.other.test/api.json', new Headers())).rejects.toThrow(`more than ${4 * MIB} bytes`)
    expect(fetch.mock.calls.every(call => call[1]?.redirect === 'error')).toBe(true)
  })
})

describe('public metadata conditional reads', () => {
  it('revalidates every read and updates its validator only after a valid changed representation', async () => {
    const replies = [metadata(1, '"one"', 'must-revalidate'), new Response(null, { status: 304 }),
      metadata(2, 'W/"two"', 'must-revalidate'), new Response(null, { status: 304 })]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const response = replies.shift()
      if (response === undefined) throw new Error('unexpected metadata read')
      return response
    })
    vi.stubGlobal('fetch', fetch)
    const read = createModelDirectoryReader()
    const first = await read(METADATA_URL, new Headers())
    expect(await read(METADATA_URL, new Headers(), new AbortController().signal)).toBe(first)
    const changed = await read(METADATA_URL, new Headers())
    expect(changed).toEqual({ version: 2 })
    expect(await read(METADATA_URL, new Headers())).toBe(changed)
    expect(fetch.mock.calls.map(call => new Headers(call[1]?.headers).get('if-none-match'))).toEqual([null, '"one"', '"one"', 'W/"two"'])
    expect(fetch.mock.calls.every(call => call[1]?.redirect === 'error' && call[1]?.method === 'GET')).toBe(true)
  })

  it('does not replace validated metadata or quote response tokens after a JSON parsing failure', async () => {
    const replies = [metadata(1, '"one"'), new Response('{"token":"fixture-secret"', { headers: { etag: '"invalid"' } }),
      new Response(null, { status: 304 })]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => replies.shift()!)
    vi.stubGlobal('fetch', fetch)
    const read = createModelDirectoryReader()
    const original = await read(METADATA_URL, new Headers())
    const failure: unknown = await read(METADATA_URL, new Headers()).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'DISCOVERY_FAILED', message: `${METADATA_URL} did not answer with JSON` })
    expect(failure).not.toHaveProperty('cause')
    expect(await read(METADATA_URL, new Headers())).toBe(original)
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get('if-none-match')).toBe('"one"')
  })

  it('refuses a 304 before this instance has stored a validated representation', async () => {
    respond(new Response(null, { status: 304 }))
    await expect(createModelDirectoryReader()(METADATA_URL, new Headers())).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED', message: `${METADATA_URL} answered 304`,
    })
  })

  it('does not reuse a cached representation after the caller cancels a conditional request', async () => {
    const caller = new AbortController()
    let requests = 0
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async () => {
      requests += 1
      if (requests === 1) return metadata(1, '"one"')
      caller.abort('fixture cancellation')
      return new Response(null, { status: 304 })
    }))
    const read = createModelDirectoryReader()
    await read(METADATA_URL, new Headers())
    await expect(read(METADATA_URL, new Headers(), caller.signal)).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it.each([{}, { etag: '"one"', 'cache-control': 'no-store, must-revalidate' }])('does not retain unvalidated or no-store metadata with headers %s', async (headers) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ version: 1 }, { headers }))
    vi.stubGlobal('fetch', fetch)
    const read = createModelDirectoryReader()
    await read(METADATA_URL, new Headers())
    await read(METADATA_URL, new Headers())
    expect(fetch.mock.calls.map(call => new Headers(call[1]?.headers).get('if-none-match'))).toEqual([null, null])
  })

  it('keeps each Host reader’s validator independent', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => metadata(1, '"one"'))
    vi.stubGlobal('fetch', fetch)
    const first = createModelDirectoryReader()
    await first(METADATA_URL, new Headers())
    await first(METADATA_URL, new Headers())
    await createModelDirectoryReader()(METADATA_URL, new Headers())
    expect(fetch.mock.calls.map(call => new Headers(call[1]?.headers).get('if-none-match'))).toEqual([null, '"one"', null])
  })

  it.each([URL, 'https://models.dev/api.json?preview=1', 'https://models.dev/other.json', 'http://models.dev/api.json'])(
    'does not cache another directory at %s', async (url) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => metadata(1, '"one"'))
      vi.stubGlobal('fetch', fetch)
      const read = createModelDirectoryReader()
      await read(url, new Headers())
      await read(url, new Headers())
      expect(fetch.mock.calls.map(call => new Headers(call[1]?.headers).get('if-none-match'))).toEqual([null, null])
    },
  )

  it.each(['authorization', 'x-org-id', 'cookie', 'accept'])('does not cache requests carrying %s', async (name) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => metadata(1, '"one"'))
    vi.stubGlobal('fetch', fetch)
    const read = createModelDirectoryReader()
    const headers = new Headers({ [name]: 'fixture-value' })
    await read(METADATA_URL, headers)
    await read(METADATA_URL, headers)
    expect(fetch.mock.calls.map(call => new Headers(call[1]?.headers).get('if-none-match'))).toEqual([null, null])
  })
})
