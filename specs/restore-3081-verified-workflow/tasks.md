# 3081 已验证工作流能力迁移：实施计划

## 状态

本任务清单已由用户于 2026-08-31 确认，当前进入 Phase 4 实施。执行期间逐项更新复选框，不扩大已确认的 [requirements.md](requirements.md) 与 [design.md](design.md)。

- [x] 1. 建立版本 2 的可靠性流程数据与会话投影
  - 把 loop 记录改为会话归属、正整数 revision、`accepted` 阶段、两条完整 lane、两轮独立报告、更新时间与终态关闭时间。
  - 把 `reliability_loop` domain 升到版本 2，补齐 schema、结构不变量和无效相邻反例；不增加版本 1 兼容读取，也不触碰现有用户介质。
  - 新增 client-safe ref/status/details/terminal 类型以及 `reliability-loop/change` SessionEventMap 成员。
  - 注册 `reliabilityLoop` session projection；完整折叠 `current`，拒绝旧 revision 回退，并覆盖 start、stage、terminal 与 dismiss。
  - _Requirements: R1, R2, R3, R4_

- [x] 2. 把流程驱动所有权从工具移到宿主运行时
  - 实现 `startDetached()`：每会话串行拒绝重复活动流程，先持久化 `accepted`，再注册唯一 driver，返回启动回执。
  - 重构 `LoopDriver`，把 `terminal` 与 `suspended` 作为互斥结算；显式取消写 `cancelled`，宿主/Agent 拆卸只停止当前 run 并保留非终态记录。
  - 自动观察所有 driver 的完成与错误，释放 `live` 所有权，禁止无人观察 rejection 结束 Host。
  - 在 parent Agent scoped 生命周期安装暂停守卫；服务拆卸先 suspend 全部 driver，再关闭 domain。
  - 在初始化现有 roots 与后续 `agent/created` 上恢复唯一非终态流程，只重跑第一个未完成阶段。
  - 用竞争测试固定 start/start、resume/resume、stage/suspend、stage/cancel 和 storage fault 行为。
  - _Requirements: R1, R2, R5_

- [x] 3. 实现状态发布、崩溃缝补与一次终态交付
  - 每次 domain 记录提交后，从 domain 重新选择该会话当前 view，再追加完整 `reliability-loop/change`。
  - 在 `agent/created` 比较 domain revision 与会话日志，补写缺失状态；补写时不得从 session projection 推进 loop。
  - 在终态提交后追加有界 terminal notice；以 loop id 扫描既有通知，保证重启和重复 reconcile 不生成第二份。
  - 限制目标摘要为 160 字符、终态摘要为 800 字符、持久错误为 `maxHandoffChars`；原始长错误留在 workflow/child session 日志。
  - 覆盖 domain 已提交但 event 未提交、event 已提交后重启、旧流程迟到通知与新流程并存的回归。
  - _Requirements: R3, R4, R5_

- [x] 4. 暴露受会话鉴权的流程控制 Remote
  - 让可靠性运行时提供 Typert `details`、`cancel` 与 `dismiss` Remote，并导出纯 client types/remote 入口。
  - 对每个调用校验精确 live Agent 与 record.sessionId；`cancel`/`dismiss` 还校验 ref revision，跨会话、未知和 stale 写入 ref 全部失败关闭；只读 `details` 返回最新归属记录，使终态节点在状态条关闭后仍可查看。
  - 让活动 cancel 等待 driver/worker/child 静止；让 suspended cancel 直接写一次终态；dismiss 只关闭当前可见终态且不删除历史。
  - 把新 Remote 显式接入 `@deepseek-ai/dsh-api-remotes` 的 Host/Client assembly 与相关 package manifests。
  - _Requirements: R2, R3, R4_

- [x] 5. 让 handoff 工具快速返回且只接受当前人类回合
  - 把工具输出改为 `{ loopId, revision, status: 'accepted' }`，调用 `startDetached()` 后立即返回，不再等待 loop terminal。
  - 删除 tool abort 到 loop cancel 的监听，更新工具描述和系统提示为“后台运行、不要轮询、状态在输入框上方”。
  - 把人类门禁从“历史中存在人类消息”收紧为“当前 open turn 的发起消息是直接人类消息”，阻止系统通知、恢复回合和子代理递归 handoff。
  - 用未结算 driver、已 abort signal、父回合结束和重复 handoff 测试证明工具调用不再拥有流程。
  - _Requirements: R1, R2, R4_

- [x] 6. 给通用 workflow `agent()` 增加思考强度传递
  - 在 worker realm 支持列表、参数校验、`ChildStartRequest`、worker protocol 和 Host child start 中加入 `reasoningEffort`。
  - 把合法值作为 `AgentOptions.reasoningEffort` 传给 subagent；错误类型、未知字段和 provider 不支持路径保持失败关闭。
  - 更新 workflow 类型/JSDoc、协议测试、worker session 测试和真实跨线程回归；代码中不得出现 DuraSH、xAI 或 Grok 条件分支。
  - _Requirements: R6_

- [x] 7. 用模型真实能力重做可靠性策略目录
  - 升级 `@earendil-works/pi-ai` 到 0.84.4 并更新 lockfile，保留依赖许可与 notices 的生成检查。
  - 删除 `RELIABILITY_THINKING_LEVELS` 作为每模型目录来源；对每个 listModels 项调用 `resolveModelInfo()`，投影 effort id/name/description/default。
  - 允许无 reasoning 模型保存 `null`；有 reasoning 模型只接受其 effort 集合中的值。
  - 让目录漂移保留用户原选择并返回明确 validation error，不自动改档或静默覆盖；无效策略不能启用或启动。
  - 让有效路由异步返回 provider/model/reasoningEffort，并把两条 lane 完整写入 loop 记录与阶段脚本参数。
  - 覆盖 Grok 4.6 的 low/medium/high/xhigh、不同档位集合模型、无 reasoning 模型、失效保存值和阶段 child 实际 options。
  - _Requirements: R6_

