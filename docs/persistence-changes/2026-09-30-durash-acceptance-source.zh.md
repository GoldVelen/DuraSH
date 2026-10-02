---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-30-durash-acceptance-source

[English](2026-09-30-durash-acceptance-source.md) | 中文

## 概述

为当前会话格式声明 DuraSH 验收观察消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

该来源仅用于归因，不引入专属回放、授权或载荷校验语义。已有记录仍有效；历史 V3 转换器继续使用现有前缀来源类型保留旧插件通知。

<a id="verification"></a>
## 验证

可靠性包及验收工具测试通过，覆盖观察通知记录和未变化观察去重。

<a id="dev-note"></a>
## 开发备注

无。
