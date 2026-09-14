# Agent Note: 将 DeepSeek Harness 0.1.5 协调进 DuraSH 叠加层

Status: implemented

[English](2026-09-14-durash-upstream-0.1.5-overlay.md) | 中文

## 问题

六小时一次的 `Sync verified upstream` 工作流无法把 DeepSeek Harness `master` 合并进 DuraSH。每个新的上游 SHA 都会改写未合并的叠加层路径，持久阻塞指纹因此不断变化，GitHub 每次 cron 都会寄出失败邮件。只对相同指纹保持静默，无法让 DuraSH 留在当前 DSH 线上。

## 决策

在隔离 worktree 中，把 `c291e7961a515f6d7af9304e7fd1d257929aef26`（`master` 上的 `dsh-v0.1.5-rc.2`）合并进 DuraSH 叠加层。保留产品包、`durash` profile、由 Client 挂载的 reliability Remote、拆分后的工具目录、`INERT_LEGACY_EVENT_TYPES`、pi-ai `catalogProvider`，以及在任何 Blacksmith 或企业标签之前强制 `ubuntu-24.04` / `windows-2025` 的下游 runner 前缀。恢复 Host TypeScript 程序中的 DuraSH 工程引用，并在其中列出 `apps/web/tests/client-build-record.ts` 以便叠加层 HMR e2e 能通过类型检查，保留工具目录完整性检查的 glob 参数，使 `gen-durash-tool-catalog` 不会扫描上游 `tool-*` 包，并在采用上游 lockfile 之后重写 `pnpm-lock.yaml`，使 `@durash/*` 包仍可安装。把主基线记录进 `UPSTREAM_SOURCES.json` 与 `INTEGRATION_STATUS.md`。

## 考虑过的替代方案

- 只推送尚未上远程的 sync-block 提交。否决：上游 SHA 移动仍会改写冲突文件并使 cron 失败。
- 原样采用上游 lockfile、Host tsconfig 引用与工具目录完整性辅助函数。否决：`@durash` 包会从安装和 Host 程序中消失，DuraSH 目录生成器随后会对每个上游 `tool-*` 包失败。
- 在正在运行的 3080 工作树里编辑。否决：该 checkout 是正在运行的 GUI；叠加层合并属于单独的 worktree。

## 后果

合入后，已记录的主 SHA 与 `durash-upstream/master` 一致。下一次定时运行在上游再次移动前处于 in-sync，issue #10 可以关闭，依据是合并已干净，而不是指纹未变。Vendored Cordis 家族的 npm 漂移仍是审查 issue，不属于本次合并。

## 验证

- `scripts/ci-workflow.spec.ts`：下游 `ubuntu-24.04` / `windows-2025` 前缀、Cloudflare 跳过，以及 `evaluate()` 把 `github.repository` 设为 canonical 名称。
- `scripts/check-workspace-constraints.spec.ts` 与 `scripts/release/families.spec.ts`：`@durash/` 包保持 private，并且不进入公开发布 family。
- `packages/llm/llm-pi-ai/tests/catalog.spec.ts`：空的或不可用的 `catalogProvider` 会被拒绝。
- `packages/core/tools/tests/gen-tool-catalog.spec.ts` 与 `packages/reliability/durash-tool-reliability/tests/gen-durash-tool-catalog.spec.ts`：上游完整性检查点名 `tool-bash` 而不点名 `durash-tool-reliability`；DuraSH glob 点名产品工具。
- Session format 套件仍是 inert legacy 事件类型的所有者。定时 GitHub 邮件与正在运行的 3080 GUI 不在这些套件的声明范围内。
- `pnpm run typecheck`：Host 程序列出 `apps/web/tests/client-build-record.ts`，供叠加层 HMR e2e 使用。
