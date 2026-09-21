# Agent Note: DuraSH execution evidence and acceptance

Status: implemented

English | [中文](2026-09-21-durash-execution-evidence.zh.md)

## Problem

A reviewer can approve a convincing summary while tests belong to an older candidate, skip prerequisites are missing, or a focused result hides a required suite failure. Sending every direct conversation to an independent model would add cost without establishing these executable facts.

## Decision

The existing reliability runtime owns a separate acceptance domain shared by direct tools and workflow stages. Executor receipts bind commands to scoped source bytes before execution and preserve results independently of model claims. Human outcome requirements remain fixed; executable plan revisions retain reasons and invalidate affected evidence. Independent review judges semantic adequacy, including risky test changes. The existing one-rework bound remains unchanged.

## Alternatives considered

Natural-language completion detection cannot establish source, artifact or target identity. Static test-change matches cannot decide whether replacing a broken test preserves the user's outcome. A second orchestration system would duplicate ownership already provided by the workflow engine.

## Consequences

Direct chat gains host-visible check status without a second model call. Bound workflows require mechanical evidence and independent approval on the same candidate. Scope selection, test adequacy and device-visible claims still need appropriate observations and semantic review; unavailable adapters remain unverified. See the [runtime reference](../../../../packages/reliability/durash-reliability-loop/README.md#task-acceptance-evidence) for supported adapters and limitations.

## Testing

Owner-local tests cover stale sources/builds, required-suite failure, skip evidence, target mismatch, unchanged input reuse, persistence and cancellation. The keyless `durash-acceptance` session fixture exercises the shipped headless profile with the product plugins, real Git and shell commands, and a controlled model recording. UI tests distinguish checks from independent review while workflow mode is disabled.

A regression reproduces the invariant companion rejecting the production driver’s valid second-round completion. The accepted state now matches the writer; mismatched implementation/review rounds remain rejected. Explicit ignored-file inputs are hashed, and missing input paths fail even when another declared path exists.
