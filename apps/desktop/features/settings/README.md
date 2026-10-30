# Settings and named connections

Repository-owned model settings, saved connections, current/default connection selector,
connection-failure cards and local usage guide. The `preferences` feature contributes its entry
through the settings-section registry; this module never imports another feature directly.

## Status

Originally extracted without behavior changes in delivery two. Delivery three adds candidate
named-connection management and structured failure projection. Implementation and synthetic
tests are separate from installed/native/live acceptance; the delivery record owns those results.

## Structure

- `contract.ts`: owned commands, renderer-callable actions, DTO fields and validated IPC declarations.
- `state.ts`: browser-safe initial projection and exact state validation.
- `validation.ts`: trusted host command validation.
- `host.ts`: configuration/connection changes and `run.finished` failure projection.
- `renderer/Connections.tsx`: named list, header selector and separate search-connection choice.
- `renderer/index.tsx`: connection notices, local UI state and declarative contributions.
- `main.ts`, when present: native channel implementations with the shared sender/lifecycle guard.

## Limits

At most 16 connections with bounded display names and fixed DeepSeek/Kimi regional presets.
DeepSeek uses low reasoning; Kimi supports the existing explicit low/high choice. Request/time
limits, output limit and zero retries are unchanged. Add without a key is allowed and visibly
unconfigured; an active connection cannot be deleted. CRUD, selection and save do not probe a
provider. Search selects an existing DeepSeek connection independently of the conversation model.

Trusted `host/settings.ts` owns private format 2 JSON and native Keychain references. The renderer
receives connection metadata and readiness, never stored keys or credential references. A newly
typed key is transient password-field state and uses the dedicated validated bridge. Legacy
format 1 settings are read compatibly and backed up before the first format 2 save. The CLI's
executable host remains independent. Shared lifecycle handling admits changes only while idle,
reopens the same store/session and clears report/write/check/web grants.

## Model and user experience

Switching appends a recorded `connection_switched` notice with display names and provider/model
identities. It starts no model request; the user sends the next message separately. Providers
project cross-provider history without foreign reasoning while preserving text and tool pairing.
Original records remain intact. The notice has ordinary history/token cost; switching does not
promise cache reuse across providers or change the model budget.

Connection cards consume optional structured `modelErrorKind`, never provider error text.
`quota`, `rate_limited` and `auth` show distinct Chinese states with the affected connection name
and an action that opens settings. There is no automatic retry, fallback or balance inference.
Local not-ready state still permits history inspection. Tool approvals and filesystem authority
remain core guarantees. See [ADR 0048](../../../../docs/decisions/0048-connection-continuation.md)
and [desktop use](../../../../docs/desktop.md#named-connections-and-continuation-delivery-three-candidate).
