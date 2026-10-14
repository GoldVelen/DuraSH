/** Bounded HTTP reads shared by model directories and their public capability metadata. */

import { LlmError } from '@deepseek-ai/dsh-llm'

/** Maximum directory response bytes, enforced on received chunks. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
/** Maximum bytes for the complete public models.dev metadata database. */
const MAX_METADATA_BYTES = 8 * 1024 * 1024
const METADATA_URL = 'https://models.dev/api.json'

/** A bounded directory read with caller-owned headers and cancellation. */
export type ModelDirectoryReader = (url: string, headers: Headers, signal?: AbortSignal) => Promise<unknown>

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string, maxBytes: number): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${maxBytes} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw oversized()
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw oversized()
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch((_error: unknown) => {
      // An errored or abandoned stream may reject cancellation; retain the read failure.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one JSON model directory under its byte ceiling without redirects or credential-bearing diagnostics.
 * @param url - Exact directory address; models.dev metadata uses the larger catalog ceiling.
 * @param headers - Headers owned by this authority; callers omit auth for metadata hosts.
 * @param signal - Operation cancellation and deadline.
 * @returns Parsed JSON for the directory owner's field validation.
 */
export async function readModelDirectory(url: string, headers: Headers, signal?: AbortSignal): Promise<unknown> {
  return readJson(await fetchDirectory(url, headers, signal), url, signal)
}

/** Fetch without following redirects or exposing a rejected provider body. */
async function fetchDirectory(url: string, headers: Headers, signal?: AbortSignal): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers,
      ...signal === undefined ? {} : { signal },
    })
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  return response
}

/** Parse one received response under its authority's byte limit. */
async function readJson(response: Response, url: string, signal?: AbortSignal): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch((_error: unknown) => {
      // Rejected bodies are unused; cleanup must retain the original HTTP-status diagnostic.
    })
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key or account sign-in' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url, new URL(url).origin === 'https://models.dev' ? MAX_METADATA_BYTES : MAX_RESPONSE_BYTES)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (_error: unknown) {
    // Console configuration may contain credentials; parser diagnostics quote response text.
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED')
  }
  return body
}

/**
 * Create a Host-owned reader that revalidates credential-free public metadata with its ETag.
 * Other addresses and requests carrying headers are never cached; no response is reused without a 304.
 * @returns A reader owning one validated models.dev representation and its validator, without timers or global state.
 */
export function createModelDirectoryReader(): ModelDirectoryReader {
  let cached: { readonly etag: string; readonly body: unknown } | undefined
  return async (url, headers, signal) => {
    if (url !== METADATA_URL || !headers.keys().next().done) return readModelDirectory(url, headers, signal)
    const previous = cached
    const conditionalHeaders = new Headers(headers)
    if (previous !== undefined) conditionalHeaders.set('if-none-match', previous.etag)
    const response = await fetchDirectory(url, conditionalHeaders, signal)
    if (response.status === 304 && previous !== undefined) {
      if (signal?.aborted) throw new LlmError('model discovery aborted by caller', 'ABORTED')
      return previous.body
    }
    const body = await readJson(response, url, signal)
    const etag = response.headers.get('etag')
    cached = etag === null || /\bno-store\b/iu.test(response.headers.get('cache-control') ?? '')
      ? undefined : { etag, body }
    return body
  }
}
