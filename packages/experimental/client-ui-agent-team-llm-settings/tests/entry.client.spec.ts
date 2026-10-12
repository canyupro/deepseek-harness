/**
 * The shipped browser entry, mounted through its own `apply` against the real
 * generated Remote contribution.
 *
 * This is the composition path rather than a hand-built one: the contribution
 * object comes from the Host package's generated `/remote` export and is handed
 * to the same `mountAgentTeamLlmSettingsCard` the plugin uses, so the entry
 * function and the Session-selection fallback are exercised as shipped.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteContribution, TypertRemoteEvent } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply } from '../src/client/index.ts'
import teamRemote from '@deepseek-ai/dsh-experimental-agent-team-llm-settings/remote'

/** One Host view of a served namespace. */
function view(ns: string) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision: 0 }
}

/** One Session catalog row; `mainView` decides whether the main view retains it. */
function row(id: string, updatedAt: number, retainedBy: { mainView?: number }) {
  return { id: id as SessionId, retainedBy, updatedAt }
}

interface Options {
  /** Session rows the catalog reports. */
  rows?: readonly Record<string, unknown>[]
  /** The adapter directory answer. */
  catalog?: () => Promise<unknown>
  /** The project document answer. */
  read?: () => Promise<unknown>
}

/** A browser composition serving the settings namespace. */
async function bench(options: Options = {}) {
  const rows = options.rows ?? []
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)

  const mounted: TypertRemoteContribution[] = []
  class Remote extends Service {
    readonly $host = { home: undefined, isLoopback: true }

    constructor() { super(ctx, 'remote') }

    async $mount(contribution: TypertRemoteContribution) {
      mounted.push(contribution)
      return async () => {}
    }

    $on(_event: TypertRemoteEvent, _listener: (...args: never[]) => void): () => void {
      return () => {}
    }
  }
  // The Service constructor registers `remote` on the context itself.
  new Remote()

  ctx.provide('remote.session', {
    modelCatalog: vi.fn(options.catalog ?? (() => Promise.resolve({ ok: true, value: { groups: [], failures: [] } }))),
  })
  ctx.provide('remote.settings', {
    describe: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [view('agent-team-llm-settings')] },
    })),
  })
  const readTeamDocument = vi.fn<(...args: never[]) => Promise<unknown>>(options.read ?? (() => Promise.resolve({
    ok: true as const, value: { path: '/project/.dsh/team.json', document: { version: 1 as const } },
  })))
  ctx.provide('remote.agentTeamLlm', {
    readTeamDocument,
    saveTeamDocument: vi.fn(() => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } })),
  })
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({
        ids: rows.map(entry => entry.id),
        byId: Object.fromEntries(rows.map(entry => [entry.id as string, entry])),
        phase: 'ready',
        projectionsBySession: {},
      }),
      subscribe: () => () => {},
    },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'plugins.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, mounted, slots, readTeamDocument }
}

describe('shipped browser entry', () => {
  it('mounts the generated Remote contribution and registers the card', async () => {
    const { ctx, mounted, slots } = await bench({ rows: [row('session-a', 1, { mainView: 1 })] })

    const dispose = await apply(ctx)

    // The contribution handed to the Remote is the one the Host package
    // generates, not a hand-written stand-in.
    expect(mounted).toEqual([teamRemote])
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const entry = slots.entries('plugins.item')[0]!
    expect(entry.options).toMatchObject({ id: 'agent-team-llm', order: 31 })
    expect(entry.locale).toBe('settings.agentTeamLlm')
    expect(resolveSlotLabel(entry.options.label)).toBe('团队 LLM 设置')

    await dispose()
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })

  it('falls back to the most recently updated Session when no view retains one', async () => {
    const { ctx, readTeamDocument } = await bench({
      // Two sessions, neither retained by a main view: the newer one is the
      // subject the card reads the project document for. Catalog order is
      // deliberately newest-first, so the reducer has to keep its incumbent
      // rather than always taking the row it is handed.
      rows: [row('new', 2, {}), row('old', 1, {})],
    })

    const dispose = await apply(ctx)

    await vi.waitFor(() => { expect(readTeamDocument).toHaveBeenCalled() })
    expect(readTeamDocument.mock.calls[0]?.[0]).toBe('new')

    await dispose()
  })

  it('reads the Session the main view retains in preference to the newest', async () => {
    const { ctx, readTeamDocument } = await bench({
      rows: [row('retained', 1, { mainView: 1 }), row('newer', 9, {})],
    })

    const dispose = await apply(ctx)

    await vi.waitFor(() => { expect(readTeamDocument).toHaveBeenCalled() })
    expect(readTeamDocument.mock.calls[0]?.[0]).toBe('retained')

    await dispose()
  })

  it('reads no project document while the catalog holds no Session at all', async () => {
    const { ctx, slots, readTeamDocument } = await bench({ rows: [] })

    const dispose = await apply(ctx)

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    // With no Session there is no workspace root to ask about, so the card
    // greys the layer out rather than inventing one.
    expect(readTeamDocument).not.toHaveBeenCalled()

    await dispose()
  })

  it('keeps the page registered when the adapter directory fails', async () => {
    const { ctx, slots } = await bench({
      rows: [row('session-a', 1, { mainView: 1 })],
      catalog: () => Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', 'no provider', {}) }),
    })

    const dispose = await apply(ctx)

    // A dead directory leaves the configured page present with an error surface
    // rather than silently removing the entry.
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })

    await dispose()
  })
})
