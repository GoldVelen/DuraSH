# Agent Note: DuraSH 产品叠加层与上游同步

Status: implemented

[English](2026-08-30-durash-product-overlay-and-upstream-sync.md) | 中文

## 问题

已有可靠性工作位于较旧的 DeepSeek Harness 基线上，并且把下游呈现与上游自有包混在一起。直接公开这棵工作树会造成商标边界含混、源码引用难以审计，并让每次上游更新都变成大范围冲突。仓库还设置了三十天 Dependabot 冷却期，也没有能够真正准备主上游同步变更的机制。

## 决策

使用 DuraSH 作为简短的独立产品身份，并以当前官方 DeepSeek Harness 发行版为基座。产品呈现由 `@durash` 浏览器品牌插件与增量 `durash` profile 提供；该 profile 应用在上游 base 与 Web bundle 之后，上游官方品牌包保持不变。

源码发行版以 DuraSH 作为默认产品路径。`pnpm run build` 选择 DuraSH 客户端身份，`pnpm start` 选择匹配的 `durash` 运行 profile。`pnpm run build:local` 保留中性的上游开发客户端，`pnpm run build:official` 保留官方发布产物。源码启动会拒绝 DuraSH 运行时与非 DuraSH 构建记录的组合，也会拒绝上游 `web` 运行时与 DuraSH 客户端产物的组合。

DuraSH 自有的六个包——`@durash/dsh-web-profile`、`@durash/dsh-client-ui-brand`、`@durash/dsh-client-ui-reliability`、`@durash/dsh-reliability-loop`、`@durash/dsh-reliability-policy` 与 `@durash/dsh-tool-reliability`——都是私有源码 checkout 包。源码 CLI 会把 `durash` 作为安装自有模板交给 app boot。公开的 `@deepseek-ai/dsh` 只暴露由已发布包支撑的模板，并且只能从 `devDependencies` 引用私有 workspace 包；发布 family 会拒绝指向私有 workspace 包的 `dependencies`、`optionalDependencies` 与 `peerDependencies`。

在 `UPSTREAM_SOURCES.json` 中记录每个源码级上游。定时 workflow 审计全部记录的来源，为 DSH 主上游准备唯一一个自动化专属 merge PR，并为更新的 vendored 公共发行版维持唯一一个 review Issue。主上游合并会在临时 checkout 中显式启用仓库的双语配对驱动，使已确认的伴随记录可以合并，同时所有者文件冲突仍会阻止运行。registry 与 Actions 依赖遵循 [Dependabot 更新决策](../process/2026-07-27-dependabot-version-updates.zh.md)：每日检查、不设置人为冷却期，而且只有配置 required compatibility checks 后才允许显式启用自动合并。

继承的 Issue lifecycle 与 PR policy job 将 `deepseek-harness/deepseek-harness` 声明为唯一适用仓库。下游仓库会在 checkout、令牌创建或 policy 执行前跳过这些 job；它不会把自己无法管理的 Project 状态报告成 policy 通过。Python runtime workflow 在每个仓库中都保留完整的无密钥 installed-wheel 矩阵。real-API 预检与在线 smoke 步骤只适用于符合条件的 `deepseek-harness/deepseek-harness` CI；canonical 路径缺少外部密钥时仍会失败，而 fork、Dependabot 与下游运行不会请求该密钥。

继承的 PR CI 只在 `deepseek-harness/deepseek-harness` 中选择上游企业 runner 或自托管故障转移池。下游仓库会在标准 `ubuntu-24.04` 与 `windows-2025` runner 上运行相同代码门禁；其外层门禁调度器、覆盖率分区、Vitest 进程、快照、代码检查器与包检查使用下游 worker 预算，而不沿用 canonical 仓库的 16 核配置。上游故障转移变量既不会改变这些 job 的 runner，也不会重新放大其并发。Cloudflare 预览 job 会在 checkout 或读取凭据前限定为仅 canonical 仓库运行，因为其 Pages 项目与 Access 凭据都属于上游仓库。

历史可靠性行为只有在当前 workflow 接口上重建后，才能进入“已实现”声明。`INTEGRATION_STATUS.md` 是区分继承、已实现、已准备与未迁移状态的权威来源。

## 考虑过的替代方案

- 给上游官方包改名或直接修改官方包：拒绝，因为会破坏所有权清晰度并放大合并冲突。
- 整体复制旧的持久化 workflow 栈：拒绝，因为当前基线领先一千多个上游提交，并且已经提供不同的 workflow 与 UI 接口。
- 盲目合并每个检测到的更新：拒绝，因为没有兼容性证据的新鲜度会把上游故障直接转移给用户。
- 发布私有 `@durash` 包，或通过 optional、development-only 包元数据把 `durash` 保留为安装版模板：拒绝，因为前者会扩大公开发布面，后者则在隐藏打包失败的同时留下无法工作的安装版命令。
- 在下游仓库中通用化上游 Issue Project policy，或要求下游 Python 矩阵提供其 real-API 凭据：拒绝，因为相关 App 凭据、Project 字段、生命周期操作身份与提供商账户都属于上游仓库，而下游仓库负责无密钥产物兼容性。
- 在下游 CI 中保留上游企业 runner 标签，或把上游 Cloudflare 部署搬到标准 runner：拒绝，因为前者会在没有合格 runner 时让 job 永久排队，后者会在缺少下游凭据时访问上游自有部署。

## 后果

仓库具有较小、清晰的下游所有权表面、默认使用 DuraSH 的源码入口、DuraSH 专属构建与组合检查，以及重复追踪最新已验证上游的路径。源码启动保留私有 `durash` 产品组合，安装后的 `@deepseek-ai/dsh` 则只暴露其包已经进入公开发布 family 的 profile。自动化合并只组合可确定的配对记录，不会让语义冲突变为通过。组织自有的 Issue 与预览部署检查在 DuraSH 中会明确显示为不适用。下游代码门禁使用可用的标准 GitHub runner，Python 产物则在不假设上游提供商凭据的情况下保留跨平台 installed-wheel 证明，而符合条件的 canonical 路径仍会拒绝缺失的外部密钥。上游开发与官方产物命令保持显式，不继承产品默认值。GitHub 公共仓库创建后，仍需配置 Actions 与分支保护。品牌/profile 迁移不等于可靠性引擎迁移完成；后者仍是下一产品里程碑，不能提前对外宣传为已完成。
