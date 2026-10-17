/**
 * Message source kinds this package contributes: the Host acceptance notice it
 * appends to a step, declared once so every consumer compiles the same union.
 * @module @durash/dsh-tool-reliability/source
 */
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'durash-acceptance': { kind: 'durash-acceptance' } & ContextFormed
  }
}
