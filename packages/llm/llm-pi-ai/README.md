---
description: "Multi-provider model requests, account model-directory synchronization, OAuth sign-in, and hand-declared gateways through pi-ai."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-pi-ai

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-pi-ai` routes model requests to multiple providers, OpenAI-compatible gateways, or self-hosted servers. Installed pi-ai metadata supplies initial defaults; ChatGPT/Codex, OpenCode Go, and xAI account directories refresh model metadata automatically. Configured model lists can restrict selection or customize matching account models while new ids appear. Profiles and credentials resolve per request, so configuration changes take effect without restarting. Supported sign-in flows store OAuth or interactive-key credentials with cross-process refresh locking.

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

Mount this plugin when a composition routes model requests through pi-ai's provider catalogs or through gateways that its installed catalog does not describe. Each `providers` key is the route a request selects with `GenerateOptions.provider`; root-level timing fields control native directory synchronization.

### When to choose it

Choose this adapter when the same composition serves several providers, when a route needs pi-ai's catalog defaults with a few fields corrected, or when a hand-declared gateway must be reached through its own endpoint and protocol. Choose `dsh-llm-deepseek` for the direct DeepSeek route when the deployment needs no other provider. Both adapters can be mounted together because their route names do not collide; registering a route another adapter already owns fails plugin loading.

### Configure provider routes

Each profile may set a `retryPolicy`; omission uses normal mode with five retries. `apiKeyEnv` is a credential reference resolved per request through the harness credential seam, so no secret enters the configuration file; a reference that resolves to nothing fails the request with `MISSING_CREDENTIAL`. Omitting it leaves the route configured-but-keyless, which for an installed catalog route defers to pi-ai's provider-native ambient discovery.

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openai:
        apiKeyEnv: OPENAI_API_KEY
        baseURL: https://proxy.example.com:8443
        reasoning: high
        requestImagePixelBudget: 4194304 # total pixels; 2048 by 2048 default
        requestImageMaxBytes: 1048576    # raw bytes before base64 expansion
        maxRequestImageBytes: 20971520   # accumulated base64 payload
        retryPolicy:
          mode: normal
          maxRetries: 3
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
        models:
          - id: claude-sonnet-4-5
            contextWindow: 200000
      acme-gateway:
        displayName: Acme Gateway
        apiKeyEnv: ACME_GATEWAY_API_KEY
        api: openai-completions
        baseURL: https://gateway.acme.example/v1
        compat:
          thinkingFormat: deepseek
        models:
          - id: acme-think
            name: Acme Think
            contextWindow: 262144
            reasoningEfforts:
              off:
              high: high
```

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | absent | Credential reference resolved per request; omission defers to pi-ai ambient discovery |
| `displayName` | provider name | Label shown by selector surfaces |
| `catalogProvider` | provider name | Installed provider whose catalog, protocol, endpoint, and auth supply defaults without changing the route key |
| `api` | per-model catalog protocol | Overrides every model’s wire protocol; required for hand-declared routes |
| `baseURL` | per-model catalog endpoint | Overrides every model’s endpoint |
| `models` | effective catalog | Selects model ids, or customizes matching ids when `modelCatalogMode` is live |
| `modelCatalogMode` | absent | `live` follows catalog ids; `configured` or omission preserves an explicit model list |
| `codexDirectoryClientVersion` | `0.162.1` | Codex directory compatibility version; controls account model visibility independently of the SDK or local CLI |
| `modelOverrides` | none | Customizes individual effective-catalog models when no `models` list is set |
| `compat` | catalog detection | Wire-compatibility switches for unrecognized endpoints |
| `defaultContextWindow` | `262,144` | Capacity fallback for undescribed models |
| `defaultMaxTokens` | `32,768` | Output-cap fallback for undescribed models |
| `requestImagePixelBudget` | `4,194,304` | Total-pixel budget for each deterministic request image |
| `requestImageMaxBytes` | `1 MiB` | Encoded-byte target for each request image before base64 expansion |
| `maxRequestImageBytes` | `20 MiB` | Aggregate base64 image-payload bound; a request whose retained images exceed it fails with `IMAGE_OFFLOAD_REQUIRED` |
| `retryPolicy` | normal, 5 retries | Provider-owned retry policy executed by `dsh-llm-retry` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-pi-ai) is the exhaustive source for every accepted field and its JSDoc.

