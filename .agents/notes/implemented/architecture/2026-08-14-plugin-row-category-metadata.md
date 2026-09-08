# Agent Note: Plugin row category metadata and the categorized plugin list

Status: implemented

English | [中文](2026-08-14-plugin-row-category-metadata.zh.md)

## Problem

The Web plugin list showed every Loader entry in one flat, searchable catalog. With a hundred-plus rows spanning boot infrastructure, capability seams, browser UI, and auxiliary services, the list gave no way to narrow by what a plugin is for, and the classification had no declared home — any bucketing logic would have to guess from module-name prefixes on the client.

## Decision

Every Loader row may declare a static `category` metadata field in its `cordis.yml` row; the plugin list classifies entries into four product buckets — 最小系统 (`core`), 扩展系统 (`extension`), UI界面 (`ui`), and 其他插件 (`other`) — and filters by them through single-select chips above the catalog.

- `EntryOptions.category` (`string | null`, optional) is inert Loader metadata, like `name`: entry updates, patch application (`applyEntryPatches` copies untouched keys), and `dsh --dump-config` carry it verbatim, and nothing in the Loader reads it. The vendored change is logged as vendor/README.md entry 19.
- `PluginInventoryEntry.category` is the closed union `core | extension | ui | other` (`PluginCategory`). The inventory gateway projects the raw row value; absent, `null`, or unrecognized values project as `other` — the fallback bucket is the field's contract, not a skipped error.
- Shipped compositions declare the value on every non-group row: `core` is the boot/session/model/agent spine plus guardrails and storage; `extension` is capability seams (shell, fs, web, skill, subagent, workflow, compaction) and the standard agent-experience plugins (todo, plan, goal, commands); `ui` is browser plugins (`dsh-client-ui-*` and other UI-only client packages) with browser transport (`connection`, `client-runtime`, `locale`, `modules`) counted as core; `other` holds auxiliary rows (telemetry, message feedback). Patch rows that target a base row do not restate the field — patches preserve it.
- `scripts/verify-cordis-config.ts` adds `category` to the static metadata fields (no `!!js`) and rejects values outside the four-bucket set, so a misspelled shipped value fails the gate instead of silently degrading to `other`.
- The UI adds a single-select chip row (全部 plus the four buckets) that composes with the search query, and a category tag on every card. The selection is view-local: it resets to 全部 on remount, with no settings persistence. The tab structure this extends is the [archived `settings.plugins.tab` ledger](../../archived/architecture/2026-08-11-plugin-settings-tabs.md).

## Alternatives considered

**Client-side name-prefix heuristics.** Rejected: a `dsh-client-ui-*` rule misclassifies third-party and renamed plugins, and the classification would drift from the composition that owns it.

**Curated module-name map inside the inventory service.** Rejected: a second authoritative list of what runs would need its own sync whenever rows move or rename; per-row metadata keeps the fact beside the row that declares it.

**Validation inside the Loader.** Rejected: the vendored Loader stays category-agnostic (`string | null`); the harness owns the closed enum and validates shipped values at the static gate.

## Verification

- `packages/host/plugin-inventory/tests/inventory.spec.ts` covers known-value projection and the unknown-to-`other` fallback.
- `scripts/verify-cordis-config.spec.ts` covers the enum rejection and the `category: !!js` rejection.
- `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx` covers chip filtering, chip-and-query composition, card tags, and expanded-card reset.
- `apps/web/tests/settings-chrome.e2e.ts` golden captures the chip row and per-card tags in the assembled browser.

## Consequences

Every row added to a shipped composition without a `category` lands in 其他插件; the `verify-cordis-config` gate requires the field only when present, so a forgotten row shows up as a miscategorized list entry rather than a boot failure. Typert Remote artifacts for `pluginInventory/list` regenerate from the new field (`pnpm run build:lib:host`). Preset rows never appear here: the list projects `ctx.loader.entries()`, and preset trees are session-plane.
