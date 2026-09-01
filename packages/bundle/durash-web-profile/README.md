---
description: "DuraSH's additive product layer over the current DeepSeek Harness Web profile; for maintainers composing the branded distribution without forking upstream UI packages."
kind: "package-bundle"
---

# @durash/dsh-web-profile

English | [中文](README.zh.md)

## Summary

This package is the DuraSH product overlay applied after the current upstream `dsh-base` and `dsh-web-app` bundles. It adds the product-owned browser-brand plugin, the reliability-loop runtime, the per-session workflow policy, the gated handoff tool, and the composer workflow switch, and re-enables the upstream workflow-engine row (the web app ships it disabled) so the loop can drive its stage runs. The upstream official-brand package and the disabled `workflow`/`ralph` tools are unchanged. That separation keeps upstream merges small and makes every downstream-owned row visible in one patch layer.

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

Build the client with `pnpm run build:durash`, then start the source checkout with `pnpm dsh --profile durash`. The shipped profile applies `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and this package in that order.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`cordis.patch.yml` inserts the DuraSH brand row, the reliability-loop runtime, the per-session policy, the gated handoff tool, and the composer workflow switch. The product layer remains additive: replacing an upstream row is permitted only when no compatible extension point exists, and the exact exception must first be recorded in the repository's integration-status document.

No runtime invariant companion is published because this package carries only a static patch list; each inserted package owns the mutable relationships it activates.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [DuraSH browser brand](../../client/ui-brand-durash/README.md) — the product-owned slot occupants this bundle inserts.
- [DuraSH reliability loop](../../reliability/durash-reliability-loop/README.md) — the host-side reliability runtime this bundle composes into the `durash` profile.
- [Composer workflow switch](../../client/ui-reliability/README.md) — the on/off chip this bundle inserts into the composer.
- [Profile composition](../../boot/app-boot/README.md#profiles) — the ordered bundle and patch semantics used at startup.
- [Integration status](../../../INTEGRATION_STATUS.md) — the implemented, inherited, and not-migrated product boundaries.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the reliability handoff tool and composer switch this overlay mounts; those packages own the model-visible guidance and schema.

#### KV Cache effect

Enabling the composer switch adds the handoff guidance section to the request prefix; this overlay itself adds no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Thinking effort is stored, not applied** — the switch records lane effort; the current workflow engine does not pass `effort` to stage children.
- **Source distribution only** — the DuraSH npm executable and publication family are not yet designed or advertised.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep downstream rows in this package whenever an upstream extension point supports them. A core-package edit requires an explicit exception in `INTEGRATION_STATUS.md` with its missing extension point, regression, and exit condition.

</details>
