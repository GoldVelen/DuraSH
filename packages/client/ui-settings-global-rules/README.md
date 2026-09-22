---
description: "Settings page for the Host-owned global AGENTS.md instruction file."
kind: "package-reference"
---

# @durash/dsh-client-ui-settings-global-rules

English | [中文](README.zh.md)

## Summary

Edit cross-project instructions in Settings → Global rules without opening a file manager. The editor shows the connected Host's existing file and rejects saves based on stale content. A saved file becomes eligible for later requests; the page distinguishes saving from evidence that a request loaded it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

This browser plugin adds **Settings → Global rules** through the existing `settings.section` slot. It reads and writes the connected Host's configured global instruction file through `remote.settings`; the [agent-instructions service](../../context/agent-instructions/README.md) owns path resolution, atomic writes, conflict checks, and request refresh. The browser keeps only the open editor's draft and does not persist a second copy of the rules.

The page shows the file's existing text and actual Host path. A missing file stays absent until the first save. Saving preserves the submitted text and supplies the revision read when editing began. A concurrent external edit refuses the save and preserves the draft; the user can copy their changes and explicitly reload the file. Read and write failures remain visible, and a pending save disables editing until it settles.

A successful write is labeled saved, never applied. The page explains when future requests recheck instructions and points to session instruction injection records for request evidence. Missing instruction loading, disabled loading, and file or context budget limits produce explicit warnings. Project instruction priority remains owned by the instruction plugin.

<a id="model-experience"></a>
## Model Experience

None, as the browser editor delegates all model-visible instruction content and refresh to the Host instruction plugin.

#### KV Cache effect

The editor changes no provider request directly. Subsequent instruction replacement has the cache effects documented by the instruction plugin.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The page reports saved file state and loading limits, not per-request application status. Its draft lasts only while the page is mounted; reloading or closing the page discards unsaved edits. It does not extract automatic memory or continuously monitor external file edits; revision checks prevent stale saves.

**Runtime invariant:** No companion is published. The page owns no independent cross-plugin runtime relationship; the Host instruction service owns file consistency, and slot disposal and editor behavior have direct tests.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
