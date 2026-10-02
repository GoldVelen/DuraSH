---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-30-durash-acceptance-source

English | [中文](2026-09-30-durash-acceptance-source.zh.md)

## Summary

Declares the DuraSH acceptance observation message source for the current Session format.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-30-durash-acceptance-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "d2424f2dcf226b920671a5727a751b196798384340c8894b55c297531bb4b7f5"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "c621de99085d6101caf18fc3befa7a1dcebe85a67f18c9553ca1a0004018f235"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "3d370e079693e52e33be6372788e2d27dc75b0d276866ce0c74ec43cc93ecfd0"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "2aec91f5009863b79cfddfb5bf0e9128a7fe6a77ce66e775872adf666245085e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The source is attribution only and has no special replay, authorization, or payload validation semantics. Existing records remain valid; the historical V3 converter retains earlier plugin notices under its existing prefixed source kind.

<a id="verification"></a>
## Verification

The reliability package tests and acceptance-tool tests passed, including recorded observation notices and unchanged-observation deduplication.

<a id="dev-note"></a>
## Dev Note

None.
