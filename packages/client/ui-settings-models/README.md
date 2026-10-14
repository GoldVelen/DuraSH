---
description: "Models settings and product-onboarding plugin for the dsh web client: provider rows, API-key management, subscription sign-in, model lists, and the DeepSeek first-run dialogs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-models

English | [中文](README.zh.md)

## Summary

Configure provider API keys, sign in to subscription accounts, follow account model lists, save model customizations, or declare a custom pi-ai route from the Models page. API keys stay write-only. Each provider has an editor card, and shared settings and credential state keeps its row current across reloads. First-run dialogs show the internal-testing notice and request an official DeepSeek key only when no provider is usable.

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

Open the Models page from the Settings navigation to see every configured provider as a row. A whole-section provider whose key is not configured anywhere renders as its open setup card instead, but only in the first-run posture and only until the user closes that card. Each card kind owns its own open state, so closing one never discards a draft in another.

A provider with a stored catalog error remains visible with its diagnostic and edit/delete actions. Add actions are offered only for registered settings namespaces, so an unavailable namespace cannot leave a button that opens no editor. A rejected save leaves the editor open and displays the Host diagnostic.

### API keys

A route with a Host OAuth sign-in flow and no configured API-key reference uses account authentication for model requests and model sync. Its editor mounts no password input until **Use an API key instead** is selected. **Use account sign-in** immediately removes only the user-owned `apiKeyEnv` through a revision-fenced settings mutation, preserving credentials, saved models and endpoints, and other unsaved card edits. A composition-owned reference blocks that switch with an explanation. Without a configured key reference, unknown sign-in capability also keeps the password input unmounted until an explicit API-key choice. API-key editors show one write-only **API key** input and never ask for an environment-variable name. A typed key stores write-only through `credentials.set` under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile has none, and the pi-ai profile records that derivation as `apiKeyEnv`, so `settings.yaml` never carries a key value. Leaving a new pi-ai provider's key blank saves a reference-free profile and preserves provider-native authentication (for example the Bedrock credential chain or Vertex ADC). A row labels API-key state with a green solid dot only when a referenced credential is confirmed configured, and with a red solid dot only when a named reference is confirmed missing. A successful Apply emits a local accessible status message without echoing secret material.

### Editing a provider

The collapsed 自定义设置 fold carries the curated extras: `baseURL` for both families (the deepseek placeholder shows the public endpoint), each adapter's model catalog, and the **display name** and **API protocol** of a pi-ai route the adapter does not ship. Profile `headers` remain deployment configuration in `settings.yaml` or Cordis config and have no Models-page editor. The Provider ID stays fixed: it is the settings key, the name every other namespace and every logged session references, and the stem of a credential reference the page cannot read back to move. Reasoning effort is deliberately not among the editable fields: it is a per-model capability, so a provider-scoped control could only be set to a value some models reject. Each model row edits `id`, optional display `name`, optional `contextWindow`/`maxTokens`, and input types; unrelated model fields survive edits.

The DeepSeek card edits the shared `llm-deepseek` endpoint, credentials, and model catalog without a protocol selector. When Cordis YAML selects Messages, the public endpoint placeholder is `https://api.deepseek.com/anthropic`. Saving the card preserves protocol configuration.

Expand **Customized settings → Model options** to edit each model. Both provider families share the same row layout: context window and max output tokens occupy two columns, and **Input types** offers **Text** and **Image**. An undeclared input list inherits the Host’s current model metadata, then the provider default, then Text. Opening the editor reads that metadata without starting its own endpoint request. Explicit checkbox selections override inheritance and must keep at least one type. DeepSeek writes `inputModalities`; pi-ai writes `input`. Unchecking Image for DeepSeek also removes `imagePixelBudget` and `imageMaxBytes`. Clearing the input field restores inheritance; **Restore defaults** removes saved model customizations. Declare only input types the upstream model supports.