### Sign in to a provider

A provider pi-ai ships a login for can be signed into through the harness authorization seam: the flow offers OAuth or an interactive key prompt (a key is typed into pi-ai's own login prompt, not into the settings form), and the resulting credential is stored in the harness credential store at `llm-pi-ai/<provider id>`. The stored sign-in authenticates its route beneath any `apiKeyEnv` override and refreshes itself under the store's cross-process lock; signing out deletes the stored record. A hand-declared route key outside the record grammar — a lowercase hyphenated identifier — cannot be signed into, because a record write for it refuses with `LlmError('UNSTORABLE_PROVIDER_ID')`; such a route authenticates through `apiKeyEnv` or ambient provider settings instead.

OpenCode Go offers [Console browser login](https://opencode.ai/v2/docs/console/api/#device-flow) and its native API-key method. The device flow identifies this client as `durash`, binds the workspace selected in the browser, and uses the server's polling interval and expiration. Access-token lifetimes become persisted expiration timestamps without the device-flow timer limit. Rotated tokens remain in `llm-pi-ai/opencode-go`; pi-ai refreshes them under the credential store's lock before deriving bearer headers. Request cancellation returns to that caller while an active refresh completes and stores its replacement; the provider profile's `oauthRefreshTimeoutMs` bounds that exchange (default and maximum 15,000 ms). To serve the stored login, enable the `opencode-go` provider profile without an `apiKeyEnv` override.

Go reads its workspace model inventory from authenticated Console configuration: accepted wire ids, protocols, per-model endpoints, and limits come from that account directory. The Go directory serves Chat Completions, Responses, Anthropic Messages, and Google Generative AI. Gemini uses the installed SDK at the Console's full `/inference/go/google/v1beta` endpoint; Go bearer authentication and the SDK's additional `x-goog-api-key` header go only to that endpoint. Public `models.dev` metadata fills capabilities and reasoning settings; installed same-protocol metadata supplies remaining known compatibility. The directory accepts only the Go provider and validates advertised inference endpoints within OpenCode's HTTPS Go subtree. All OpenCode requests retain the Harness User-Agent and send `x-opencode-session` from their durable conversation id; requests without an id do not fabricate one. The client never switches to a pay-as-you-go endpoint after refusal. OpenCode's [Use balance setting](https://opencode.ai/v2/docs/console/go/#usage-beyond-limits) can nevertheless charge the Console balance when Go allowances run out; this adapter does not change that account setting.

### Resolve the model catalog

A profile's catalog source is its route key unless `catalogProvider` explicitly names another installed provider. The latter is useful when a private gateway serves an official provider's models under a deployment-specific route name: the route keeps its own endpoint, credential, and selection identity while inheriting model capabilities such as context, modalities, and reasoning efforts. DSH does not infer this source from model ids because different gateways may implement the same id differently; an empty or unavailable source is refused.

Without `modelCatalogMode: live`, a non-empty `models` list replaces the effective catalog’s ids. Each entry inherits unset fields from the current model of the same id, so an explicit subset keeps its selection while updated metadata supplies its protocol, endpoint, modalities, and capabilities. `modelCatalogMode: configured` makes that selection explicit; omission preserves the same behavior.

With `modelCatalogMode: live`, the effective account directory supplies all ids, including new releases. Saved `models` rows customize matching ids without restricting the list. A saved row whose id leaves the directory stays editable with a diagnostic but is not served and does not block other models. `modelOverrides` customizes catalog entries only when no `models` list is present; unknown override ids remain invalid.

### Run with reasoning and wire compatibility

`reasoningEfforts` declares selectable thinking levels: each key is a level selectors offer, and its value is the spelling sent on the wire. Omitting it keeps the effective catalog’s capability; `false` declares a non-reasoning model. A reasoning model whose directory exposes no selectable levels remains available with the provider’s default reasoning behavior. `compat` adjusts supported request fields per route or model. Models with no declared or catalog capacity use `defaultContextWindow` and `defaultMaxTokens`. Catalog output capacity does not become a request cap; only an explicitly configured model `maxTokens` does.

For self-hosted Chat Completions endpoints, `thinkingTokenBudgetField` selects the reasoning-budget parameter, and `vllmPriority` sets an integer scheduler priority when the server enables priority scheduling. Template arguments accept `$var: thinking.budget`. `openai-responses` gateways can set `supportsMaxOutputTokens: false` to omit `max_output_tokens`; Azure and Codex transports ignore this shared compatibility field. These controls are opt-in; catalog-owned Anthropic effort and fallback capabilities are not configurable switches.

### Change configuration at runtime

Profiles are re-read once per operation through the optional settings seam: the base and the user's `llm-pi-ai:` settings section merge per provider, so a user can add a route, override one field of a composition route, or point a route at another proxy, all effective on the next request with no restart. A section the adapter could not serve is refused where it is written — `settings.mutate` answers `settings-rejected` — and a stored section that later fails keeps the namespace's last good value. When the route set or a route's retry policy changes, the plugin re-registers atomically: a conflicting route leaves the previous routes serving.

<a id="synchronize-account-model-directories"></a>
### Synchronize account model directories

Configured ChatGPT/Codex, OpenCode Go, and xAI routes synchronize at Host startup, after sign-in or a credential-source change, periodically, and on explicit refresh. When the credentials service finishes its initial load, is replaced, or is removed, the Host immediately invalidates the previous credential source's directory and starts synchronization. These routes must retain their native API; a private endpoint opts into synchronization with `modelCatalogMode: live`. The installed catalog supplies the initial metadata until an account directory succeeds.

The Host retains complete model descriptors in RAM, scoped to the route and current account or endpoint. Model lists, resolution, and dispatch use that same metadata. A failed refresh keeps the last good directory for the same source and reports its diagnostic. An account or source change clears the old directory until the new source succeeds; it cannot expose another account’s models. Restarting the Host begins again from installed metadata.

These fields belong at the plugin configuration root, beside `providers`; both accept positive finite milliseconds up to `2,147,483,647`.

| Field | Default | Meaning |
|---|---|---|
| `modelCatalogRefreshMs` | `60,000` | Interval between native directory refreshes |
| `modelCatalogTimeoutMs` | `15,000` | Deadline for a shared native directory request |

### Discover models from endpoints

Passive discovery reads the Host’s current account metadata when available, otherwise the installed catalog, without starting its own network request. An explicit refresh of a stored native source also updates the runtime directory without writing settings. An unsaved endpoint, protocol, or key probe returns editor candidates and cannot replace that directory. xAI joins authenticated `GET /models` and `GET /language-models` by id; the language directory selects chat models while both replies supply capabilities. A draft key or configured credential reference takes precedence over subscription auth. Refresh failures are reported rather than disguised as a successful older list.

Codex uses the current subscription grant and account id at `GET {baseURL}/codex/models?client_version=0.162.1` by default; a base already ending in `/codex` is used directly. The profile’s `codexDirectoryClientVersion` selects the supported directory compatibility version independently of the SDK or a locally installed Codex CLI. The server gates model visibility and metadata by this version, so an older pinned value can return an older list with the same account. Changing the field at runtime refreshes the directory without an SDK upgrade. Only `visibility: list` entries are offered, including models unavailable through the public API. Their ids, names, context windows, input types, and supported reasoning levels enter the native runtime metadata, including ids absent from the installed SDK. Missing output limits remain unspecified in editor candidates. Refreshing does not rewrite saved model customizations.

Other installed providers retain local discovery; hand-declared routes query their endpoints. `openai-completions` and `openai-responses` use bearer-authenticated `GET {baseURL}/models`; `anthropic-messages` uses `GET /v1/models?limit=1000` with `x-api-key` and `anthropic-version`. Anthropic listing normalizes a trailing `/v1`, while model requests retain the configured `baseURL`. Stored credentials and deployment headers stay on the Host; a one-shot draft key takes precedence. The parser accepts a standard `data` array or an enriched `models` map, preserving map keys as request ids and normalizing names, capacities, and modalities. These draft results remain candidates until the editor adopts and saves them.

### Failures and recovery

A route pi-ai does not ship needs `api`, `baseURL`, and a non-empty `models` list; an explicit `catalogProvider` must name an installed provider. An unserviceable profile is refused where it is written, naming the route and model. Failures carry stable codes: a credential that cannot be used fails with `INVALID_CREDENTIAL` naming the route and reference, a route whose `apiKeyEnv` reference resolves to nothing fails with `MISSING_CREDENTIAL`, an unconfigured model fails with `UNKNOWN_MODEL`, and terminal provider failures distinguish `QUOTA` from transient `RATE_LIMIT`. `GenerateOptions.stop` is rejected with `UNSUPPORTED_OPTION` because pi-ai's common streaming UI cannot guarantee it across providers.

Settings writes strictly validate each new or changed provider after merging its composition and user layers. During namespace registration, stored catalog failures retain the namespace and provider rows, with the first available model diagnostic or route failure in `LlmConfigurableProvider.error`; unchanged failed providers do not block edits elsewhere. Serviceable models remain selectable, while unresolved models remain in the editable configuration and fail with `INVALID_CONFIG` before network I/O if requested directly. Repairing or deleting invalid configuration clears its diagnostic; a missing live id also recovers when the account directory offers it again. Schema and self-contained profile errors still reject loading. Later external edits validate changed providers and retain the last accepted section on failure.

Invalid selected-model configuration still rejects a save that changes only `displayName`, `apiKeyEnv`, or `baseURL`. For example, an OpenRouter model `111` with no resolvable `api` must be repaired or removed in the same draft. A live customization whose id is absent from the account directory remains a diagnostic without blocking its other models. Intermediate repairs stay in the draft until the selected models validate; other providers can be saved independently.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the adapter; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

Each operation captures an immutable profile and model snapshot before its first `await`. A configuration change or successful native directory publication creates a new collection for subsequent operations, so an in-flight request retains the model descriptors it started with. Profile credentials resolve per request; stored OAuth records and ambient authentication remain shared across catalog revisions. The Host owns the current native descriptors, while the refresh coordinator owns concurrent requests, deadlines, source invalidation, and awaited shutdown. Runtime imports use narrow pi-ai provider, API, and utility entry points; `src/models.ts` supplies the model helpers without evaluating the aggregate entry point.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: profile resolution, settings wiring, directory and route registration |
| [`src/auth.ts`](src/auth.ts) | The credential store and ambient auth context over the harness credential plane |
| [`src/login.ts`](src/login.ts) | Authorization flows for the installed providers that ship a login |
| [`src/config.ts`](src/config.ts) | Profile schema, resolution, and serviceability checks |
| [`src/catalog.ts`](src/catalog.ts) | Runtime or installed model defaults, selection modes, and compatibility checks |
| [`src/models.ts`](src/models.ts) | Model collections, static providers, and reasoning levels over narrow pi-ai entry points |
| [`src/provider.ts`](src/provider.ts) | The supported-protocol table and provider construction |
| [`src/context.ts`](src/context.ts) | Harness-to-pi-ai context conversion, image handling, replay restore |
| [`src/stream.ts`](src/stream.ts) | pi-ai event conversion into harness `StreamChunk` values |
| [`src/replay.ts`](src/replay.ts) | Versioned `ReplayEnvelope` storage and validation |
| [`src/discovery.ts`](src/discovery.ts) | Native directory reads and editor metadata discovery |
| [`src/opencode-go-catalog.ts`](src/opencode-go-catalog.ts) | Console Go routing joined with public model capabilities |
| [`src/live-catalog-sync.ts`](src/live-catalog-sync.ts) | Coalesced refresh, source epochs, deadlines, and awaited teardown |

### Registration and directory

The plugin declares every installed catalog provider it can authenticate in the configurable-provider directory, joined with every route the current profiles declare, so configuration surfaces can offer the full catalog before any route exists. Each entry carries `declared` — whether pi-ai ships nothing under that key — because only the adapter can distinguish a hand-declared route from a narrowed catalog route. Route registration is atomic: a candidate set that collides with another adapter leaves the previous routes serving. A bare mount with zero routes is the dormant posture: nothing registers until a settings section supplies profiles, and routes drop when it empties.

### Replay and vocabulary

Successful assistant responses store a versioned, lossless-JSON replay state beside the provider and model that produced them — response-level facts plus one per-block entry per streamed block. At request time, `LlmRuntime` passes replay state only when the same adapter instance owns both routes; the adapter validates it and restores native response ids, provider signatures, and optional `providerThinkingLevel` effort metadata, keeping absent effort metadata absent. Replay validates the requested model identity against the assistant source and separately restores an Anthropic response model when the provider resolved an alias or fallback. An unusable state degrades to provider-neutral content instead of failing the request. pi-ai tool-call arguments are parsed objects, so the adapter parses input and re-stringifies output to the harness raw-JSON convention; pi-ai in-stream error events map to terminal `finish` chunks.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the service contract to the twin adapter and the shared types.

- [dsh-llm service](../llm/README.md) — the provider-neutral service this adapter registers on.
- [llm-deepseek adapter](../llm-deepseek/README.md) — the direct DeepSeek twin for the `deepseek-official` route.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the `StreamChunk` protocol and adapter contract.
- [llm-retry](../llm-retry/README.md) — the retry executor that applies each profile's `retryPolicy`.
- [Twin LLM adapters](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md) — why the DeepSeek route ships two structurally different adapters.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-pi-ai) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Provider request through pi-ai

#### What the model sees

The selected catalog model receives one system prompt (`GenerateOptions.system`, otherwise the text of a leading `system` history message; a leading system message with empty text sends none), the remaining history, tools, and sampling fields supported by pi-ai's common streaming API. Each retained image is preceded by text naming its complete attachment id and actual request dimensions. When the current execution filesystem maps the attachment provider's host object, the text also carries a read-only normalized-object path and warns that normalization or request projection may have resized or re-encoded the upload. Each occurrence selected by a logged image-offload decision keeps its own identity and currently resolved access in replacement text, and its normalized attachment is not read or transformed. When the retained occurrences' exact base64 payload still exceeds the route's `maxRequestImageBytes`, the call fails with `IMAGE_OFFLOAD_REQUIRED` so `dsh-compaction-image-offload` records the selected occurrences in an `image/offload` event and retries the step. Provider-native replay metadata is restored only when the adapter validates it for the historical content.

#### Token effect

Provider tokenization governs exact input. Retained images add the stable attachment and coordinate descriptor; the offload placeholder replaces an omitted image's visual tokens. Replay metadata may let a native API reuse provider-side state.

#### KV Cache effect

Conversion preserves logical request order, while image handles and offload placeholders add model-visible text. A changed execution-world path rewrites a historical handle and can prevent reuse from that image even when attachment identity and request bytes stay stable. Changing adapter instance, provider, model, or another upstream token has the same suffix effect. An offload decision turns an earlier image into placeholder text, so reuse ends at that message; the omission never reverts, so the prefix stays stable afterwards.

### Provider response

#### What the model sees

pi-ai events become harness reasoning, text, tool-call, usage, and finish chunks. The adapter passes parsed tool arguments to the harness as raw JSON strings.

#### Token effect

Generated content affects later inputs only after the loop records it. pi-ai folds reasoning tokens into output usage when the provider does not report them separately, and preserves its exact `totalTokens` value unchanged.

#### KV Cache effect

Recorded response content appends to the next request and does not invalidate its earlier reusable prefix. Unrecorded transport metadata and usage accounting do not affect cache identity.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the adapter stops and future work begins. They are current package constraints, not a general pi-ai comparison or a task backlog.

- **`maxRequestImageBytes` counts base64 image payload only** — text, tools, descriptors, and JSON structure ride outside the bound, so it must sit below the gateway's request-body cap with headroom.
- **A sign-in lives only in the process that started it** — an authorization attempt is not durable, so restarting the Host mid-login abandons it and the human starts over. Signing out is `deleteRecord` on the stored record, which forgets it locally without telling the issuer.
- **Provider-native discovery answers through this plugin's ambient context** — a route naming no credential defers to the catalog provider's own resolution, which asks for environment values (`AZURE_OPENAI_API_KEY`, `AWS_PROFILE`, and each provider's own set) and for local credential files. Both questions are answered here: the credential seam is consulted before the process environment, and file existence is checked against the host process's filesystem with `~` expanded. What it cannot do is *read* a credential file's contents — a provider that parses `~/.aws/credentials` itself does so directly, outside the seam.
- **Settings can add or override routes, not remove composition routes** — the user layer merges over the composition base, so deleting a `cordis.yml`-provided provider is a composition change.
- **The layered merge has no delete for dict keys** — a `reasoningEfforts` level, `modelOverrides` entry, or `compat` field the base declares can be overridden but not removed by the user layer.
- **`headers` can carry a credential the redactor never sees** — profile resolution rejects names and values Fetch cannot represent, but the dict remains plain strings; store credentials as `apiKeyEnv` references.
- **Native directories are process-local** — a restart loses the last successful account metadata and begins with the installed catalog until synchronization succeeds.
- **Anthropic discovery reads at most 1,000 models** — the request uses the API's maximum page size but does not traverse `has_more`; entries beyond the first page must be added by hand.
- **A configured `api` overrides every model** — hand-declared routes use one protocol, while native catalog routes can retain mixed per-model protocols and endpoints.
- **A modality declaration is not verified** — a model declaring `image` its gateway does not serve is refused by the provider after prompt admission. The durable image remains in history and the same misdeclared model can fail again; switching to a text-only model remains possible because the shared LLM runtime projects image references into stable text for that request.
- **An unauthenticated route depends on its protocol** — a route naming no credential resolves as configured-but-keyless, but pi-ai's OpenAI-compatible implementation still requires an API key or an `Authorization` header, so a keyless local server needs a placeholder credential referenced by `apiKeyEnv` or an `Authorization` entry in `headers`.
- **`GenerateOptions.stop` is unsupported** — pi-ai's common stream options cannot guarantee stop-sequence behavior across providers.
- **Only a leading in-history `system` message becomes pi-ai's `systemPrompt`** — pi-ai has one system slot, so a later `system` message, or a leading one when `GenerateOptions.system` is also set, folds into a `user` message at its position; provider-specific placement of the prompt follows pi-ai rather than a harness-owned wire override. Images in system or assistant history, including the leading system message, fail with `UNSUPPORTED_CONTENT` on both conversion paths.
- **Provider HTTP status is unavailable** — pi-ai error events do not expose a stable HTTP status across providers.
- **Retry policy is provider-owned, not an SDK retry** — pi-ai SDK retries stay disabled so durable agent steps and `llm/retry` events own every visible attempt, and direct `ctx.llm.stream()` calls remain single-attempt.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- The offered protocol set is deliberately narrower than pi-ai's full API set: Bedrock, Vertex, Azure, and Codex authenticate through flows a profile cannot completely describe with a key, an endpoint, and headers; catalog routes still reach them through their own provider, and only an explicit override is refused. Codex is sign-in-able through the authorization flow's OAuth grant.
- The `compat` switch set is pinned to pi-ai's compat types by drift gates; an upstream upgrade that adds a field, gives a further protocol a compat type, or widens a value union fails the build until someone classifies it.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
