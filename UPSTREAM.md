# Upstream and update policy

English | [中文](UPSTREAM.zh.md)

## Promise

DuraSH targets the latest **verified compatible** upstream, not blind delivery of every new commit. Detection is automatic; acceptance is gated by the same build, type, test, composition, and product checks used for ordinary changes.

## Primary upstream

The primary upstream is `deepseek-ai/deepseek-harness`, branch `master`. Its verified baseline and inherited source pins live in [`UPSTREAM_SOURCES.json`](UPSTREAM_SOURCES.json).

The scheduled workflow performs this bounded sequence:

1. fetch the primary upstream every six hours;
2. create or refresh the automation-owned `automation/upstream-sync` branch;
3. merge upstream into that branch and update the recorded primary baseline;
4. open one pull request against the repository's default branch;
5. let normal pull-request checks validate the product overlay and upstream behavior;
6. enable auto-merge only when the repository owner has configured required checks and set `DURASH_ENABLE_UPSTREAM_AUTOMERGE=true` as a repository variable.

A merge conflict or failed check is a visible compatibility blocker. The workflow must not resolve it by dropping downstream behavior or force-merging untested code.

## Other open-source projects

- Registry and GitHub Actions dependencies are checked daily by Dependabot with no intentional cooldown.
- Every vendored Cordis-family package, Cosmokit, and Schemastery release is checked against the public npm registry by the same six-hour audit. The inherited snapshot commit remains recorded separately, including historical DSH fork commits that are no longer public.
- Vendored drift opens or refreshes one persistent GitHub issue. Synchronization then follows [`vendor/README.md`](vendor/README.md) because the repository carries explicit local modifications; the bot never overwrites that layer automatically.
- Sources inherited solely through DSH normally move when the primary upstream moves. DuraSH does not silently re-vendor a different incompatible revision.

## Release gate

An update is user-ready only after its synchronization PR passes required CI and the DuraSH build-and-composition check. Until public branch protection is configured, scheduled automation prepares PRs but does not merge them. This is an intentional safety boundary, not permission to leave drift invisible.
