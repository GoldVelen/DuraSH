# Contributing to DuraSH

English | [中文](CONTRIBUTING.zh.md)

DuraSH welcomes bug reports, documentation improvements, plugins, tests, and focused code contributions. The project is a developer preview, so proposals should preserve the distinction between DuraSH-owned reliability features and inherited DeepSeek Harness behavior.

## Before contributing

- Search existing issues and discussions before opening a new one.
- Report vulnerabilities privately through the process in [SECURITY.md](SECURITY.md); do not publish exploit details in an issue.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in every project space.
- Use English or Chinese. Update both files when changing an existing bilingual document.

## Choose the right repository

Changes to the DuraSH brand, product profile, update controls, or reliability capabilities belong here. A generally useful DeepSeek Harness improvement should normally be proposed to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) first. If DuraSH needs a temporary downstream change, document its upstream limitation and removal condition in [INTEGRATION_STATUS.md](INTEGRATION_STATUS.md).

Do not edit vendored dependencies directly. Follow [vendor/README.md](vendor/README.md), preserve upstream licenses, and update [OPEN_SOURCE_ATTRIBUTION.md](OPEN_SOURCE_ATTRIBUTION.md) when integrating another project.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install the declared toolchain and dependencies with `pnpm install`.
3. Make the smallest complete change and add the focused regression evidence that owns the behavior.
4. Run the relevant checks described in [AGENTS.md](AGENTS.md) and [docs/testing.md](docs/testing.md). Product-profile changes must at least preserve both the official build and the DuraSH composition.
5. Open a pull request, link the related issue when one exists, and state the user-visible result, validation, and remaining limits.

Never commit credentials, private logs, local databases, personal data, or machine-specific absolute paths. Use synthetic examples and redact diagnostic output before attaching it to an issue or pull request.

## License

By submitting a contribution, you agree that it is licensed under the repository's [MIT License](LICENSE) and that you have the right to provide it. Retain all applicable third-party copyright and license notices.
