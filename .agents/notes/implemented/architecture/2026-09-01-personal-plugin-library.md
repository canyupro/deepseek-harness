# Agent Note: The personal plugin library with three lifecycle states

Status: implemented

English | [中文](2026-09-01-personal-plugin-library.zh.md)

## Problem

User-defined dynamic Cordis plugins are process-local by design: a restart drops them, and nothing persists their source or authorization, so a plugin the user iterated on is gone the next time `dsh web` boots. The only prior path to permanence was converting a plugin into a repo package, which is heavyweight for a personal tool. There was also no management surface: the plugin list showed the session's dynamic plugins but could not save, enable, disable, freeze, or remove them.

## Decision

**The runner gains a durable personal-plugin library.** `DynamicCordisRunnerService` persists saved plugins to a JSON document under the host home (`$DSH_HOME/plugins/library.json`, configured through a new `libraryHome` config field) and re-mounts them at boot. The durable document is versioned and validated at the file boundary; an absent file reads as an empty library and a corrupt one fails loudly.

**A saved plugin lives in one of three states**, which map directly onto the runner's existing authorization vocabulary:

- **`off` (保存并关闭)** — persisted, not running. The plugin stays in the registry so the list shows it; `applyLibraryState` retracts any active run.
- **`on-editable` (保存并开启，可修改)** — persisted and running with `clientVersionUpdatesApproved = true`, so iterating on new versions needs no fresh approval.
- **`frozen` (固化，不可修改)** — persisted and running with plugin-wide approval cleared, keeping only the current version in `approvedClientPackages`, so updating (a new package) requires a second authorization.

**The session agent manages the library.** Saving re-owns a session plugin to a synthetic `cordis-library` session; a `managedPlugin` helper treats library-owned plugins as manageable by any session agent, so `define` (append a package), `run`, `getClientCode`, `resolveRequestRun`, `stop`, and the render-failure reporters all work on library plugins. New verbs — `saveToLibrary`, `setLibraryState`, `removeFromLibrary` — plus `mountLibrary()` for boot, complete the surface. The client plugin-inventory surface renders the third group with a library-state badge and per-state actions (save and run / save and stop / enable / disable / freeze / unfreeze / remove).

**Boot auto-mount** re-creates every persisted plugin (including `off` ones, so the list always reflects the library), then activates the running states under the persisted authorization — no approval at boot.

## Alternatives considered

**Convert plugins to repo packages for permanence.** Rejected: a personal tool should not require package scaffolding, gates, and release review; the library keeps the lightweight dynamic authoring model and adds persistence behind it.

**Persist grants only, not definitions.** Rejected: a restart would drop the source and the library could not re-mount anything; the whole definition (host and client code, name, purpose, versions) must be durable.

**Re-approve every boot.** Rejected: that contradicts the "auto-run" goal; authorization is recorded per version in the persisted entry and reused at boot, with a fresh approval only for new versions of a frozen plugin.

**Keep the plugin session-owned after saving.** Rejected: the library is the user's personal store, not a session artifact; re-owning to a stable library session makes the inventory and management surface session-independent.

## Verification

- `packages/extensions/cordis-host-runner/tests/library-store.spec.ts` covers the durable document: path derivation, absent-file-to-empty, atomic round-trip, and every malformed-field rejection at the file boundary.
- `packages/extensions/cordis-host-runner/tests/library.spec.ts` covers save/persist/re-own, the three state transitions with their authorization mapping (new versions run without approval in `on-editable` but require it in `frozen`), removal, and boot re-mount of editable, frozen, and off plugins.
- `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx` covers the per-state action buttons and their session/plugin arguments; the host projection test covers `libraryState` pass-through.
- The package-dependency and client-i18n gates run clean on the change.

## Consequences

A user's saved plugins survive restarts and auto-run, and the plugin list becomes a working manager for them — but the library is per-host and the authorization is trusted (a frozen version runs its approved code without re-prompting, so persistence moves the trust decision from every boot to the first activation). `dsh-host-plugin-inventory` gains the optional `libraryState` field on dynamic rows, and the runner's Remote surface grows three verbs; the typert client artifacts regenerate with the build. Editing the code of an `on-editable` plugin (as opposed to appending a new version) remains a follow-up surface.
