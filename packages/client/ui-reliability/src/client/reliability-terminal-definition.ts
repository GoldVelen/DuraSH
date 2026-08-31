import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ReliabilityLoopTerminalNotice,
  TerminalReliabilityLoopStage,
} from '@durash/dsh-reliability-loop/client'

/** Renderer-ready once-per-loop terminal result. */
export interface ReliabilityTerminalNodeData {
  readonly loopId: ReliabilityLoopTerminalNotice['loopId']
  readonly revision: number
  readonly stage: TerminalReliabilityLoopStage
  readonly settledAt: string
  readonly summary: string
}
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Deterministic terminal result for one reliability loop. */
    'reliability-loop-terminal': ReliabilityTerminalNodeData
  }
}

interface ReliabilityTerminalState extends ReliabilityTerminalNodeData {
  readonly seq: number
}

/** Project only terminal notices; activity remains exclusively in the input dock. */
export const reliabilityTerminalDefinition: ConversationNodeDefinition<ReliabilityTerminalState> = {
  kind: 'reliability-loop-terminal',
  target: 'chat',
  match: event => event.type === 'reliability-loop/change' && event.data.terminal !== undefined
    ? { id: String(event.data.terminal.loopId), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'reliability-loop/change' || match.event.data.terminal === undefined) {
      throw new Error('reliability-loop-terminal requires a terminal reliability-loop/change event')
    }
    return {
      ...match.event.data.terminal,
      seq: match.event.seq,
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'reliability-loop-terminal',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: {
        loopId: context.state.loopId,
        revision: context.state.revision,
        stage: context.state.stage,
        settledAt: context.state.settledAt,
        summary: context.state.summary,
      },
    }
  },
}
