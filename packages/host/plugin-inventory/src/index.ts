/** Read-only projection of the current Cordis Loader plugin entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-app-boot'
// Type-only: the optional dynamic runner resolved through `ctx.get`, and its
// inventory row vocabulary projected into this package's own snapshot types.
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type { DynamicCordisInventoryRow } from '@deepseek-ai/dsh-cordis-host-runner/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  DynamicPluginEntry,
  DynamicPluginPhase,
  PluginCategory,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/**
 * Brand an existing Loader-tree entry id at the owning boundary.
 * @param value - the entry id as the Loader tree spells it.
 * @returns the same id as the inventory's branded entry id.
 */
export function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Every Loader row value the projection classifies, mapped to its category. */
const CATEGORY_VALUES: Readonly<Record<PluginCategory, true>> = {
  core: true,
  extension: true,
  ui: true,
  other: true,
}

/**
 * Project a row's static `category` metadata. Unknown or absent values land
 * in `other` — the fallback bucket is the field's declared semantics, not a
 * skipped configuration error, and the `verify-cordis-config` gate rejects
 * misspelled values in shipped compositions before they boot.
 */
function entryCategory(value: string | null | undefined): PluginCategory {
  if (value !== null && value !== undefined && value in CATEGORY_VALUES) {
    return value as PluginCategory
  }
  return 'other'
}

/**
 * Lifecycle phase for one dynamic runner row. An active run wins; a stopped
 * plugin with a rejected, failed, or cancelled latest attempt reports that
 * failure, and the remaining transition statuses fold into `in-flight`.
 */
function dynamicPhase(row: DynamicCordisInventoryRow): DynamicPluginPhase {
  if (row.activeRun !== undefined) {
    return row.latestRun?.status === 'waiting' ? 'waiting' : 'running'
  }
  const status = row.latestRun?.status
  if (status === 'awaiting-approval' || status === 'starting-host' || status === 'client-pending') {
    return 'in-flight'
  }
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'failed'
  return 'stopped'
}

/** Project one runner row into this package's source-free vocabulary. */
function dynamicEntry(row: DynamicCordisInventoryRow): DynamicPluginEntry {
  const latest = row.packages[row.packages.length - 1]
  return {
    pluginId: row.pluginId,
    name: latest?.name ?? row.pluginId,
    purpose: latest?.purpose ?? '',
    sessionId: row.agentId,
    packageCount: row.packages.length,
    ...row.currentPackageId === undefined ? {} : { currentPackageId: row.currentPackageId },
    phase: dynamicPhase(row),
    ...row.libraryState === undefined ? {} : { libraryState: row.libraryState },
  }
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins. When the dynamic runner is mounted, the snapshot
   * also carries its process-local plugins as a third, source-free group.
   * @returns Current non-group Loader entries in Loader order, with optional display metadata,
   * per-preset compositions, and dynamic plugins when their services are mounted.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    return readPluginInventory(this.ctx)
  }
}

export default PluginInventoryGateway

/** Read current Loader entries and optional preset compositions.
 * @param ctx Context with the Loader service.
 * @returns Current inventory with optional display metadata and no separate runtime cache.
 */
export async function readPluginInventory(ctx: Context): Promise<PluginInventorySnapshot> {
  const entries: PluginInventoryEntry[] = []
  const packages = ctx.get('pluginPackages')
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    const base = entry.parent.tree.ctx.baseUrl
    const meta = base === undefined ? undefined : packages?.metaOf(entry.options.name, base)
    entries.push({
      entryId: pluginEntryId(entry.id),
      moduleName: entry.options.name,
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      category: entryCategory(entry.options.category),
      ...meta === undefined ? {} : { meta },
    })
  }
  const presets = ctx.get('agentPresets')
  const management = ctx.get('pluginManager') === undefined ? {} : { managementAvailable: true }
  const dynamicRow = ctx.get('dynamicCordisRunner')?.inventory().map(row => dynamicEntry(row))
  const dynamic = dynamicRow === undefined ? {} : { dynamic: dynamicRow }
  if (presets === undefined) return { entries, ...dynamic, ...management }
  const agentPresets: AgentPresetPluginGroup[] = (await presets.compositionInventory()).map(
    composition => ({
      ...composition,
      rows: composition.rows.map(({ fiberState, ...row }) => {
        const meta = ctx.baseUrl === undefined ? undefined : packages?.metaOf(row.moduleName, ctx.baseUrl)
        return {
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
          ...meta === undefined ? {} : { meta },
        }
      }),
    }),
  )
  return { entries, agentPresets, ...dynamic, ...management }
}
