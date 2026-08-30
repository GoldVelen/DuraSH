# Agent Note: Browser sign-in surface for authorization flows

Status: implemented

English | [中文](2026-08-31-browser-sign-in-surface.zh.md)

## Problem

The authorization capability shipped with its seam complete and its consumers absent. `llm-pi-ai` registered a sign-in flow for every catalog provider that ships a login — ChatGPT Plus/Pro (Codex), Grok/X, Claude Pro/Max, Kimi Code, OpenRouter, and the rest — but no bundle mounted the `authorization` service, and no surface could start an attempt. A user with a subscription account had no path into their own provider: the Models page offered API keys only, and the old pi-agent-era logins belonged to a product line this repository does not ship. The gap was one wire contract and one page section, not a new auth system.

## Decision

The `authorization` service mounts in the base composition beside the credential provider, so the pi-ai flows register everywhere the adapter does. The web Models page gained an **Account sign-in** area backed by a new `authorization` Remote namespace in `@deepseek-ai/dsh-api-settings-controller`.

The wire is poll-shaped because `AuthorizationService.begin()` waits on a human for minutes: `describe()` answers the flow list plus the Host-tracked attempts in one snapshot; `begin` starts an attempt against a controller-held interaction and answers immediately; `respond` answers the one pending prompt (value or decline); `cancel` withdraws. Attempt state lives on the Host, so a second browser tab or a reloaded page rejoins the running attempt instead of forking it, and a finished attempt stays visible until the next begin for that key. The section polls on a 1.5 s cadence while mounted and refreshes once after each action; no new event vocabulary and no new stream ride this change.

After a sign-in commits, the provider joins the page through the ordinary add flow with its key left blank: the reference-free pi-ai profile defers authentication to provider-native discovery, which resolves the stored grant. Sign-in and profile creation stay separate steps because a grant alone registers no route — which adapters exist is composition, which providers run is the user's settings document.

## Alternatives considered

**Stream notices and prompts over a live event channel.** Rejected for this surface: it would add an event vocabulary, a forwarded-event allowlist entry, and prompt-answer plumbing to the RPC carrier for a settings page where a 1.5 s poll is indistinguishable from push. The polling contract also survives transports that only answer requests.

**One sign-in card per OAuth provider inside the add flow.** Rejected because sign-in is meaningful before any route exists (signing in is what makes a route worth adding, per the pi-ai flow registration contract), and the add card is already the densest surface on the page. The flat flow list renders every registered login — including providers the user has not decided to add — from one Host snapshot.

**Reuse the retired pi-agent provider login.** Rejected: that runtime belongs to the other product line and is not part of this repository's shipped composition; the pi-ai adapter already carries the same providers' OAuth flows as registered authorization flows.

## Consequences

A subscription user can now reach their provider end to end: sign in, add the provider with a blank key, pick a model. The known-catalog set is whatever pi-ai ships — a provider this repository's pi-ai version has no login for (Cursor among them) appears only as an API-key provider. Attempt state is bounded by the flow count; notices are capped at 50 per attempt. The `no-polling` cost is one small authenticated request per cadence per open Models page.

## Testing

`authorization-controller.host.spec.ts` pins the namespace registration, the absent-service refusal, flow listing, the malformed/unknown key and method refusals, notice and prompt projection, respond settle and decline, cancel withdrawal, prompt-signal clearing with stale-id refusal, the conflict on a second begin, and the NOT_COMMITTED failure view. `sign-in-store.client.spec.ts` pins the poll lifecycle, last-good snapshot on poll failure, action-refusal surfacing, and wire argument passthrough. The section renders nothing when the Host offers no flows.
