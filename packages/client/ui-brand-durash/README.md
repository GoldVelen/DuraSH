---
description: "DuraSH brand occupants for the sidebar and conversation hero, active only in DuraSH builds; for users and maintainers composing the product identity."
kind: "package-reference"
---

# @durash/dsh-client-ui-brand

English | [中文](README.zh.md)

## Summary

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with the original DuraSH mark and name. It registers only when the client is built with `DSH_CLIENT_BUILD_PROFILE=durash`; all other profiles remain untouched. The mark is a font-free geometric D and forward arrow in DuraSH's midnight, amber, and light palette, while the name remains accessible text. The package retains no runtime state and contributes nothing to model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in the DuraSH browser roster and build the client with the `durash` profile. The three occupants replace the generic shell fallbacks without changing the upstream official-brand package.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` is the build-time identity selector. Only the exact value `durash` installs this package's occupants. An `official`, local, or unset value leaves all three slots empty from this package, allowing the matching distribution to supply its own identity.

### Brand artwork

The SVG mark uses only geometric paths, so it stays independent from installed or remotely hosted fonts. The compact silhouette remains recognizable at the sidebar's 16–24 px sizes. `DuraSHBrandName` renders a normal localized text node instead of turning the name into SVG outlines; each host surface continues to own the surrounding accessible label.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Nested `ctx.slots.inject()` calls wait for all three declarations before registering the occupant set. Removing any declaration withdraws the complete set, and redeclaration restores it without leaving a mixed brand during HMR. The browser half lives in [`src/client/index.ts`](src/client/index.ts); the node half is an inert Loader seat. Browser title, favicon, manifest, and repository wordmark assets remain distribution-level concerns outside this package.

No runtime invariant companion is published because the package retains no mutable state; slot disposal and redeclaration are covered by the browser composition test.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-sidebar](../ui-sidebar/README.md) — declares the sidebar mark and name slots.
- [ui-conversation](../ui-conversation/README.md) — declares the conversation hero mark slot.
- [Web Client Slots](../../../docs/subsystems/slots.md) — defines declaration-aware registration and lifecycle behavior.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits identify the distribution surfaces this package deliberately does not own.

- **Browser assets are separate** — favicon, PWA manifest, repository social artwork, and browser title belong to the DuraSH distribution.
- **One fixed identity** — alternative names, marks, or palettes belong in a separate slot-occupant package rather than runtime configuration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep this package separate from `@deepseek-ai/dsh-client-ui-brand-official`. Upstream synchronization must be able to update or replace the official package without creating a brand merge conflict here.

</details>