- [x] 8. 在输入框上方实现会话级状态条和终态对话节点
  - 在现有 `ui-reliability` 包新增 `ReliabilityStatusDock`，注册到 `conversation.input.dock` 的 order -10；没有 view 时渲染 `null`。
  - 从 session projection 读取当前会话状态，覆盖 accepted、四个执行阶段、completed、blocked、failed、cancelled，不从工具文案猜测。
  - 实现 36px 紧凑布局、窄屏降级、现有主题 token、键盘焦点、polite live region 与 reduced-motion；不新增字体、渐变或大遥测卡片。
  - 实现详情 popover、带确认的取消、终态关闭，并接入步骤 4 的 CAS Remote。
  - 为 terminal notice 注册稳定 loop-id Conversation Node；每个流程只显示一条终态结果，不渲染活动遥测，也不额外调用模型。
  - 扩充中英文 locale、组件/控制器/slot 测试和 DuraSH browser composition 实测。
  - _Requirements: R3, R4, R6_

- [x] 9. 固定长上下文、实时报错与 worker 隔离回归
  - 用真实 standard/durash preset 组合证明 reliability 阶段 child 实际继承 token-meter、tool-result-pruner 与 compaction-basic。
  - 构造大工具结果，证明后续请求前产生可回放裁剪记录；构造 provider `CONTEXT_WINDOW_EXCEEDED`，证明压缩推进后重试。
  - 构造不可压缩输入、provider 流错误、worker death 和 child failure，证明 loop 持久 `failed` 且另一个会话与 Web Host 继续服务。
  - 如果组合测试失败，只修改最接近的通用 preset/subagent 组合点；不复制旧 3081 workflow executor，不提高 wall-clock 或 unit timeout。
  - _Requirements: R2, R5_

- [x] 10. 更新持久事件消费者、SDK 与关键无钥匙快照
  - 重新生成并审查 session event persistence catalog，保证新增事件为 required-on-read 且格式版本策略符合当前仓库规则。
  - 同步 TypeScript SDK 与 Python SDK 的事件预期输出和相关类型投影。
  - 更新关键 recorded-session snapshot：模型先收到快速启动回执，客户端随后从持久事件得到一条终态结果。
  - 覆盖刷新、重连、重启后终态不重复以及主对话不出现实时遥测洪流。
  - _Requirements: R1, R3, R4, R5_

- [x] 11. 同步中文优先的首页、融合状态与所有行为文档
  - 精简 `README.md` 首屏，使中文先说明按需模型分工、成本优先、后台可恢复与当前闭环；继续并列目标多路流程和当前较小闭环。
  - 同步 `README.zh.md`、`INTEGRATION_STATUS.md`/中文页，删除“思考强度只记录”“runtime teardown 写取消”等已过时描述，同时保留协调、多路审查和自动成本调度缺口。
  - 更新 reliability loop/policy/tool/UI/workflow worker README 双语对与 `docs/subsystems/reliability-loop.*`、`docs/subsystems/workflow.*`。
  - 新增中英文 implemented Agent Note，记录后台所有权、单一 domain 真源、派生 session 投影、suspend/cancel 和旧 3081 迁移边界。
  - 运行翻译配对写回与生成文档 freshness；不手改生成目录。
  - _Requirements: R7_

- [ ] 12. 完成聚焦验证和隔离的 3081 实际组合验收
  - 按受影响面运行 loop/tool/policy/workflow/UI/SDK 的聚焦测试、相关类型检查、客户端国际化、browser composition、文档门禁与 `git diff --check`。
  - 使用任务专属 DSH_HOME 和端口启动构建后的 `durash` profile，实测快速回执、状态条、取消、终态结果、Grok effort 目录和 Host 存活。
  - 保持当前 3080 服务、登录态和版本 1 `reliability_loop` 介质不变；除非用户另行授权，不归档、不迁移、不替换默认服务。
  - 只在失败证据证明跨仓库风险时扩大测试矩阵；不默认重复全量测试。
  - _Requirements: R1, R2, R3, R4, R5, R6, R7_

- [ ] 13. 审查差异、提交并推送可靠性修复分支
  - 审查完整 diff，确认没有旧脏工作树内容、凭据、生成缓存、超时放宽或 Issue #1 vendored 更新混入。
  - 按逻辑边界创建中文 `<type>: <中文描述>` 提交；Agent Note 与对应代码位于同一提交序列。
  - 运行 `dsh-pre-push-checks` 选择的必要检查后，把 `codex/restore-3081-runtime-20260831` 推送到 `origin`；不 force、不 merge、不部署。
  - 报告远端 commit、已运行检查与仍未覆盖的真实模型/平台证据。
  - _Requirements: R1, R2, R3, R4, R5, R6, R7_

- [ ] 14. 在独立分支处理 GitHub Issue #1
  - 从当时最新 `origin/main` 建立独立工作树与 `codex/vendor-issue-1-20260831`，不带入可靠性修复分支和任何用户脏改动。
  - 按 `vendor/README.md` 分别比较 Cordis、Loader、Include 与 Timer 新版本，核对 manifest、同步过程和每项 DuraSH 本地修改的保留/退役依据。
  - 只有兼容性检查通过才更新 vendor 记录、依赖与 notices；使用独立中文提交并推送该分支，不 force、不 merge。
  - 若四项漂移全部安全消除，在 Issue #1 留下验证证据并关闭；若任何一项阻塞，记录具体版本、差异和失败检查并保持 Issue 打开。
  - _Requirement: 独立工作项 GitHub Issue #1_
