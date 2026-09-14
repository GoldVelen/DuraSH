# Agent Note: 持久的上游同步阻塞、Client reliability Remote 与 DuraSH 工具目录

Status: implemented

[English](2026-09-06-durash-sync-block-reliability-remote-catalog.md) | 中文

## 问题

DuraSH 仍以整树 `git merge` DeepSeek Harness `master` 为同步模式。六小时工作流每次重试该合并，却把任意非零 `git merge` 都当成文本冲突，再次评论并使 cron 失败。相同叠加层冲突因此反复触发失败邮件。上游 `dsh-api-remotes` 还把 DuraSH reliability Remote 编进装配，因此每次 remotes 变更都会撞上产品自有命名空间。共享的工具目录生成器把 DuraSH `durash-tool-*` 启动配方混进上游默认清单，上游精确名单测试与 DuraSH 产品文档因此共用一个热点。

## 决策

保留 primary-merge、六小时检查、`automation/upstream-sync` 以及 opt-in auto-merge。仅当 git 记录了未合并路径时，才把非零合并分类为文本冲突。用这些路径的指纹，把阻塞状态以机器可读 HTML 注释写进专用冲突 issue。第一次报告会评论或创建 issue 并使作业失败。指纹未变则更新 issue 正文和运行摘要，不再评论，也不再让 cron 失败。指纹变化则再次报告。网络、权限、安装，以及没有未合并路径的合并错误保持可见。合并变干净后关闭 issue；准备好的 PR 不是产品检查通过。

由 `@durash/dsh-client-ui-reliability` 挂载 `@durash/dsh-reliability-policy/remote`：插件 `inject` 等待 `remote`，`apply` 先挂载生成贡献，再用 `ctx.inject(['remote.reliabilityPolicy', ...])` 创建 UI。上游 remotes 保留其余 Remote。DuraSH 消费者直接纳入 `/remote` 声明。

`scripts/gen-tool-catalog.ts` 继续只生成上游 `packages/*/tool-*`。DuraSH 工具走 `scripts/gen-durash-tool-catalog.ts` 和 `docs/durash-tool-catalog.md`。带 `package.json` 的包未进入对应启动清单时完整性检查仍失败；已列出的插件未注册工具时收获仍失败。测试中的工具名保持手写，不从同一次收获复制。

## 考虑过的替代方案

- 降低 cron 频率，或把任意合并非零都当成已知冲突。否决：监测必须继续重试，非冲突故障必须保持可见。

- 用 runner 缓存或另建数据库保存阻塞状态。否决：专用 issue 已经跨过单次作业存活。

- 把 Remote 挂载搬进 Host profile 入口。否决：生成的 `/remote` 贡献由 Client 装配拥有。

- 复制整份目录生成器，或从同一次收获推导期望名单。否决：上游默认范围必须保持上游，DuraSH 验收必须独立表达。

## 后果

相同文本冲突不再重复评论和 cron 失败邮件。issue 与作业摘要仍说明同步阻塞，而不是产品检查通过。未改变未合并路径集合的目标分支提交保持同一指纹。解决逻辑变化仍会重试，因为每次运行都会再次合并。

`dsh-api-remotes` 不再依赖 `@durash/dsh-reliability-policy`。composer 芯片仍在挂载之后注入 `remote.reliabilityPolicy`。Host policy、`durash` profile 和 `INERT_LEGACY_EVENT_TYPES` 不变。

`docs/tool-catalog.md` 不再列出 `dsh_reliability_handoff`。`docs/durash-tool-catalog.md` 列出。记录该 schema 的包 README 链接到 DuraSH 目录。

## 验证

- `scripts/upstream-sync-block.spec.ts`：真实 git 文本冲突、目标分支更新但文件相同、新增冲突文件、非冲突合并对象、首次/已知/变化的 GitHub 决策、解除阻塞，以及 CLI report/resolve。

- `packages/client/ui-reliability/tests/browser-plugin.client.spec.ts`：挂载、UI 注册、卸载、注册失败回滚、热更新后不重复注册命名空间。

- `packages/core/tools/tests/gen-tool-catalog.spec.ts` 与 `packages/reliability/durash-tool-reliability/tests/gen-durash-tool-catalog.spec.ts`：独立期望名单；空的 DuraSH glob 点名 `durash-tool-reliability`；空的上游 glob 点名 `tool-bash` 且不含 DuraSH 包。

- 现有 reliability-loop、policy 持久化与 session-format 套件仍分别拥有 handoff、重启读取，以及 v0/v1/v2 与惰性遗留事件。这些套件不断言真实 GitHub issue/评论邮件、对着本 GUI 的有头浏览器，或付费模型调用。
