# Agent Note: User-defined dynamic plugins in the plugin list

Status: implemented

English | [中文](2026-09-01-dynamic-plugin-third-group.zh.md)

## Problem

The Settings → Plugin list projects the non-group Loader entries and, since [the agent-preset scopes change](2026-08-29-plugin-inventory-agent-preset-scopes.md), every roster preset's composition — but a user-defined dynamic Cordis plugin appeared nowhere. Those plugins mount as ad-hoc fibers under the dynamic runner's own group instead of Loader entries, and no preset declares them, so the list read as "everything composed" while silently omitting a whole plane: a user who defined a prompt-enhance or usage-stats plugin in-session could not see it, its versions, its owning session, or whether it was running.

## Decision

**The inventory carries a third, source-free group.** `pluginInventory/list` gains an optional `dynamic` array — one row per user-defined plugin the current host process's runner knows — projected from the runner's inventory through `ctx.get('dynamicCordisRunner')`, the same optional-peer pattern as `agentPresets`. Each row carries the stable plugin id, the newest package's name and purpose, the owning session id, the count of immutable package versions, the current package id when one completed activation, and a phase from the closed vocabulary `running | waiting | in-flight | failed | stopped`. The runner keeps its run ids and internal statuses; the inventory row exposes none of them.

**The phase is derived, not reported.** An active run maps to `running`, or `waiting` when the current attempt itself waits for approval or the browser; the transition statuses (`awaiting-approval`, `starting-host`, `client-pending`) fold into `in-flight`; the terminal failures (`failed`, `rejected`, `cancelled`) map to `failed`; everything else is `stopped`.

**The list renders it as its own collapsible group.** The dynamic group sits after the global plane, open by default, with its own subtitle and count. Each card is titled by the newest package name, carries one phase tag — running (success green), waiting (warning amber), starting (business blue), failed (error red), stopped (neutral) — and, expanded, names the plugin id, the owning session, the version count, the current version when activation completed, and the declared purpose. The module-name row the Loader and preset cards share became optional and is omitted here: a dynamic card's identity line is the plugin id. Search matches the newest package name and the plugin id like the other groups; the category filter deliberately does not apply, because dynamic rows carry no category. The group renders only when the runner reports plugins — a deployment without the runner, or a process with none defined, shows nothing rather than an empty shell.

## Alternatives considered

**Fold dynamic rows into the Loader entry plane.** Rejected: the Loader is the sole lifecycle authority for entries and owns none of these plugins' state — merging them would misreport enablement and phases and would break the inventory's one-lifecycle-truth design.

**Adopt the runner's internal inventory row as the wire contract.** Rejected: that row carries plugin-run ids and internal statuses; the inventory owns the public, source-free vocabulary so a runner change cannot ripple into the trusted-client contract.

**A second client-side Remote call to the runner.** Rejected: the tab takes one snapshot per mount through `pluginInventory.list()`; a second call would split the freshness contract and duplicate the [`api-remotes`](../../../../packages/api/remotes/README.md) path.

**Render dynamic plugins inside the preset group.** Rejected: they carry no preset identity, trust marking, or enablement gates, so a preset-shaped card would read as empty semantics.

## Verification

- `packages/host/plugin-inventory/tests/inventory.spec.ts` covers every phase mapping (active run with a waiting attempt → waiting, active run → running, each transition status → in-flight, each terminal failure → failed, otherwise stopped), the package-less fallback to the plugin id, and `currentPackageId` omission.
- `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx` covers the third group's toggle, count, phase tags, expanded facts, search isolation, and collapse; the invariant companions cover both packages.
- `pnpm run test:gui`, both compiler faces' `tsc -b`, and the client-i18n and package-dependency gates run clean on the change.

## Consequences

The tab now answers "what did I define in this session?" in one place — but the rows are process-local: a host restart clears every user-defined plugin and the group disappears, so the list's completeness is scoped to the running process, not durable history. `dsh-host-plugin-inventory` gains an optional peer dependency on `dsh-cordis-host-runner` (peer + dev, classified by the dependency policy), and the client snapshot type rides the existing api-remotes re-export, so no typert artifact regeneration is needed. The [category chips](2026-08-14-plugin-row-category-metadata.md) still narrow only the global plane; dynamic rows stay outside them, and the phase tag is a run-state summary rather than a deeper diagnostic.
