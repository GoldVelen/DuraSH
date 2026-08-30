# 参与 DuraSH 贡献

[English](CONTRIBUTING.md) | 中文

DuraSH 欢迎缺陷报告、文档改进、插件、测试和范围明确的代码贡献。项目仍处于开发者预览阶段，因此提案必须区分 DuraSH 自有可靠性能力与继承的 DeepSeek Harness 行为。

## 贡献前

- 新建内容前先搜索已有 Issue 和 Discussion。
- 按 [SECURITY.md](SECURITY.md) 中的流程私下报告漏洞；不要在 Issue 中公开利用细节。
- 在所有项目空间遵守[行为准则](CODE_OF_CONDUCT.md)。
- 可以使用中文或英文。修改现有双语文档时，必须同时更新两种语言。

## 选择正确的仓库

DuraSH 品牌、产品 profile、更新控制或可靠性能力的变更属于本仓库。普遍适用于 DeepSeek Harness 的改进通常应先提交至 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。如果 DuraSH 必须暂时保留下游修改，请在[融合状态](INTEGRATION_STATUS.md)中记录上游限制与删除条件。

不要直接编辑 vendored 依赖。请遵循 [vendor/README.md](vendor/README.md)，保留上游许可证，并在接入其他项目时更新[开源引用说明](OPEN_SOURCE_ATTRIBUTION.md)。

## 开发流程

1. Fork 本仓库并创建范围明确的分支。
2. 使用 `pnpm install` 安装仓库声明的工具链与依赖。
3. 完成最小完整改动，并为该行为添加直接回归证据。
4. 运行 [AGENTS.md](AGENTS.md) 与 [docs/testing.md](docs/testing.zh.md) 要求的相关检查。产品 profile 变更至少必须同时保留官方构建与 DuraSH 组合。
5. 创建 Pull Request；存在关联 Issue 时请链接，并说明用户可见结果、验证和剩余限制。

不得提交凭据、私有日志、本地数据库、个人数据或机器专属绝对路径。使用合成示例，并在把诊断输出附到 Issue 或 Pull Request 前完成脱敏。

## 许可证

提交贡献即表示你同意按本仓库的 [MIT 许可证](LICENSE)提供该贡献，并确认自己有权提交。必须保留所有适用的第三方版权与许可证声明。
