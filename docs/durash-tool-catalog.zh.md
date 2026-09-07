<!-- 英文源文件由 scripts/gen-durash-tool-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-durash-tool-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/durash-tool-catalog.md` 重新记录配对。 -->

# DuraSH 工具 Schema 目录

[English](durash-tool-catalog.md) | 中文

已发布插件向 `ctx.tools` 提供的所有面向模型的工具：模型通过系统提示词组装获得的 `name`、`description` 和 JSON Schema `parameters`。本目录是[子系统页面](subsystems/core.zh.md)（类型及每页生成的 Cordis API 区域）的补充；本页列出的是向 agent 提供的*工具*。

本文件由系统**生成**，并通过 `pnpm run verify-durash-tool-catalog`（`doc-sync` 的一部分）验证新鲜度；不要手工编辑。与 Cordis 目录（纯源码 AST 处理）不同，生成器会在真实上下文中**启动**每个工具插件并读取 `ctx.tools.schemas()`，因为工具 schema 无法通过静态分析完全确定（运行时展开的枚举、拼接描述、配置驱动的名称、原始 JSON Schema 的 MCP 工具）。完整性守卫会 glob 匹配 `packages/*/durash-tool-*` 包；如果生成器的启动清单遗漏任何包，检查就会失败，因此新工具不会在无人察觉的情况下缺少文档。参见[工具 schema 目录 Agent Note](../.agents/notes/implemented/process/2026-07-02-tool-schema-catalog.zh.md)。

范围：`packages/*/durash-tool-*` 下已发布的产品工具，每个工具均使用其默认配置启动；但如果某个 Config 字段是必填且没有默认值，生成器就必须作出选择，对应包的说明会记录本页展示的是哪个分支。注册的工具名称可以是加载时配置（例如 `tool-subagent` 的 `toolName`），因此部署可能以不同或额外名称提供某个包；如果存在随产品发布的别名，对应包的说明会予以记录。`examples/` 中的演示工具（例如 `echo`）不在范围内，这与 Cordis 目录仅涵盖包的范围一致。

## 工具包映射

下表把模型可见的工具名连接到背后的插件包和服务。精确 JSON Schema 见下方各包章节。

| 工具包 | 模型可见名称 | 依赖 | 写入 / 影响 | 随产品发布的别名 | 部署说明 |
| --- | --- | --- | --- | --- | --- |
| `@durash/dsh-tool-reliability` | `dsh_reliability_handoff` | `ctx.tools`, `ctx.systemPrompt`, `ctx.agents`, `ctx.reliabilityPolicy`, `ctx.reliabilityLoopRuntime`, `a live enabled root Agent at execution time` | `tool/call`, `reliability-loop durable state and child Session events`, `tool/result` | - | 仅由 `durash` profile 随产品发布。schema 在进程内始终注册；只有当前会话策略已启用并选定实施与审查路由时才允许执行，否则闭门失败。 |

<a id="durashdsh-tool-reliability"></a>

## `@durash/dsh-tool-reliability`

### `dsh_reliability_handoff`

After presenting the implementation plan in the ordinary assistant response, hand the current objective to the enabled reliability loop and wait for one implementation stage, one independent review, and at most one rework pass to reach a terminal result. Supply the complete objective. This is a foreground call: do not poll or repeat the same handoff while it is pending.

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "Complete implementation objective and user-visible outcome."
    }
  },
  "required": [
    "objective"
  ]
}
```

来源：[`packages/reliability/durash-tool-reliability/src/index.ts`](../packages/reliability/durash-tool-reliability/src/index.ts)

仅由 `durash` profile 随产品发布。schema 在进程内始终注册；只有当前会话策略已启用并选定实施与审查路由时才允许执行，否则闭门失败。
