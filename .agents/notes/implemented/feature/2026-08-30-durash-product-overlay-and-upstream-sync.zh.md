# Agent Note: DuraSH 产品叠加层与上游同步

Status: implemented

[English](2026-08-30-durash-product-overlay-and-upstream-sync.md) | 中文

## 问题

已有可靠性工作位于较旧的 DeepSeek Harness 基线上，并且把下游呈现与上游自有包混在一起。直接公开这棵工作树会造成商标边界含混、源码引用难以审计，并让每次上游更新都变成大范围冲突。仓库还设置了三十天 Dependabot 冷却期，也没有能够真正准备主上游同步变更的机制。

## 决策

使用 DuraSH 作为简短的独立产品身份，并以当前官方 DeepSeek Harness 发行版为基座。产品呈现由 `@durash` 浏览器品牌插件与增量 `durash` profile 提供；该 profile 应用在上游 base 与 Web bundle 之后，上游官方品牌包保持不变。

源码发行版以 DuraSH 作为默认产品路径。`pnpm run build` 选择 DuraSH 客户端身份，`pnpm start` 选择匹配的 `durash` 运行 profile。`pnpm run build:local` 保留中性的上游开发客户端，`pnpm run build:official` 保留官方发布产物。源码启动会拒绝 DuraSH 运行时与非 DuraSH 构建记录的组合，也会拒绝上游 `web` 运行时与 DuraSH 客户端产物的组合。

在 `UPSTREAM_SOURCES.json` 中记录每个源码级上游。定时 workflow 审计全部记录的来源，为 DSH 主上游准备唯一一个自动化专属 merge PR，并为更新的 vendored 公共发行版维持唯一一个 review Issue。主上游合并会在临时 checkout 中显式启用仓库的双语配对驱动，使已确认的伴随记录可以合并，同时所有者文件冲突仍会阻止运行。registry 与 Actions 依赖遵循 [Dependabot 更新决策](../process/2026-07-27-dependabot-version-updates.zh.md)：每日检查、不设置人为冷却期，而且只有配置 required compatibility checks 后才允许显式启用自动合并。

继承的 Issue lifecycle、PR policy、可信 live API wheel 检查以及官方 `@deepseek-ai/dsh` 发布 job 将 `deepseek-harness/deepseek-harness` 声明为唯一适用仓库。下游仓库会在 checkout、令牌创建、policy 执行、live API 预检或打包安装发布演练前跳过这些 job；它不会把自己无法管理的 Project 或 npm 发布状态报告成通过。

历史可靠性行为只有在当前 workflow 接口上重建后，才能进入“已实现”声明。`INTEGRATION_STATUS.md` 是区分继承、已实现、已准备与未迁移状态的权威来源。

## 考虑过的替代方案

- 给上游官方包改名或直接修改官方包：拒绝，因为会破坏所有权清晰度并放大合并冲突。
- 整体复制旧的持久化 workflow 栈：拒绝，因为当前基线领先一千多个上游提交，并且已经提供不同的 workflow 与 UI 接口。
- 盲目合并每个检测到的更新：拒绝，因为没有兼容性证据的新鲜度会把上游故障直接转移给用户。
- 在各个下游仓库中通用化上游 Issue Project policy、可信 live API wheel 检查或官方 `@deepseek-ai/dsh` NPM 发布演练：拒绝，因为相关 App 凭据、Project 字段、生命周期操作身份、可信 API secret、发布标签与公共包命名空间都属于上游仓库。

## 后果

仓库具有较小、清晰的下游所有权表面、默认使用 DuraSH 的源码入口、DuraSH 专属构建与组合检查，以及重复追踪最新已验证上游的路径。自动化合并只组合可确定的配对记录，不会让语义冲突变为通过。组织自有的 Issue 检查、可信 live API wheel 检查和上游官方 NPM 发布演练在 DuraSH 中会明确显示为不适用，而不会因凭据缺失失败或去校验、发布另一个仓库。上游开发与官方产物命令保持显式，不继承产品默认值。GitHub 公共仓库创建后，仍需配置 Actions 与分支保护。品牌/profile 迁移不等于可靠性引擎迁移完成；后者仍是下一产品里程碑，不能提前对外宣传为已完成。
