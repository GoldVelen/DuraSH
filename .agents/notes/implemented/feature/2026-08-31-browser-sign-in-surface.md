# Agent Note: Browser sign-in surface for authorization flows

Status: implemented

English | [中文](2026-08-31-browser-sign-in-surface.zh.md)

## Problem

The authorization capability shipped with its seam complete and its consumers absent. `llm-pi-ai` registered a sign-in flow for every catalog provider that ships a login — ChatGPT Plus/Pro (Codex), Grok/X, Claude Pro/Max, Kimi Code, OpenRouter, and the rest — but no bundle mounted the `authorization` service, and no surface could start an attempt. A user with a subscription account had no path into their own provider: the Models page offered API keys only, and the old pi-agent-era logins belonged to a product line this repository does not ship. The gap was one wire contract and one page section, not a new auth system.

## Decision

The `authorization` service mounts in the base composition beside the credential provider, so the pi-ai flows register everywhere the adapter does. The web Models page gained an **Account sign-in** area backed by a new `authorization` Remote namespace in `@deepseek-ai/dsh-api-settings-controller`. The Models plugin does not list `remote.authorization` in its required inject — a fixture that never mounts the namespace would otherwise park the whole page — and binds it with `ctx.inject` onto a forwarding wire that starts empty. The uninjected `ctx.remote.authorization` accessor throws even when the namespace is mounted, because Cordis requires inject to read a declared service.

The wire is poll-shaped because `AuthorizationService.begin()` waits on a human for minutes: `describe()` answers the flow list plus the Host-tracked attempts in one snapshot; `begin` starts an attempt against a controller-held interaction and answers immediately; `respond` answers the one pending prompt (value or decline); `cancel` withdraws. Attempt state lives on the Host, so a second browser tab or a reloaded page rejoins the running attempt instead of forking it, and a finished attempt stays visible until the next begin for that key. When no tracked attempt owns a flow key, `describe()` also projects an existing configured credential as `authorized`, so a process restart does not make a committed sign-in look absent; a tracked current attempt always wins over that stored projection. The section polls on a 1.5 s cadence while mounted and refreshes once after each action; no new event vocabulary and no new stream ride this change.

The request schema is the wire authority. After decoding, the controller brands the validated credential key and consumes the value-or-decline union directly; it does not reparse the same grammar or invent a fallback answer for a request the schema cannot produce.

Failure reporting states only facts the controller can observe: whether the flow had already delivered a notice or prompt, or whether the authorization seam rejected it as `NOT_COMMITTED`. The outer failure message is redacted for bearer and OAuth token fields. A transport wrapper such as `fetch failed` may append at most four allowlisted network metadata groups from its cause or `AggregateError`; arbitrary nested messages never cross to the browser.

After a sign-in commits, the Models page writes the same blank native-auth profile the add card would (`settings.mutate` of `{}` at the flow's directory path) so the catalog route registers and its models join the conversation picker, then opens that provider's catalog editor. A grant alone still does not register a route — the page's write is what names the provider in the user's settings document. A later begin for the same key may run again; an already-configured row is left untouched.

## Alternatives considered

**Stream notices and prompts over a live event channel.** Rejected for this surface: it would add an event vocabulary, a forwarded-event allowlist entry, and prompt-answer plumbing to the RPC carrier for a settings page where a 1.5 s poll is indistinguishable from push. The polling contract also survives transports that only answer requests.

**One sign-in card per OAuth provider inside the add flow.** Rejected because sign-in is meaningful before any route exists (signing in is what makes a route worth adding, per the pi-ai flow registration contract), and the add card is already the densest surface on the page. The flat list renders each Host flow that offers an OAuth method, including providers the user has not decided to add; API-key-only catalog logins stay in the add form.

**Reuse the retired pi-agent provider login.** Rejected: that runtime belongs to the other product line and is not part of this repository's shipped composition; the pi-ai adapter already carries the same providers' OAuth flows as registered authorization flows.

## Consequences

The browser and Host now contain the supported path from a registered sign-in flow to a stored credential, a configured route, and the model picker. This change has not been accepted against a real xAI or other OAuth issuer: success in the issuer's browser page alone does not prove that the Host completed its token exchange and committed the credential. The known-catalog set is whatever pi-ai ships — a provider this repository's pi-ai version has no login for (Cursor among them) appears only as an API-key provider. Attempt state is bounded by the flow count; notices are capped at 50 per attempt. Polling costs one small authenticated request per cadence per open Models page.

## Testing

`authorization-controller.host.spec.ts` pins the namespace registration, the absent-service refusal, flow listing, the malformed/unknown key and method refusals, notice and prompt projection, respond settle and decline, cancel withdrawal, prompt-signal clearing with stale-id refusal, the conflict on a second begin, stored-credential projection, the `NOT_COMMITTED` stage, redaction, allowlisted network metadata, and its output bound. `sign-in-store.client.spec.ts` pins the poll lifecycle, last-good snapshot on poll failure, action-refusal surfacing, and wire argument passthrough. `sign-in-bind.client.spec.ts` pins the empty wire before `remote.authorization` exists, forwarding after provide, and the empty wire again after dispose. `sign-in-section.client.spec.tsx` pins OAuth-only rendering and hides in-progress notices once the attempt is authorized. `enableNativeProviderProfile` pins the blank `{}` profile write. The section renders nothing when the Host offers no OAuth flow. The per-file V8 lane excludes only the pure `ModelsSection.tsx` and `SignInSection.tsx` components until browser-grade coverage can attribute their mounted React and portal branches; `sign-in-bind.ts`, `sign-in-store.ts`, and the Host authorization controller remain under the 100% gate, while the jsdom component specs and Models browser checks own the excluded presentation behavior. No test in this change runs a real issuer login or an authenticated provider request; those remain runtime acceptance.
