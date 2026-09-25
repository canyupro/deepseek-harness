import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PluginLocalizedMeta } from '@deepseek-ai/dsh-package-manifest'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/**
 * Product-level plugin classification shown by the Web plugin list.
 *
 * The value is declared per Loader row as static `category` metadata
 * (`core` | `extension` | `ui` | `other`); a row without a recognized
 * category projects as `other`, which is the bucket's purpose — it holds
 * everything a composition does not explicitly classify.
 */
export type PluginCategory = 'core' | 'extension' | 'ui' | 'other'

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Local package display metadata, independent of whether the entry is enabled. */
  readonly meta?: PluginLocalizedMeta
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  /** Declared row classification; unrecognized or absent values project as `other`. */
  readonly category?: PluginCategory
}

/** Effective enablement of one preset composition row. */
export type PresetPluginEnablement = boolean | 'conditional'

/** One plugin row an agent preset's composition names. */
export interface AgentPresetPluginRow {
  /** Composition row id, or null when the row declares none. */
  readonly entryId: string | null
  /** Module specifier the row names. */
  readonly moduleName: string
  /** Local package display metadata, independent of whether the preset is mounted. */
  readonly meta?: PluginLocalizedMeta
  /**
   * Effective enablement, including disabled ancestor groups. `'conditional'`
   * marks a `!!js` disabled expression on a composition no session has
   * mounted, which only a Loader context can decide.
   */
  readonly enabled: PresetPluginEnablement
  /** The row's own `!!js` disabled expression, when it carries one. */
  readonly condition?: string
  /** Root-fiber phase when the composition is live; null otherwise. */
  readonly fiberPhase: PluginFiberPhase
}

/** Lifecycle phase of one user-defined dynamic plugin row. */
export type DynamicPluginPhase = 'running' | 'waiting' | 'in-flight' | 'failed' | 'stopped'

/** Personal-library lifecycle state of one user-defined plugin. */
export type DynamicPluginLibraryState = 'off' | 'on-editable' | 'frozen'

/** One user-defined dynamic plugin projected into the inventory, source-free. */
export interface DynamicPluginEntry {
  /** Stable plugin identity minted by the dynamic runner. */
  readonly pluginId: string
  /** Package label of the most recently defined version. */
  readonly name: string
  /** User-facing purpose of the most recently defined version. */
  readonly purpose: string
  /** Session that owns the plugin. */
  readonly sessionId: string
  /** Number of immutable package versions. */
  readonly packageCount: number
  /** Last package that completed activation successfully. */
  readonly currentPackageId?: string
  /** Lifecycle phase derived from the active run and latest attempt. */
  readonly phase: DynamicPluginPhase
  /** Personal-library state, present when the plugin is persisted there. */
  readonly libraryState?: DynamicPluginLibraryState
}

/** One agent preset's identity and flattened composition in the inventory. */
export interface AgentPresetPluginGroup {
  /** Stable preset id. */
  readonly id: string
  /** Display name the preset published; a reader falls back to the id. */
  readonly name?: string
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Why this preset's composition cannot be read; absent when rows answer. */
  readonly broken?: string
  /** Plugin rows in composition order; empty when the preset is broken. */
  readonly rows: readonly AgentPresetPluginRow[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  /** Whether this Host exposes persistent current-profile management. */
  readonly managementAvailable?: boolean
  readonly entries: readonly PluginInventoryEntry[]
  /**
   * Per-preset compositions, present only when an agent-preset roster is
   * composed in this deployment.
   */
  readonly agentPresets?: readonly AgentPresetPluginGroup[]
  /**
   * User-defined dynamic plugins, present only when the dynamic runner is
   * mounted in this process.
   */
  readonly dynamic?: readonly DynamicPluginEntry[]
}