Account-directory providers offer **Follow account model list**. When enabled, new account models join the conversation picker automatically and saved rows customize matching ids. An empty customization list still follows the account directory. Turning it off keeps an explicit saved model list as the selection. Apply saves the mode without discarding row tuning. The adapter owns [directory synchronization and failure handling](../../llm/llm-pi-ai/README.md#synchronize-account-model-directories).

### Adding and deleting providers

The add card selects an available provider or declares a custom pi-ai route with a unique **Provider ID**, HTTP(S) endpoint, protocol, and at least one unique model id. Localhost, IPv4, IPv6, and custom ports remain valid. A syntax error blocks discovery and creation at the field; a request failure remains a provider diagnostic. **Fetch available models** refreshes the displayed source and opens searchable candidates. Refreshing a saved account source also updates its runtime directory without Apply; unsaved endpoint, protocol, or key probes cannot replace it. **Add selected** edits the draft, and Apply or Create saves those entries. Existing rows retain their tuned values when adopted again. Search matches ids and display names without clearing hidden selections; **Select all** selects visible results, while **Deselect all** clears every selection. A failed refresh preserves the draft. A provider is deletable only when its profile belongs to the user layer, and the confirmation names it.

### Account sign-in

The **Account sign-in** area lists every Host flow that offers an OAuth method — ChatGPT Plus/Pro, Grok/X, Claude Pro/Max, and the other subscription logins the pi-ai adapter registers. API-key-only catalog entries stay in the add form. **Sign in** starts the Host-side attempt and the area renders its progress: the page to open, a device code to type, and each attempt's pending question, answered inline or declined; **Cancel sign-in** withdraws. Each flow keeps its own answer and clears it when its prompt changes or finishes. The attempt state lives on the Host, so reloading the page rejoins the running attempt, and a finished attempt stays visible until the next one starts. For a previously unconfigured provider, successful sign-in enables a blank native-auth profile and opens its catalog editor. The Host refreshes account metadata; existing profiles retain their model mode and customizations. The area renders nothing when no OAuth flow is registered, including a composition without the authorization service. The Client binds that namespace through `ctx.inject` so a fixture that never mounts it still loads the page; the uninjected `ctx.remote.authorization` accessor throws even when the namespace is present.

OpenCode Go offers **Sign in with browser** first and **Use an API key instead** when the Host declares both methods. The API-key alternative uses the same write-only secret prompt. Successful authorization enables the `opencode-go` native profile; it does not create an OpenCode Zen route. The row links to [OpenCode Console](https://opencode.ai/console/) and explains that usage beyond the subscription allowance can draw from its balance when **Use balance** is enabled. The page does not change billing settings.

### First-run dialogs

After the versioned notice step completes, the DeepSeek step projects first-run readiness from the same joined snapshot. ANY provider the user can already reach ends it without rendering; only a user with none is asked for the official DeepSeek key. Configure later completes only this coordinator pass, and an absent adapter, inactive route, failed join, read-only deployment, or unusable capability completes the step without rendering — Models remains the diagnostic surface.

### Extension slots

The section declares two seats for plugins distributed outside this repository, typed in [`src/client/slot-contract.ts`](src/client/slot-contract.ts) and exported from `./client`. `settings.models.provider-card` (keyed) renders inside every card that shows a directory row — a saved row's card, its first-run setup posture, and the add-provider draft — dispatched with `entryKey = settingsNs` and owner props carrying the row's `ConfigurableProviderView`, its configured state, and its confirmed api-key credential state, so one registration under an adapter family's namespace receives every card of that family, hand-declared routes included; the hand-declared draft card has no directory row yet and dispatches nothing until saved. `settings.models.footer` (list) renders after the rows and the add controls. A registrant activates through `ctx.slots.inject` with a type-only import of this package's `/client` entry; without registrants both seats render nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page never holds a full settings section: it holds only the REDACTED descriptor, so every edit lands as `settings.mutate` path ops against the stored section — a set per changed field, an unset per cleared one, and a single unset for a deleted provider row.

### Validation

A typed API key is judged on its own field: after trimming, it must be non-empty and every character must be printable ASCII (`[\x21-\x7E]`), which is exactly what an HTTP header value can carry — the twin of `normalizeApiKey` in `@deepseek-ai/dsh-llm`, mirrored here because the source-plane split forbids importing it. A value matching a pasted `NAME=value` environment line or wrapped in matching quotes is refused as the same format failure. Empty ids, duplicate ids, empty explicit names, and unreadable, non-positive, or fractional capacities fail before any write. DeepSeek's `models` is one replace-by-value array: the editor shows inherited effective rows until the first model edit materializes the complete array in the user layer, while reset unsets that override.

### Concurrency and credentials

Each settings write carries the card's current `revision`, so a concurrent write from another tab or an external `settings.yaml` edit is refused as `settings/conflict`. After settings commit, the card adopts the returned redacted user subtree and revision before storing the credential, so a failed credential stage retries only that stage. Deletion removes a configured, writable credential only when the profile names the page's derived `<ROUTE>_API_KEY` target, then unsets the profile; both operations are idempotent. Once loaded, the page subscribes to forwarded `settings/document-updated`, `credentials/reference-updated`, and `llm/adapters-updated` owner events, plus local `connection/reset`, so external edits converge without polling.

### Onboarding coordinator

The notice step owns its exact copy in `src/client/locales.ts` and its acknowledgement version in `src/onboarding-copy.ts`; on loopback it compares and writes `ui-onboarding.welcomeNoticeVersion` through the existing settings API, and only an explicit Continue records the current version. A non-loopback browser cannot use that Host-only namespace, so acknowledgement is process-local and the notice returns after reload. The DeepSeek step targets `deepseek-official` in `llm-deepseek` and renders the existing `ProviderEditor` in credential-only mode inside the shared onboarding modal; `credentials.set` stays the only secret write, and no provider settings are changed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings base, the seams this page joins, and the design rationale.

- [ui-settings](../ui-settings/README.md) — the domain base whose scope and schema services this page builds on.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [credentials](../../credentials/README.md) — the credential-reference seam this page writes keys through.
- [llm](../../llm/README.md) — the adapter registry whose providers this page configures.
- [Web config plane](../../../.agents/notes/archived/architecture/2026-07-30-web-config-plane.md) — the hand-written editor's design rationale.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the editor's field coverage and the page's reach; they are current package constraints, not a settings roadmap.

- **Only the API key and curated fold fields are editable on the card** — the hand-written editor traded schema-generic field coverage for the mockup layout. Retry policy, timeouts, DeepSeek model descriptions, and other advanced fields remain in `settings.yaml`; existing model fields the editor does not show are preserved.
- **Credential cleanup is intentionally narrow** — deleting a row removes the configured, writable credential only when its reference is the exact `<ROUTE>_API_KEY` target this page derives. Custom references, environment credentials, and unidentifiable targets are retained because the row cannot prove ownership of them.
- **Only pi-ai routes can be hand-declared** — the custom-provider card writes into `llm-pi-ai`, the one namespace whose profiles describe a whole provider. A `llm-deepseek` route is a composition fact, not something this page can create.
- **Endpoint discovery has protocol limits** — custom probes support OpenAI-compatible and Anthropic Messages listings; Codex, xAI, and OpenCode Go use their adapter-owned account directories. Other protocols retain installed metadata or require manual model entries.
- **Undeclared live routes render nowhere** — a route registered without a configurable-provider declaration has no settings address; it stays visible in pickers but not on this page's rows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package presents Host-owned settings, credentials, and authorization state; it owns no independent durable relation.
