/** What the browser half mounts, when, what refreshes the model catalogue, and that it all leaves with the fiber. */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution, TypertRemoteEvent } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { inject, mountAgentTeamLlmSettingsCard } from '../src/client/mount.ts'
import type { AgentTeamLlmCardFace } from '../src/client/index.ts'
import { AgentTeamLlmCardController } from '../src/client/agent-team-llm-card-controller.ts'
import { workspaceSource } from './workspace-source.client.ts'
import { apply as hostApply } from '../src/index.ts'

/** The generated contribution this plugin mounts. */
const TEAM_REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-agent-team-llm-settings',
  descriptors: [],
}

/** One Host view of a served namespace. */
function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision }
}

/** @param served - namespaces the Host describes; omitted answers a failed read. */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    /** Fixed Host facts the settings plugin reads while deciding what it serves. */
    readonly $host = { home: undefined, isLoopback: true }
    private readonly subscriptions = new Map<string, Set<(...args: never[]) => void>>()

    constructor() { super(ctx, 'remote') }

    async $mount(contribution: TypertRemoteContribution) {
      expect(contribution).toBe(TEAM_REMOTE)
      return unmount
    }

    /** Record a forwarded Host event for the spec's own driver. */
    $on(event: TypertRemoteEvent, listener: (...args: never[]) => void): () => void {
      const listeners = this.subscriptions.get(event) ?? new Set()
      this.subscriptions.set(event, listeners)
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    /** Deliver one forwarded Host event to this double's subscribers. */
    emit(event: string, args: readonly unknown[]): void {
      for (const listener of [...this.subscriptions.get(event) ?? []]) listener(...args as never[])
    }
  }
  const remote = new Remote()
  const models = vi.fn(() => Promise.resolve({ ok: true as const, value: { groups: [], failures: [] } }))
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : { ok: true, value: { writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)) } }))
  ctx.provide('remote.session', { modelCatalog: models })
  ctx.provide('remote.settings', { describe: describeSettings })
  ctx.provide('remote.agentTeamLlm', {
    readTeamDocument: vi.fn(() => Promise.resolve({
      ok: true as const, value: { path: '/project/.dsh/team.json' },
    })),
    saveTeamDocument: vi.fn(() => Promise.resolve({
      ok: true as const, value: { path: '/project/.dsh/team.json' },
    })),
    listMemberPermissionPresets: vi.fn(() => Promise.resolve({
      ok: true as const, value: { presets: [], custom: { name: 'custom', label: 'custom' } },
    })),
  })
  ctx.provide('workspaces', { list: workspaceSource() } as never)
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
      subscribe: () => () => {},
    },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx,
    remote,
    slots: ctx.get('slots') as SlotRegistry,
    describeSettings,
    models,
    unmount,
    mount: async () => await mountAgentTeamLlmSettingsCard(ctx, TEAM_REMOTE),
  }
}

/** The Plugins page's item slot, as its owner declares it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'plugins.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('client-ui-agent-team-llm-settings apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it mounts through', () => {
    expect(inject).toEqual(['remote'])
  })

  it('registers one page while the Host serves the namespace, titled in the active locale', async () => {
    const { slots, mount } = await bench(['agent-team-llm-settings'])
    declareRoot(slots)

    const dispose = await mount()

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const entry = slots.entries('plugins.item')[0]!
    expect(entry.options).toMatchObject({ id: 'agent-team-llm', order: 31 })
    expect(resolveSlotLabel(entry.options.label)).toBe('团队 LLM 设置')
    expect(entry.locale).toBe('settings.agentTeamLlm')
    const face = (entry.inject as () => Pick<AgentTeamLlmCardFace, 'hooks'>)()
    expect(Object.keys(face.hooks)).toEqual(['agentTeamLlmCard'])
    await dispose()
  })

  it('registers the page while the Host serves the namespace, and nothing when it does not', async () => {
    const served = await bench(['agent-team-llm-settings'])
    declareRoot(served.slots)
    const dispose = await served.mount()
    await vi.waitFor(() => { expect(served.slots.entries('plugins.item')).toHaveLength(1) })
    await dispose()
    expect(served.slots.entries('plugins.item')).toHaveLength(0)
    expect(served.unmount).toHaveBeenCalledOnce()

    const other = await bench(['shell'])
    declareRoot(other.slots)
    await other.mount()
    await vi.waitFor(() => { expect(other.describeSettings).toHaveBeenCalled() })
    expect(other.slots.entries('plugins.item')).toHaveLength(0)
  })

  it('withdraws the Remote mount when the registration fails', async () => {
    const { slots, unmount, mount } = await bench(['agent-team-llm-settings'])
    declareRoot(slots)
    vi.spyOn(slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })

    await expect(mount()).rejects.toThrow('slot failed')

    expect(unmount).toHaveBeenCalledOnce()
  })

  it('refreshes the model catalogue after model inputs change or the connection resets', async () => {
    const refresh = vi.spyOn(AgentTeamLlmCardController.prototype, 'refreshCatalog')
    const reset = vi.spyOn(AgentTeamLlmCardController.prototype, 'resetConnection')
    const { ctx, remote, slots, mount } = await bench(['agent-team-llm-settings'])
    declareRoot(slots)
    const dispose = await mount()
    refresh.mockClear()
    reset.mockClear()

    remote.emit('llm/adapters-updated', [])
    expect(refresh).toHaveBeenCalledTimes(1)
    remote.emit('settings/document-updated', ['agent-team-llm-settings', '1'])
    expect(refresh).toHaveBeenCalledTimes(2)
    ctx.emit('connection/reset')
    expect(reset).toHaveBeenCalledTimes(1)
    refresh.mockRestore()
    reset.mockRestore()
    await dispose()
  })

  it('collapses the page on teardown', async () => {
    const { slots, unmount, mount } = await bench(['agent-team-llm-settings'])
    declareRoot(slots)
    const dispose = await mount()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })

    await dispose()

    expect(slots.entries('plugins.item')).toHaveLength(0)
    expect(unmount).toHaveBeenCalledOnce()
  })
})
