/**
 * Shared validation for settings-controller Remote request payloads.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/remote-request.ts
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ZodType } from 'zod'

/**
 * Parse constraints that are more specific than generated TypeScript codecs.
 * @param method - Remote method named in a validation failure.
 * @param schema - Zod schema for the method payload.
 * @param value - Untrusted payload to parse.
 * @returns the parsed payload.
 * @throws RemoteError `gateway/bad-request` when the payload violates the schema.
 */
export function parseRemoteRequest<T>(method: string, schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteError(
      'gateway/bad-request',
      `invalid payload for ${method}`,
      { issues: parsed.error.issues },
    )
  }
  return parsed.data
}
