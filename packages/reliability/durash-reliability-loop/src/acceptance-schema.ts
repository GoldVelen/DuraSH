/** Durable task requirements and executor receipts; model explanations never become receipts.
 * @module @durash/dsh-reliability-loop/acceptance-schema
 */
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Runtime-minted task identifier, independent of any loop or model turn. */
export type AcceptanceTaskId = Branded<'AcceptanceTaskId'>
const taskId = z.string().transform(value => value as AcceptanceTaskId)
const text = z.string().min(1).max(16384)
const paths = z.array(text).max(128)
/** A check's executable plan and immutable user requirement, when quoted from a human message. */
export const acceptanceRequirement = z.object({
  id: z.string().min(1).max(128), origin: z.enum(['user', 'plan']), userQuote: text.optional(),
  description: text, command: text, scope: paths.min(1), required: z.boolean(),
  kind: z.enum(['command', 'pytest-junit', 'xcresult']), reportPath: text.optional(),
  level: z.enum(['process', 'test', 'ui']), attachments: paths, produces: paths,
  buildCheckId: z.string().optional(), allowSkipIf: z.array(z.string()).max(32),
  skipBindings: z.array(z.object({ testId: text, reason: text, prerequisite: text }).strict()).max(1024).optional(),
  externalBoundary: text.optional(),
  target: z.object({
    adapter: text, constraints: z.record(z.string(), z.string()).optional(), expected: text,
    options: z.record(z.string(), z.string()).optional(),
  }).optional(),
}).strict().superRefine((check, ctx) => {
  if (check.origin === 'user' && !check.userQuote) ctx.addIssue({ code: 'custom', message: 'User requirements need a verbatim human quote' })
  if (check.kind !== 'command' && !check.reportPath) ctx.addIssue({ code: 'custom', message: 'Test checks require a result path' })
  if (check.level !== 'process' && check.kind === 'command') ctx.addIssue({ code: 'custom', message: 'Exit codes and logs do not establish test or UI evidence' })
  if (check.level === 'ui' && check.attachments.length === 0) ctx.addIssue({ code: 'custom', message: 'UI evidence requires observable-result attachments and semantic review' })
})
/** Parsed task-specific check. */
export type AcceptanceRequirement = z.infer<typeof acceptanceRequirement>
const source = z.object({ head: z.string(), digest: z.string(), files: z.record(z.string(), z.string()) })
const report = z.object({
  tests: z.number(), passed: z.number(), failed: z.number(), skipped: z.number(),
  skips: z.array(z.object({ testId: text, reason: text })).optional(),
})
const target = z.object({
  adapter: z.string(), digest: z.string(), detail: z.string(), identity: z.record(z.string(), z.string()).optional(),
})
/** One host-observed command; running is persisted before execution and never counts as passing. */
export const acceptanceEvidence = z.object({
  id: z.string(), checkId: z.string(), checkSpecDigest: z.string(), revision: z.number(),
  startedAt: z.string(), endedAt: z.string().nullable(),
  cwd: z.string(), command: z.string(), source: source.nullable(), afterDigest: z.string().optional(),
  outcome: z.enum(['running', 'passed', 'failed', 'unverified', 'cancelled']), exitCode: z.number().nullable(),
  raw: z.string(), artifactPaths: z.record(z.string(), z.string()).optional(),
  attachments: z.record(z.string(), z.string()), report: report.optional(),
  target: target.optional(), outputs: z.string().optional(), buildEvidenceId: z.string().optional(), problems: z.array(z.string()),
})
/** Immutable observation of an attempted check. */
export type AcceptanceEvidence = z.infer<typeof acceptanceEvidence>
/** One persisted task, including all revisions, attempts, and candidate-specific independent review. */
export const acceptanceRecord = z.object({
  taskId, sessionId: z.string(), objective: text, cwd: text, revision: z.number().int(), baseline: z.string(),
  requirements: z.array(acceptanceRequirement).max(32),
  plans: z.array(z.object({ reason: text, requirements: z.array(acceptanceRequirement), revision: z.number() })),
  evidence: z.array(acceptanceEvidence), risks: z.array(z.string()),
  review: z.object({ verdict: z.enum(['approved', 'changes-requested']), feedback: z.string(), candidateKey: z.string() }).nullable(),
})
/** Durable acceptance state. */
export type AcceptanceRecord = z.infer<typeof acceptanceRecord>
/** Acceptance data is separate from released session generations and existing loop rows. */
export const acceptanceDomain = defineDomain({
  name: 'reliability_acceptance', version: 1,
  tables: {
    tasks: domainTable<AcceptanceTaskId, AcceptanceRecord>(acceptanceRecord),
    active: domainTable<string, AcceptanceTaskId>(taskId),
  },
})
