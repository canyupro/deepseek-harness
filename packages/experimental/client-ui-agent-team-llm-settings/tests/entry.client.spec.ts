/**
 * The shipped browser entry, mounted through its own `apply` against the real
 * generated Remote contribution.
 *
 * This is the composition path rather than a hand-built one: the contribution
 * object comes from the Host package's generated `/remote` export and is handed
 * to the same `mountAgentTeamLlmSettingsCard` the plugin uses, so the entry
 * function and the Workspace-default fallback are exercised as shipped.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteContribution, TypertRemoteEvent } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply } from '../src/client/index.ts'
import type { AgentTeamLlmCardFace } from '../src/client/agent-team-llm-card-controller.ts'
import { workspaceRow, workspaceSource } from './workspace-source.client.ts'
import teamRemote from '@deepseek-ai/dsh-experimental-agent-team-llm-settings/remote'

/** One Host view of a served namespace. */
function view(ns: string) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision: 0 }
}

/** One Session catalog row; `mainView` decides whether the main view retains it. */
function row(id: string, createdAt: number, retainedBy: { mainView?: number }) {
  return { id: id as SessionId, retainedBy, createdAt }
}

interface Options {
  /** Session rows the catalog reports. */
  rows?: readonly Record<string, unknown>[]
  /** The adapter directory answer. */
  catalog?: () => Promise<unknown>
  /** The project document answer. */
  read?: () => Promise<unknown>
  /** Workspaces the sidebar lists, in its order. */
  workspaces?: readonly WorkspaceView[]
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
  const listeners = new Map<TypertRemoteEvent, Set<() => void>>()
  class Remote extends Service {
    readonly $host = { home: undefined, isLoopback: true }

    constructor() { super(ctx, 'remote') }

    async $mount(contribution: TypertRemoteContribution) {
      mounted.push(contribution)
      return async () => {}
    }

    $on(event: TypertRemoteEvent, listener: (...args: never[]) => void): () => void {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(event, set)
      return () => { set.delete(listener) }
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
  const listMemberPermissionPresets = vi.fn(() => Promise.resolve({
    ok: true as const, value: { presets: [], custom: { name: 'custom', label: 'custom' } },
  }))
  ctx.provide('remote.agentTeamLlm', {
    readTeamDocument,
    saveTeamDocument: vi.fn(() => Promise.resolve({ ok: true as const, value: { path: '/project/.dsh/team.json' } })),
    listMemberPermissionPresets,
  })
  ctx.provide('workspaces', { list: workspaceSource(options.workspaces ?? []) } as never)
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
  return {
    ctx, mounted, slots, readTeamDocument, listMemberPermissionPresets,
    // Forward one Host event to the listeners the card registered for it.
    emit: (event: TypertRemoteEvent) => { for (const listener of listeners.get(event) ?? []) listener() },
  }
}

/** The card hooks the page registered, which is where the workspace layer is read. */
function faceOf(slots: SlotRegistry): Pick<AgentTeamLlmCardFace, 'hooks'> {
  const entry = slots.entries('plugins.item')[0]!
  return (entry.inject as () => Pick<AgentTeamLlmCardFace, 'hooks'>)()
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

  it('reads the first Workspace the sidebar lists when no view retains a Session', async () => {
    const { ctx, readTeamDocument } = await bench({
      // No main view retains a session, so nothing outranks the sidebar order:
      // the card reads the first Workspace the sidebar lists.
      rows: [row('catalog-only', 2, {})],
      workspaces: [
        workspaceRow('ws-new', 'new', '/projects/new'),
        workspaceRow('ws-old', 'old', '/projects/old'),
      ],
    })

    const dispose = await apply(ctx)

    await vi.waitFor(() => { expect(readTeamDocument).toHaveBeenCalled() })
    expect(readTeamDocument.mock.calls[0]?.[0]).toBe('ws-new')

    await dispose()
  })

  it('reads the first sidebar Workspace while the catalog holds no Session at all', async () => {
    const { ctx, readTeamDocument } = await bench({
      rows: [],
      workspaces: [workspaceRow('ws-only', 'only', '/projects/only')],
    })

    const dispose = await apply(ctx)

    // The workspace layer needs a Workspace, not a Session, so an empty Session
    // catalog leaves the sidebar's own rows to decide.
    await vi.waitFor(() => { expect(readTeamDocument).toHaveBeenCalled() })
    expect(readTeamDocument.mock.calls[0]?.[0]).toBe('ws-only')

    await dispose()
  })

  it('never reads a project document while the sidebar lists no Workspace', async () => {
    const { ctx, readTeamDocument, slots } = await bench({ rows: [row('catalog-only', 2, {})], workspaces: [] })

    const dispose = await apply(ctx)

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    // There is no row to resolve, so the layer is unavailable for the reason an
    // empty sidebar names rather than for a refused read.
    expect(readTeamDocument).not.toHaveBeenCalled()
    expect(faceOf(slots).hooks.agentTeamLlmCard.getSnapshot().workspace)
      .toMatchObject({ status: 'unavailable', reason: 'noWorkspace' })

    await dispose()
  })

  it('reads the Workspace accounting for the retained main-view Session, not the first row', async () => {
    const { ctx, readTeamDocument } = await bench({
      rows: [row('retained', 1, { mainView: 1 }), row('newer', 9, {})],
      workspaces: [
        workspaceRow('ws-first', 'first', '/projects/first'),
        workspaceRow('ws-retained', 'retained', '/projects/retained', [SessionId('retained')]),
      ],
    })

    const dispose = await apply(ctx)

    await vi.waitFor(() => { expect(readTeamDocument).toHaveBeenCalled() })
    // The retained Session is what the operator is looking at, so its Workspace
    // outranks the sidebar's own first row.
    expect(readTeamDocument.mock.calls.map(call => call[0])).toEqual(['ws-retained'])

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

  it('re-reads the member permission options when the permission catalog changes', async () => {
    const { ctx, emit, listMemberPermissionPresets } = await bench({
      rows: [row('session-a', 1, { mainView: 1 })],
    })

    const dispose = await apply(ctx)

    await vi.waitFor(() => { expect(listMemberPermissionPresets).toHaveBeenCalledOnce() })
    emit('permission-presets/catalog-changed')
    // The preset table belongs to the permission domain, so its invalidation
    // reaches the card without any settings document change.
    await vi.waitFor(() => { expect(listMemberPermissionPresets).toHaveBeenCalledTimes(2) })

    await dispose()
  })
})
